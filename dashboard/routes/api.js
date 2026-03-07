const express = require('express');
const router = express.Router();
const portfolio = require('../config/portfolio.json');
const cache = require('../cache/store');
const defillama = require('../fetchers/defillama');
const binanceEarn = require('../fetchers/binance-earn');
const okxEarn = require('../fetchers/okx-earn');
const binanceAnn = require('../fetchers/binance-announcements');
const okxAnn = require('../fetchers/okx-announcements');
const { scorePool } = require('../cache/risk-scoring');
const { fetchETFPrices } = require('../fetchers/yahoo-etf');
const deribitOptions = require('../fetchers/deribit-options');
const fearGreed = require('../fetchers/fear-greed');

const ETF_WHITELIST = ['SPY', 'FXI', 'GLD', 'SLV', 'TLT', 'IEF', 'VTI', 'QQQ', 'AGG', 'EEM', 'IBIT'];

// GET /api/etf-prices?symbols=SPY,GLD,TLT&years=5
router.get('/etf-prices', async (req, res) => {
  const raw = (req.query.symbols || 'SPY').toUpperCase();
  const symbols = raw.split(',').map(s => s.trim()).filter(Boolean);
  const years = Math.min(parseInt(req.query.years) || 5, 20);

  const invalid = symbols.filter(s => !ETF_WHITELIST.includes(s));
  if (invalid.length) {
    return res.status(400).json({ error: `Invalid symbols: ${invalid.join(',')}. Allowed: ${ETF_WHITELIST.join(',')}` });
  }

  const results = await Promise.allSettled(
    symbols.map(sym => fetchETFPrices(sym, years))
  );

  const data = {};
  const errors = {};
  symbols.forEach((sym, i) => {
    if (results[i].status === 'fulfilled') {
      data[sym] = results[i].value.prices;
    } else {
      errors[sym] = results[i].reason?.message || 'Unknown error';
    }
  });

  const response = { data, source: 'yahoo-finance' };
  if (Object.keys(errors).length) response.errors = errors;
  res.json(response);
});

// GET /api/health
router.get('/health', (req, res) => {
  const sources = ['defi:pools', 'cefi:binance', 'cefi:okx', 'announcements:binance', 'announcements:okx'];
  const status = {};
  for (const key of sources) {
    const meta = cache.getMeta(key);
    status[key] = meta
      ? { lastUpdate: meta.updatedAt, expired: meta.expired }
      : { lastUpdate: null, expired: true };
  }
  res.json({ ok: true, uptime: process.uptime(), sources: status });
});

// GET /api/portfolio
router.get('/portfolio', (req, res) => {
  const defiData = defillama.getCached();
  const binanceData = binanceEarn.getCached();
  const okxData = okxEarn.getCached();

  const pools = defiData ? [...defiData.portfolioPools, ...(defiData.topStablePools || [])] : [];

  const tiers = portfolio.tiers.map(tier => {
    const positions = tier.positions.map(pos => {
      let liveApy = null;
      let apySource = 'estimate';

      let matchedPoolId = pos.defillamaPool || null;

      if (pos.type === 'defi') {
        const match = defillama.matchPool(pos, pools);
        if (match) {
          liveApy = match.apy || match.apyBase || null;
          apySource = 'live';
          matchedPoolId = match.pool;
        }
      } else if (pos.type === 'cefi') {
        // Try live CeFi rates
        const cefiData = pos.platform === 'binance' ? binanceData : okxData;
        if (cefiData) {
          const match = cefiData.rates.find(r =>
            r.asset === pos.asset || r.asset === pos.asset.split('/')[0]
          );
          if (match) {
            liveApy = match.apy;
            apySource = cefiData.source === 'manual' ? 'manual' : 'live';
          }
        }
      } else if (pos.type === 'reserve') {
        liveApy = 0;
        apySource = 'fixed';
      }

      const apy = liveApy !== null ? liveApy : 0;
      const annualIncome = pos.amount * (apy / 100);

      return {
        ...pos,
        liveApy: liveApy !== null ? Math.round(liveApy * 100) / 100 : null,
        apySource,
        annualIncome: Math.round(annualIncome),
        matchedPoolId,
      };
    });

    const tierIncome = positions.reduce((sum, p) => sum + p.annualIncome, 0);
    const tierWeightedApy = tier.amount > 0
      ? positions.reduce((sum, p) => sum + (p.liveApy || 0) * p.amount, 0) / tier.amount
      : 0;

    return {
      name: tier.name,
      allocation: tier.allocation,
      amount: tier.amount,
      targetApy: tier.targetApy,
      weightedApy: Math.round(tierWeightedApy * 100) / 100,
      annualIncome: Math.round(tierIncome),
      positions,
    };
  });

  const totalIncome = tiers.reduce((sum, t) => sum + t.annualIncome, 0);
  const weightedApy = portfolio.totalCapital > 0
    ? tiers.reduce((sum, t) => sum + t.weightedApy * t.amount, 0) / portfolio.totalCapital
    : 0;

  res.json({
    totalCapital: portfolio.totalCapital,
    weightedApy: Math.round(weightedApy * 100) / 100,
    annualIncome: Math.round(totalIncome),
    tiers,
    lastUpdate: cache.getMeta('defi:pools')?.updatedAt || null,
  });
});

