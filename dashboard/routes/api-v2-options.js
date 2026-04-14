/**
 * Multi-Factor Options Sell Put Strategy API
 * 
 * Endpoint: GET /api/v2/signals/options-sell-put
 * 
 * Query Parameters:
 *   - asset: BTC | ETH (default: BTC)
 *   - thresholdFear: 20 | 30 | 40 (Fear & Greed threshold, default: 30)
 *   - thresholdDvol: 70 | 80 | 90 (DVOL percentile threshold, default: 80)
 *   - thresholdDrop: 10 | 15 | 20 (% drawdown threshold, default: 15)
 * 
 * Response:
 * {
 *   "asset": "BTC",
 *   "signal": "ENTER" | "HOLD" | "AVOID",
 *   "confidence": 0.92,
 *   "recommendation": {
 *     "action": "建议开仓",
 *     "rationale": "市场极度恐慌(指数18), DVOL高位(92百分位), 7日跌幅-21%",
 *     "suggestedStrike": 75000,
 *     "suggestedExpiry": "30D"
 *   },
 *   "conditions": {
 *     "fearGreed": {
 *       "value": 18,
 *       "threshold": "< 30",
 *       "satisfied": true,
 *       "weight": 0.3
 *     },
 *     "dvolPercentile": {
 *       "value": 92,
 *       "threshold": "> 80%",
 *       "satisfied": true,
 *       "weight": 0.4
 *     },
 *     "priceDrawdown": {
 *       "value": -21,
 *       "threshold": "< -15%",
 *       "satisfied": true,
 *       "weight": 0.3
 *     }
 *   },
 *   "score": 8.5,
 *   "timestamp": "2026-04-11T14:52:00Z"
 * }
 */

const express = require('express');
const router = express.Router();
const cache = require('../cache/store');

// Multi-Factor Configuration
const OPTIONS_CONFIG = {
  defaultThresholdFear: 30,      // Fear & Greed < 30 (Extreme Fear)
  defaultThresholdDvol: 80,      // DVOL percentile > 80%
  defaultThresholdDrop: 15,      // 7-day drawdown > 15%
  weights: {
    fearGreed: 0.3,
    dvolPercentile: 0.4,
    priceDrawdown: 0.3
  },
  minScoreToEnter: 7.0,          // Min weighted score to recommend entry
  lookbackDays: 7                // For drawdown calculation
};

