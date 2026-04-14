/**
 * TSMOM (Time Series Momentum) + Volatility Scaling Strategy API
 * 
 * Endpoint: GET /api/v2/signals/cta-tsmom
 * 
 * Query Parameters:
 *   - asset: BTC | ETH (default: BTC)
 *   - momentumPeriod: 6 | 12 (months, default: 12)
 *   - volWindow: 30 | 60 (days, default: 30)
 *   - targetVol: 10 | 15 | 20 (%, default: 15)
 * 
 * Response:
 * {
 *   "asset": "BTC",
 *   "signal": "LONG" | "SHORT" | "NEUTRAL",
 *   "confidence": 0.85,
 *   "position": {
 *     "direction": "LONG",
 *     "size": 0.75,        // 75% of max position
 *     "maxPosition": 1.5   // 150% cap
 *   },
 *   "entry": {
 *     "price": 85000,
 *     "stopLoss": 76500,   // 10% trailing from max
 *     "takeProfit": null   // TSMOM doesn't use fixed TP
 *   },
 *   "metrics": {
 *     "momentum12m": 0.45,     // +45% over 12 months
 *     "volatility30d": 0.35,   // 35% annualized
 *     "sharpeEstimate": 0.95
 *   },
 *   "timestamp": "2026-04-11T14:52:00Z"
 * }
 */

const express = require('express');
const router = express.Router();
const cache = require('../cache/store');

// TSMOM Configuration
const TSMOM_CONFIG = {
  defaultMomentumPeriod: 12,  // months
  defaultVolWindow: 30,       // days
  defaultTargetVol: 0.15,     // 15%
  maxPosition: 1.5,           // 150%
  stopLossPct: 0.10,          // 10% trailing
  minHistoryDays: 400         // Need at least 400 days for 12-month momentum
};

// GET / (mounted at /api/v2/signals/cta-tsmom)
router.get('/', async (req, res) => {
  try {
    const asset = (req.query.asset || 'BTC').toUpperCase();
    const momentumMonths = Math.min(24, Math.max(1, parseInt(req.query.momentumPeriod) || TSMOM_CONFIG.defaultMomentumPeriod));
    const volWindow = Math.min(90, Math.max(7, parseInt(req.query.volWindow) || TSMOM_CONFIG.defaultVolWindow));
    const targetVol = Math.min(0.30, Math.max(0.05, parseFloat(req.query.targetVol) || TSMOM_CONFIG.defaultTargetVol));

    // Validate asset
    if (!['BTC', 'ETH'].includes(asset)) {
      return res.status(400).json({ error: 'Supported assets: BTC, ETH' });
    }

    // Fetch price data
    const priceData = await fetchPriceData(asset, TSMOM_CONFIG.minHistoryDays);
    if (!priceData || priceData.length < TSMOM_CONFIG.minHistoryDays) {
      return res.status(400).json({ error: 'Insufficient price data' });
    }

    // 1. Calculate Time Series Momentum
    const momentumDays = momentumMonths * 30;  // Approximate
    const currentPrice = priceData[priceData.length - 1].price;
    const pastPrice = priceData[priceData.length - 1 - momentumDays]?.price;
    
    if (!pastPrice) {
      return res.status(400).json({ error: 'Insufficient history for momentum calculation' });
    }
    
    const momentumReturn = (currentPrice - pastPrice) / pastPrice;
    
    // 2. Calculate Realized Volatility
    const volData = priceData.slice(-volWindow);
    const dailyReturns = [];
    for (let i = 1; i < volData.length; i++) {
      const ret = Math.log(volData[i].price / volData[i-1].price);
      dailyReturns.push(ret);
    }
    
    const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, ret) => sum + Math.pow(ret - meanReturn, 2), 0) / (dailyReturns.length - 1);
    const realizedVol = Math.sqrt(variance * 365);  // Annualized

    // 3. Generate Signal
    let signal, direction;
    if (momentumReturn > 0.02) {  // +2% threshold to avoid noise
      signal = 'LONG';
      direction = 1;
    } else if (momentumReturn < -0.02) {
      signal = 'SHORT';
      direction = -1;
    } else {
      signal = 'NEUTRAL';
      direction = 0;
    }

    // 4. Volatility Scaling
    let positionSize = 0;
    if (direction !== 0) {
      const scaling = targetVol / realizedVol;
      positionSize = Math.min(scaling, TSMOM_CONFIG.maxPosition);
    }

    // 5. Calculate Stop Loss (trailing from max/min)
    let stopLoss = null;
    if (signal === 'LONG') {
      const maxPrice = Math.max(...priceData.slice(-momentumDays).map(p => p.price));
      stopLoss = maxPrice * (1 - TSMOM_CONFIG.stopLossPct);
    } else if (signal === 'SHORT') {
      const minPrice = Math.min(...priceData.slice(-momentumDays).map(p => p.price));
      stopLoss = minPrice * (1 + TSMOM_CONFIG.stopLossPct);
    }

    // 6. Calculate Confidence (based on momentum strength)
    const confidence = Math.min(0.95, Math.abs(momentumReturn) * 2 + 0.5);

    // 7. Estimate Sharpe (simplified)
    const sharpeEstimate = realizedVol > 0 ? (momentumReturn / Math.sqrt(momentumMonths / 12)) / realizedVol : 0;

    res.json({
      asset,
      signal,
      confidence: Math.round(confidence * 100) / 100,
      position: {
        direction: signal,
        size: Math.round(positionSize * 100) / 100,
        maxPosition: TSMOM_CONFIG.maxPosition
      },
      entry: {
        price: Math.round(currentPrice * 100) / 100,
        stopLoss: stopLoss ? Math.round(stopLoss * 100) / 100 : null,
        takeProfit: null
      },
      metrics: {
        momentum12m: Math.round(momentumReturn * 10000) / 100,
        volatility30d: Math.round(realizedVol * 10000) / 100,
        sharpeEstimate: Math.round(sharpeEstimate * 100) / 100
      },
      params: {
        momentumPeriod: momentumMonths,
        volWindow,
        targetVol: Math.round(targetVol * 100) + '%'
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('[TSMOM] Error:', err.message);
    res.status(500).json({ error: 'Failed to generate TSMOM signal' });
  }
});

// Helper: Fetch price data from CryptoCompare
async function fetchPriceData(asset, minDays) {
  const cacheKey = `tsmom:${asset}:prices`;
  const cached = cache.get(cacheKey);
  
  if (cached && cached.length >= minDays) {
    return cached;
  }

  try {
    const url = `https://min-api.cryptocompare.com/data/v2/histoday?fsym=${asset}&tsym=USD&limit=${Math.max(minDays, 730)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`CryptoCompare API ${resp.status}`);
    
    const json = await resp.json();
    if (json.Response !== 'Success') throw new Error(json.Message || 'CryptoCompare error');

    const prices = (json.Data?.Data || [])
      .filter(d => d.close > 0)
      .map(d => ({
        date: new Date(d.time * 1000).toISOString().slice(0, 10),
        price: d.close
      }));

    cache.set(cacheKey, prices, 60 * 60 * 1000);  // 1 hour cache
    return prices;
  } catch (err) {
    console.error(`[TSMOM] Fetch error for ${asset}:`, err.message);
    return null;
  }
}

module.exports = router;