// GET /api/rates/defi
router.get('/rates/defi', (req, res) => {
  const data = defillama.getCached();
  if (!data) {
    return res.json({ pools: [], message: 'Data loading, try again shortly' });
  }
  const pools = data.topStablePools.map(p => {
    const { score, riskLabel } = scorePool(p);
    return {
      pool: p.pool,
      project: p.project,
      symbol: p.symbol,
      chain: p.chain,
      tvl: p.tvlUsd,
      apy: Math.round((p.apy || 0) * 100) / 100,
      apyBase: Math.round((p.apyBase || 0) * 100) / 100,
      apyReward: Math.round((p.apyReward || 0) * 100) / 100,
      riskScore: score,
      riskLabel,
      inPortfolio: isPoolInPortfolio(p),
    };
  });
  res.json({ pools, source: 'defillama', lastUpdate: cache.getMeta('defi:pools')?.updatedAt });
});

// GET /api/rates/cefi
router.get('/rates/cefi', (req, res) => {
  const binance = binanceEarn.getCached() || { rates: [], source: 'unavailable' };
  const okx = okxEarn.getCached() || { rates: [], source: 'unavailable' };
  res.json({
    binance: { rates: binance.rates, source: binance.source },
    okx: { rates: okx.rates, source: okx.source },
    lastUpdate: {
      binance: cache.getMeta('cefi:binance')?.updatedAt,
      okx: cache.getMeta('cefi:okx')?.updatedAt,
    },
  });
});

// GET /api/announcements
router.get('/announcements', (req, res) => {
  const binance = binanceAnn.getCached() || [];
  const okx = okxAnn.getCached() || [];

  // Optional keyword filter
  const keyword = (req.query.keyword || '').toLowerCase();
  const filter = items => keyword
    ? items.filter(a => (a.title || '').toLowerCase().includes(keyword))
    : items;

  res.json({
    binance: filter(binance),
    okx: filter(okx),
    lastUpdate: {
      binance: cache.getMeta('announcements:binance')?.updatedAt,
      okx: cache.getMeta('announcements:okx')?.updatedAt,
    },
  });
});

// GET /api/btc-prices — proxy for BTC historical data
// Uses CryptoCompare (free, up to 2000 days, no key needed)
const BTC_CACHE_KEY = 'btc:prices';
const BTC_CACHE_TTL = 60 * 60 * 1000; // 1 hour