// GET / (mounted at /api/v2/signals/options-sell-put)
router.get('/', async (req, res) => {
  try {
    const asset = (req.query.asset || 'BTC').toUpperCase();
    const thresholdFear = Math.min(50, Math.max(0, parseInt(req.query.thresholdFear) || OPTIONS_CONFIG.defaultThresholdFear));
    const thresholdDvol = Math.min(100, Math.max(50, parseInt(req.query.thresholdDvol) || OPTIONS_CONFIG.defaultThresholdDvol));
    const thresholdDrop = Math.min(30, Math.max(5, parseInt(req.query.thresholdDrop) || OPTIONS_CONFIG.defaultThresholdDrop));

    // Validate asset
    if (!['BTC', 'ETH'].includes(asset)) {
      return res.status(400).json({ error: 'Supported assets: BTC, ETH' });
    }

    // Fetch all required data in parallel
    const [fearGreedData, dvolData, priceData] = await Promise.all([
      fetchFearGreed(),
      fetchDVOL(asset),
      fetchPriceData(asset, 30)
    ]);

    // 1. Fear & Greed Condition
    const fearGreedValue = fearGreedData?.value ?? 50;
    const fearGreedSatisfied = fearGreedValue < thresholdFear;
    const fearGreedScore = fearGreedSatisfied ? 
      Math.min(10, 10 * (thresholdFear - fearGreedValue) / thresholdFear + 5) : 
      Math.max(0, 5 * (thresholdFear - fearGreedValue) / thresholdFear + 5);

    // 2. DVOL Percentile Condition
    const currentDvol = dvolData?.current;
    const dvolPercentile = dvolData?.percentile ?? 50;
    const dvolSatisfied = dvolPercentile > thresholdDvol;
    const dvolScore = dvolSatisfied ? 
      Math.min(10, 10 * (dvolPercentile - thresholdDvol) / (100 - thresholdDvol) + 5) : 
      Math.max(0, 5 * (dvolPercentile - thresholdDvol) / thresholdDvol + 5);

    // 3. Price Drawdown Condition
    let drawdownSatisfied = false;
    let drawdownValue = 0;
    let drawdownScore = 5;
    
    if (priceData && priceData.length >= OPTIONS_CONFIG.lookbackDays) {
      const currentPrice = priceData[priceData.length - 1].price;
      const maxPrice = Math.max(...priceData.slice(-OPTIONS_CONFIG.lookbackDays).map(p => p.price));
      drawdownValue = ((currentPrice - maxPrice) / maxPrice) * 100;
      drawdownSatisfied = drawdownValue <= -thresholdDrop;
      drawdownScore = drawdownSatisfied ? 
        Math.min(10, 10 * Math.abs(drawdownValue) / thresholdDrop) : 
        Math.max(0, 5 + 5 * drawdownValue / thresholdDrop);
    }

    // 4. Calculate Weighted Score
    const weightedScore = (
      fearGreedScore * OPTIONS_CONFIG.weights.fearGreed +
      dvolScore * OPTIONS_CONFIG.weights.dvolPercentile +
      drawdownScore * OPTIONS_CONFIG.weights.priceDrawdown
    );

    // 5. Generate Signal
    let signal, recommendation;
    const allSatisfied = fearGreedSatisfied && dvolSatisfied && drawdownSatisfied;
    
    if (weightedScore >= OPTIONS_CONFIG.minScoreToEnter && allSatisfied) {
      signal = 'ENTER';
      recommendation = {
        action: '建议开仓',
        rationale: `市场${getFearLabel(fearGreedValue)}(指数${fearGreedValue}), DVOL${dvolPercentile}百分位, ${OPTIONS_CONFIG.lookbackDays}日跌幅${drawdownValue.toFixed(1)}%。满足所有开仓条件。`,
        suggestedStrike: calculateSuggestedStrike(priceData, 0.85),  // 15% OTM
        suggestedExpiry: '30D'
      };
    } else if (weightedScore >= 5.0) {
      signal = 'HOLD';
      recommendation = {
        action: '保持观望',
        rationale: '部分条件满足，但尚未达到最佳开仓时机。',
        suggestedStrike: null,
        suggestedExpiry: null
      };
    } else {
      signal = 'AVOID';
      recommendation = {
        action: '建议回避',
        rationale: '当前市场条件不适合开仓Sell Put。',
        suggestedStrike: null,
        suggestedExpiry: null
      };
    }

    // 6. Calculate Confidence
    const confidence = Math.min(0.95, weightedScore / 10);

    res.json({
      asset,
      signal,
      confidence: Math.round(confidence * 100) / 100,
      recommendation,
      conditions: {
        fearGreed: {
          value: fearGreedValue,
          threshold: `< ${thresholdFear}`,
          satisfied: fearGreedSatisfied,
          weight: OPTIONS_CONFIG.weights.fearGreed,
          score: Math.round(fearGreedScore * 10) / 10
        },
        dvolPercentile: {
          value: dvolPercentile,
          threshold: `> ${thresholdDvol}%`,
          satisfied: dvolSatisfied,
          weight: OPTIONS_CONFIG.weights.dvolPercentile,
          score: Math.round(dvolScore * 10) / 10
        },
        priceDrawdown: {
          value: Math.round(drawdownValue * 10) / 10,
          threshold: `< -${thresholdDrop}%`,
          satisfied: drawdownSatisfied,
          weight: OPTIONS_CONFIG.weights.priceDrawdown,
          score: Math.round(drawdownScore * 10) / 10
        }
      },
      score: Math.round(weightedScore * 10) / 10,
      params: {
        thresholdFear,
        thresholdDvol,
        thresholdDrop
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('[Options Sell Put] Error:', err.message);
    res.status(500).json({ error: 'Failed to generate options signal' });
  }
});

// Helper: Fetch Fear & Greed Index
async function fetchFearGreed() {
  const cacheKey = 'fear-greed:index';
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Alternative API endpoint
    const url = 'https://api.alternative.me/fng/';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Fear & Greed API ${resp.status}`);
    
    const json = await resp.json();
    const data = json.data?.[0];
    
    if (data) {
      const result = {
        value: parseInt(data.value),
        label: data.value_classification,
        timestamp: data.timestamp
      };
      cache.set(cacheKey, result, 30 * 60 * 1000);  // 30 min cache
      return result;
    }
    return null;
  } catch (err) {
    console.error('[Fear & Greed] Error:', err.message);
    return null;
  }
}

// Helper: Fetch DVOL data
async function fetchDVOL(asset) {
  const cacheKey = `dvol:${asset}:stats`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    // Fetch from Deribit
    const startMs = Date.now() - 365 * 24 * 60 * 60 * 1000;  // 1 year
    const endMs = Date.now();
    const url = `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${asset}&resolution=86400&start_timestamp=${startMs}&end_timestamp=${endMs}`;
    
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Deribit API ${resp.status}`);
    
    const json = await resp.json();
    const data = json.result?.data || [];
    
    if (data.length > 0) {
      // Convert to DVOL values
      const dvols = data.map(p => p[4] / 100);  // Close price as IV
      const current = dvols[dvols.length - 1];
      
      // Calculate percentile
      const belowCount = dvols.filter(d => d < current).length;
      const percentile = Math.round((belowCount / dvols.length) * 100);
      
      const result = { current: Math.round(current * 100), percentile };
      cache.set(cacheKey, result, 60 * 60 * 1000);  // 1 hour cache
      return result;
    }
    return null;
  } catch (err) {
    console.error(`[DVOL] Error for ${asset}:`, err.message);
    return null;
  }
}

// Helper: Fetch price data
async function fetchPriceData(asset, days) {
  const cacheKey = `price:${asset}:${days}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = `https://min-api.cryptocompare.com/data/v2/histoday?fsym=${asset}&tsym=USD&limit=${days}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`CryptoCompare API ${resp.status}`);
    
    const json = await resp.json();
    if (json.Response !== 'Success') throw new Error(json.Message);

    const prices = (json.Data?.Data || [])
      .filter(d => d.close > 0)
      .map(d => ({
        date: new Date(d.time * 1000).toISOString().slice(0, 10),
        price: d.close
      }));

    cache.set(cacheKey, prices, 30 * 60 * 1000);  // 30 min cache
    return prices;
  } catch (err) {
    console.error(`[Price] Error for ${asset}:`, err.message);
    return null;
  }
}

// Helper: Get fear label
function getFearLabel(value) {
  if (value < 20) return '极度恐慌';
  if (value < 40) return '恐慌';
  if (value < 60) return '中性';
  if (value < 80) return '贪婪';
  return '极度贪婪';
}

// Helper: Calculate suggested strike price
function calculateSuggestedStrike(priceData, moneyness) {
  if (!priceData || priceData.length === 0) return null;
  const currentPrice = priceData[priceData.length - 1].price;
  return Math.round(currentPrice * moneyness / 1000) * 1000;  // Round to nearest 1000
}

module.exports = router;