router.get('/btc-prices', async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 365, 2000);

  // Check cache — return if we have enough data
  const cached = cache.get(BTC_CACHE_KEY);
  if (cached && cached.days >= days) {
    return res.json({ prices: cached.prices, source: 'cache' });
  }

  try {
    // CryptoCompare histoday: free, reliable, up to 2000 days
    const url = `https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=${days}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`CryptoCompare API ${resp.status}`);
    const json = await resp.json();
    if (json.Response !== 'Success') throw new Error(json.Message || 'CryptoCompare error');

    const prices = (json.Data?.Data || [])
      .filter(d => d.close > 0)
      .map(d => ({
        date: new Date(d.time * 1000).toISOString().slice(0, 10),
        price: d.close,
      }));

    cache.set(BTC_CACHE_KEY, { prices, days }, BTC_CACHE_TTL);
    console.log(`[BTC Proxy] Fetched ${prices.length} daily prices from CryptoCompare (days=${days})`);
    res.json({ prices, source: 'cryptocompare' });
  } catch (err) {
    console.error('[BTC Proxy] Error:', err.message);
    const stale = cache.get(BTC_CACHE_KEY);
    if (stale) {
      return res.json({ prices: stale.prices, source: 'stale-cache' });
    }
    res.status(502).json({ error: err.message });
  }
});

// GET /api/crypto-prices?asset=BTC&days=365 — generic crypto price proxy
const CRYPTO_CACHE_TTL = 60 * 60 * 1000; // 1 hour

router.get('/crypto-prices', async (req, res) => {
  const asset = (req.query.asset || 'BTC').toUpperCase();
  if (!['BTC', 'ETH'].includes(asset)) {
    return res.status(400).json({ error: 'Supported assets: BTC, ETH' });
  }
  const days = Math.min(parseInt(req.query.days) || 365, 2000);
  const cacheKey = `crypto:${asset}:prices`;

  const cached = cache.get(cacheKey);
  if (cached && cached.days >= days) {
    return res.json({ prices: cached.prices, source: 'cache' });
  }

  try {
    const url = `https://min-api.cryptocompare.com/data/v2/histoday?fsym=${asset}&tsym=USD&limit=${days}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`CryptoCompare API ${resp.status}`);
    const json = await resp.json();
    if (json.Response !== 'Success') throw new Error(json.Message || 'CryptoCompare error');

    const prices = (json.Data?.Data || [])
      .filter(d => d.close > 0)
      .map(d => ({
        date: new Date(d.time * 1000).toISOString().slice(0, 10),
        price: d.close,
      }));

    cache.set(cacheKey, { prices, days }, CRYPTO_CACHE_TTL);
    console.log(`[${asset} Proxy] Fetched ${prices.length} daily prices from CryptoCompare (days=${days})`);
    res.json({ prices, source: 'cryptocompare' });
  } catch (err) {
    console.error(`[${asset} Proxy] Error:`, err.message);
    const stale = cache.get(cacheKey);
    if (stale) return res.json({ prices: stale.prices, source: 'stale-cache' });
    res.status(502).json({ error: err.message });
  }
});

// GET /api/crypto-dvol?asset=BTC — generic Deribit DVOL proxy (BTC/ETH)
const DVOL_CACHE_TTL_GENERIC = 60 * 60 * 1000; // 1 hour

router.get('/crypto-dvol', async (req, res) => {
  const asset = (req.query.asset || 'BTC').toUpperCase();
  if (!['BTC', 'ETH'].includes(asset)) {
    return res.status(400).json({ error: 'Supported assets: BTC, ETH' });
  }
  const cacheKey = `dvol:${asset}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    return res.json({ dvol: cached, source: 'cache' });
  }

  try {
    // ETH DVOL available from ~2021-06, BTC from ~2021-03
    const startMs = new Date('2021-01-01').getTime();
    const nowMs = Date.now();
    const chunkSize = 365 * 86400 * 1000;
    const allData = [];
    const delay = ms => new Promise(r => setTimeout(r, ms));

    for (let from = startMs; from < nowMs; from += chunkSize) {
      const to = Math.min(from + chunkSize, nowMs);
      const url = `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=${asset}&resolution=86400&start_timestamp=${from}&end_timestamp=${to}`;
      try {
        const resp = await fetch(url);
        if (!resp.ok) { await delay(500); continue; }
        const json = await resp.json();
        const points = json.result?.data || [];
        allData.push(...points);
      } catch (e) {
        console.error(`[${asset} DVOL] Chunk error: ${e.message}`);
      }
      if (from + chunkSize < nowMs) await delay(300);
    }

    const seen = new Set();
    const dvol = allData
      .map(p => ({
        date: new Date(p[0]).toISOString().slice(0, 10),
        iv: p[4] / 100,
      }))
      .filter(p => { if (seen.has(p.date)) return false; seen.add(p.date); return true; })
      .sort((a, b) => a.date.localeCompare(b.date));

    cache.set(cacheKey, dvol, DVOL_CACHE_TTL_GENERIC);
    console.log(`[${asset} DVOL] Fetched ${dvol.length} daily IV points from Deribit (${dvol[0]?.date} → ${dvol[dvol.length-1]?.date})`);
    res.json({ dvol, source: 'deribit' });
  } catch (err) {
    console.error(`[${asset} DVOL] Error:`, err.message);
    const stale = cache.get(cacheKey);
    if (stale) return res.json({ dvol: stale, source: 'stale-cache' });
    res.status(502).json({ error: err.message });
  }
});

// GET /api/btc-dvol — Deribit DVOL (BTC implied volatility index)
// Free, no auth, daily data from ~2021-03
const DVOL_CACHE_KEY = 'btc:dvol';
const DVOL_CACHE_TTL = 60 * 60 * 1000; // 1 hour

router.get('/btc-dvol', async (req, res) => {
  const cached = cache.get(DVOL_CACHE_KEY);
  if (cached) {
    return res.json({ dvol: cached, source: 'cache' });
  }

  try {
    // Fetch from 2021-01-01 to now in chunks with delay
    const startMs = new Date('2021-01-01').getTime();
    const nowMs = Date.now();
    const chunkSize = 365 * 86400 * 1000; // 1 year per chunk
    const allData = [];
    const delay = ms => new Promise(r => setTimeout(r, ms));

    for (let from = startMs; from < nowMs; from += chunkSize) {
      const to = Math.min(from + chunkSize, nowMs);
      const url = `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&resolution=86400&start_timestamp=${from}&end_timestamp=${to}`;
      try {
        const resp = await fetch(url);
        if (!resp.ok) { await delay(500); continue; }
        const json = await resp.json();
        const points = json.result?.data || [];
        allData.push(...points);
      } catch (e) {
        console.error(`[BTC DVOL] Chunk error: ${e.message}`);
      }
      if (from + chunkSize < nowMs) await delay(300); // rate limit
    }

    // Convert: [timestamp, open, high, low, close] → {date, iv}
    const seen = new Set();
    const dvol = allData
      .map(p => ({
        date: new Date(p[0]).toISOString().slice(0, 10),
        iv: p[4] / 100, // DVOL is in %, convert to decimal (e.g. 60% → 0.60)
      }))
      .filter(p => { if (seen.has(p.date)) return false; seen.add(p.date); return true; })
      .sort((a, b) => a.date.localeCompare(b.date));

    cache.set(DVOL_CACHE_KEY, dvol, DVOL_CACHE_TTL);
    console.log(`[BTC DVOL] Fetched ${dvol.length} daily IV points from Deribit (${dvol[0]?.date} → ${dvol[dvol.length-1]?.date})`);
    res.json({ dvol, source: 'deribit' });
  } catch (err) {
    console.error('[BTC DVOL] Error:', err.message);
    const stale = cache.get(DVOL_CACHE_KEY);
    if (stale) return res.json({ dvol: stale, source: 'stale-cache' });
    res.status(502).json({ error: err.message });
  }
});

// GET /api/options — all BTC Put options + spot + fear & greed
router.get('/options', async (req, res) => {
  let data = deribitOptions.getCached();
  if (!data) {
    data = await deribitOptions.fetchOptions();
  }
  const fng = fearGreed.getCached();
  res.json({
    btcSpot: data.btcSpot,
    expirations: data.expirations,
    totalPuts: data.totalPuts,
    fearGreed: fng?.current || null,
    lastUpdate: cache.getMeta('options:deribit')?.updatedAt || null,
  });
});

// GET /api/options/detail?instrument=BTC-28MAR26-80000-P
router.get('/options/detail', async (req, res) => {
  const instrument = req.query.instrument;
  if (!instrument) {
    return res.status(400).json({ error: 'Missing instrument parameter' });
  }
  const detail = await deribitOptions.fetchOptionDetail(instrument);
  if (!detail) {
    return res.status(502).json({ error: 'Failed to fetch option detail' });
  }
  res.json(detail);
});

// GET /api/timing — composite timing score for Sell Put
router.get('/timing', async (req, res) => {
  try {
    // 1. Fear & Greed signal
    let fng = fearGreed.getCached();
    if (!fng) fng = await fearGreed.fetchFearGreed();
    const fngValue = fng?.current?.value ?? 50;
    // Lower F&G = more fear = better for selling puts (inverted score)
    const fngScore = Math.round(100 - fngValue);

    // 2. IV Percentile (DVOL rank over past year)
    const dvolData = cache.get('btc:dvol');
    let ivPercentile = 50;
    let currentDvol = null;
    if (dvolData && dvolData.length > 30) {
      const recent = dvolData.slice(-365);
      currentDvol = recent[recent.length - 1]?.iv;
      if (currentDvol != null) {
        const belowCount = recent.filter(d => d.iv < currentDvol).length;
        ivPercentile = Math.round((belowCount / recent.length) * 100);
      }
    }

    // 3. VRP (IV - RV): use DVOL as IV, compute 30-day RV from BTC prices
    const btcData = cache.get('btc:prices');
    let vrp = 0;
    let rv = null;
    if (btcData?.prices?.length > 31 && currentDvol != null) {
      const prices = btcData.prices.slice(-31);
      const returns = [];
      for (let i = 1; i < prices.length; i++) {
        returns.push(Math.log(prices[i].price / prices[i - 1].price));
      }
      const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
      rv = Math.sqrt(variance * 365);
      vrp = currentDvol - rv;
    }
    // VRP score: positive VRP means premium is rich, scale to 0-100
    const vrpScore = Math.min(100, Math.max(0, Math.round(50 + vrp * 200)));

    // Composite: equal weight
    const score = Math.round((fngScore + ivPercentile + vrpScore) / 3);
    const label = score >= 75 ? 'Favorable' : score >= 50 ? 'Neutral' : 'Unfavorable';

    res.json({
      score,
      label,
      signals: {
        fearGreed: { value: fngValue, score: fngScore, label: fng?.current?.label || 'N/A' },
        ivPercentile: { value: currentDvol != null ? Math.round(currentDvol * 10000) / 100 : null, percentile: ivPercentile },
        vrp: { iv: currentDvol != null ? Math.round(currentDvol * 10000) / 100 : null, rv: rv != null ? Math.round(rv * 10000) / 100 : null, spread: vrp != null ? Math.round(vrp * 10000) / 100 : null, score: vrpScore },
      },
    });
  } catch (err) {
    console.error('[Timing] Error:', err.message);
    res.status(500).json({ error: 'Failed to compute timing score' });
  }
});

function isPoolInPortfolio(pool) {
  for (const tier of portfolio.tiers) {
    for (const pos of tier.positions) {
      if (pos.defillamaPool && pos.defillamaPool === pool.pool) return true;
      if (pos.defillamaProject === (pool.project || '').toLowerCase() &&
          pos.chain && pos.chain.toLowerCase() === (pool.chain || '').toLowerCase()) return true;
    }
  }
  return false;
}

module.exports = router;
