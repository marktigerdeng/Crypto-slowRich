const express = require('express');
const router = express.Router();
const portfolio = require('../config/portfolio.json');
const allweatherConfig = require('../config/allweather.json');
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
const portfolioHistory = require('../cache/portfolio-history');

// Import V2 API routes
const apiV2Router = require('./api-v2');

// Mount V2 API at /v2/signals
router.use('/v2/signals', apiV2Router);

const ETF_WHITELIST = ['SPY', 'FXI', 'GLD', 'SLV', 'TLT', 'IEF', 'VTI', 'QQQ', 'AGG', 'EEM', 'IBIT',
  'NVDA', 'AVGO', 'TSM', 'VST', 'ANET', 'MSFT', 'BRK-B', 'KO', 'AAPL', 'GOOGL', 'META', 'AMZN',
  'UNH', 'JPM', 'KWEB', 'EWH', 'COPX', 'USO', 'DBA'];

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
  const metadata = {};
  symbols.forEach((sym, i) => {
    if (results[i].status === 'fulfilled') {
      data[sym] = results[i].value.prices;
      if (results[i].value.launchDate) {
        metadata[sym] = { launchDate: results[i].value.launchDate };
      }
    } else {
      errors[sym] = results[i].reason?.message || 'Unknown error';
    }
  });

  const response = { data, source: 'yahoo-finance' };
  if (Object.keys(errors).length) response.errors = errors;
  if (Object.keys(metadata).length) response.metadata = metadata;
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
  res.json(buildPortfolioSummary());
});

// Build portfolio summary object (shared by /api/portfolio and /api/portfolio/summary)
function buildPortfolioSummary() {
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

  return {
    totalCapital: portfolio.totalCapital,
    weightedApy: Math.round(weightedApy * 100) / 100,
    annualIncome: Math.round(totalIncome),
    tiers,
    lastUpdate: cache.getMeta('defi:pools')?.updatedAt || null,
  };
}

// GET /api/portfolio/summary — aggregated summary with 7-day trend
router.get('/portfolio/summary', (req, res) => {
  const summary = buildPortfolioSummary();
  const hours = Math.min(parseInt(req.query.hours) || 168, 168);
  const history = portfolioHistory.getHistory(hours);

  // Per-protocol breakdown
  const protocols = [];
  for (const tier of summary.tiers) {
    for (const pos of tier.positions) {
      protocols.push({
        id: pos.id,
        protocol: pos.protocol,
        product: pos.product,
        chain: pos.chain || 'CeFi',
        asset: pos.asset,
        amount: pos.amount,
        liveApy: pos.liveApy,
        apySource: pos.apySource,
        annualIncome: pos.annualIncome,
        tier: tier.name,
        riskLevel: pos.riskLevel,
      });
    }
  }

  // Chain allocation breakdown
  const chainAlloc = {};
  for (const p of protocols) {
    const chain = p.chain || 'Other';
    chainAlloc[chain] = (chainAlloc[chain] || 0) + p.amount;
  }

  // Risk distribution
  const riskDist = {};
  for (const p of protocols) {
    const risk = p.riskLevel || 'unknown';
    riskDist[risk] = (riskDist[risk] || 0) + p.amount;
  }

  res.json({
    totalCapital: summary.totalCapital,
    weightedApy: summary.weightedApy,
    annualIncome: summary.annualIncome,
    monthlyIncome: Math.round(summary.annualIncome / 12),
    dailyIncome: Math.round(summary.annualIncome / 365),
    tiers: summary.tiers.map(t => ({
      name: t.name,
      amount: t.amount,
      allocation: t.allocation,
      weightedApy: t.weightedApy,
      annualIncome: t.annualIncome,
      positionCount: t.positions.length,
    })),
    protocols,
    chainAllocation: chainAlloc,
    riskDistribution: riskDist,
    trend: history.map(s => ({
      ts: s.ts,
      date: new Date(s.ts).toISOString(),
      weightedApy: s.weightedApy,
      annualIncome: s.annualIncome,
    })),
    lastUpdate: summary.lastUpdate,
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
  const SUPPORTED = ['BTC','ETH','SOL','DOGE','ADA','XRP','DOT','AVAX','LINK','MATIC',
    'UNI','LTC','BCH','FIL','SAND','MANA','ATOM','FTM','ALGO','TRX','EOS','XLM',
    'NEAR','ICP','SHIB','APE','OP','ARB'];
  if (!SUPPORTED.includes(asset)) {
    return res.status(400).json({ error: 'Unsupported asset: ' + asset });
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
        high: d.high,
        low: d.low,
        open: d.open,
        volume: d.volumeto,  // USD volume
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

// Helper: ensure BTC DVOL data is in cache (fetch if missing)
async function ensureBTCDvol() {
  let data = cache.get('btc:dvol');
  if (data) return data;
  try {
    const startMs = new Date('2021-01-01').getTime();
    const nowMs = Date.now();
    const chunkSize = 365 * 86400 * 1000;
    const allData = [];
    const delay = ms => new Promise(r => setTimeout(r, ms));
    for (let from = startMs; from < nowMs; from += chunkSize) {
      const to = Math.min(from + chunkSize, nowMs);
      const url = `https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&resolution=86400&start_timestamp=${from}&end_timestamp=${to}`;
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const json = await resp.json();
          allData.push(...(json.result?.data || []));
        }
      } catch (e) { /* skip chunk */ }
      if (from + chunkSize < nowMs) await delay(300);
    }
    const seen = new Set();
    const dvol = allData
      .map(p => ({ date: new Date(p[0]).toISOString().slice(0, 10), iv: p[4] / 100 }))
      .filter(p => { if (seen.has(p.date)) return false; seen.add(p.date); return true; })
      .sort((a, b) => a.date.localeCompare(b.date));
    if (dvol.length > 0) {
      cache.set('btc:dvol', dvol, 60 * 60 * 1000);
      console.log(`[ensureBTCDvol] Fetched ${dvol.length} DVOL points`);
    }
    return dvol;
  } catch (err) {
    console.error('[ensureBTCDvol] Error:', err.message);
    return [];
  }
}

// Helper: ensure BTC price data is in cache (fetch if missing)
async function ensureBTCPrices() {
  let data = cache.get('btc:prices');
  if (data?.prices?.length > 31) return data;
  try {
    const url = 'https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=365';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`CryptoCompare API ${resp.status}`);
    const json = await resp.json();
    if (json.Response !== 'Success') throw new Error(json.Message || 'CryptoCompare error');
    const prices = (json.Data?.Data || [])
      .filter(d => d.close > 0)
      .map(d => ({ date: new Date(d.time * 1000).toISOString().slice(0, 10), price: d.close }));
    const result = { prices, days: 365 };
    cache.set('btc:prices', result, 60 * 60 * 1000);
    console.log(`[ensureBTCPrices] Fetched ${prices.length} daily prices`);
    return result;
  } catch (err) {
    console.error('[ensureBTCPrices] Error:', err.message);
    return { prices: [] };
  }
}

// GET /api/timing — composite timing score for Sell Put
// Query params:
//   vrpPeriod=7|30 — which realized volatility period to use for VRP (default: 30)
router.get('/timing', async (req, res) => {
  try {
    const vrpPeriod = parseInt(req.query.vrpPeriod) || 30;
    if (![7, 30].includes(vrpPeriod)) {
      return res.status(400).json({ error: 'vrpPeriod must be 7 or 30' });
    }

    // 1. Fear & Greed signal
    let fng = fearGreed.getCached();
    if (!fng) fng = await fearGreed.fetchFearGreed();
    const fngValue = fng?.current?.value ?? 50;
    // Lower F&G = more fear = better for selling puts (inverted score)
    const fngScore = Math.round(100 - fngValue);

    // 2. IV Percentile (DVOL rank over past year)
    const dvolData = await ensureBTCDvol();
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

    // 3. VRP (IV - RV): use DVOL as IV, compute realized volatility from BTC prices
    const btcData = await ensureBTCPrices();
    let vrp = 0;
    let rv30 = null;
    let rv7 = null;

    function computeRV(pricesArr, days) {
      if (!pricesArr || pricesArr.length < days + 1) return null;
      const slice = pricesArr.slice(-(days + 1));
      const returns = [];
      for (let i = 1; i < slice.length; i++) {
        returns.push(Math.log(slice[i].price / slice[i - 1].price));
      }
      const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
      return Math.sqrt(variance * 365);
    }

    if (btcData?.prices?.length > 31 && currentDvol != null) {
      rv30 = computeRV(btcData.prices, 30);
      rv7 = computeRV(btcData.prices, 7);
      // Use requested period for primary VRP
      const rv = vrpPeriod === 7 ? rv7 : rv30;
      if (rv != null) vrp = currentDvol - rv;
    }
    // VRP score: positive VRP means premium is rich, scale to 0-100
    const vrpScore = Math.min(100, Math.max(0, Math.round(50 + vrp * 200)));

    // Composite: equal weight
    const score = Math.round((fngScore + ivPercentile + vrpScore) / 3);
    const label = score >= 75 ? 'Favorable' : score >= 50 ? 'Neutral' : 'Unfavorable';

    res.json({
      score,
      label,
      vrpPeriod,
      signals: {
        fearGreed: { value: fngValue, score: fngScore, label: fng?.current?.label || 'N/A' },
        ivPercentile: { value: currentDvol != null ? Math.round(currentDvol * 10000) / 100 : null, percentile: ivPercentile },
        vrp: {
          iv: currentDvol != null ? Math.round(currentDvol * 10000) / 100 : null,
          rv30: rv30 != null ? Math.round(rv30 * 10000) / 100 : null,
          rv7: rv7 != null ? Math.round(rv7 * 10000) / 100 : null,
          rv: vrpPeriod === 7 ? (rv7 != null ? Math.round(rv7 * 10000) / 100 : null) : (rv30 != null ? Math.round(rv30 * 10000) / 100 : null),
          spread: vrp != null ? Math.round(vrp * 10000) / 100 : null,
          score: vrpScore,
        },
      },
    });
  } catch (err) {
    console.error('[Timing] Error:', err.message);
    res.status(500).json({ error: 'Failed to compute timing score' });
  }
});

// GET /api/cta-signal?asset=BTC&shortPeriod=20&longPeriod=50
// CTA Dual Moving Average signal: golden cross / death cross
router.get('/cta-signal', async (req, res) => {
  const asset = (req.query.asset || 'BTC').toUpperCase();
  if (!['BTC', 'ETH'].includes(asset)) {
    return res.status(400).json({ error: 'Supported assets: BTC, ETH' });
  }
  const shortPeriod = Math.max(5, Math.min(100, parseInt(req.query.shortPeriod) || 20));
  const longPeriod = Math.max(10, Math.min(200, parseInt(req.query.longPeriod) || 50));

  if (shortPeriod >= longPeriod) {
    return res.status(400).json({ error: 'shortPeriod must be less than longPeriod' });
  }

  // Need at least longPeriod + 1 days to detect cross
  const daysNeeded = longPeriod + 10;
  const cacheKey = `crypto:${asset}:prices`;

  try {
    let priceData = cache.get(cacheKey);
    if (!priceData || !priceData.prices || priceData.prices.length < daysNeeded) {
      // Fetch fresh data
      const url = `https://min-api.cryptocompare.com/data/v2/histoday?fsym=${asset}&tsym=USD&limit=${Math.max(daysNeeded, 365)}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`CryptoCompare API ${resp.status}`);
      const json = await resp.json();
      if (json.Response !== 'Success') throw new Error(json.Message || 'CryptoCompare error');

      const prices = (json.Data?.Data || [])
        .filter(d => d.close > 0)
        .map(d => ({ date: new Date(d.time * 1000).toISOString().slice(0, 10), price: d.close }));
      priceData = { prices, days: Math.max(daysNeeded, 365) };
      cache.set(cacheKey, priceData, 60 * 60 * 1000);
    }

    const prices = priceData.prices;
    if (prices.length < longPeriod) {
      return res.status(400).json({ error: 'Insufficient price data' });
    }

    // Compute SMAs
    function sma(arr, period, idx) {
      if (idx < period - 1) return null;
      let sum = 0;
      for (let i = idx - period + 1; i <= idx; i++) sum += arr[i].price;
      return sum / period;
    }

    const len = prices.length;
    const currentPrice = prices[len - 1].price;
    const currentDate = prices[len - 1].date;

    const shortSMA = sma(prices, shortPeriod, len - 1);
    const longSMA = sma(prices, longPeriod, len - 1);
    const prevShortSMA = sma(prices, shortPeriod, len - 2);
    const prevLongSMA = sma(prices, longPeriod, len - 2);

    // Determine signal
    let signal = 'neutral';
    let signalLabel = '观望';
    let signalColor = 'gray';

    if (shortSMA !== null && longSMA !== null && prevShortSMA !== null && prevLongSMA !== null) {
      const aboveNow = shortSMA > longSMA;
      const abovePrev = prevShortSMA > prevLongSMA;

      if (aboveNow && !abovePrev) {
        signal = 'golden_cross';
        signalLabel = '金叉 (做多)';
        signalColor = 'green';
      } else if (!aboveNow && abovePrev) {
        signal = 'death_cross';
        signalLabel = '死叉 (做空)';
        signalColor = 'red';
      } else if (aboveNow) {
        signal = 'bullish';
        signalLabel = '多头排列';
        signalColor = 'green';
      } else {
        signal = 'bearish';
        signalLabel = '空头排列';
        signalColor = 'red';
      }
    }

    // Recent SMA history for chart (configurable, default 120)
    const historyDays = Math.max(60, Math.min(365, parseInt(req.query.historyDays) || 120));
    const historyLen = Math.min(historyDays, len);
    const history = [];
    const crossovers = [];
    for (let i = len - historyLen; i < len; i++) {
      const s = sma(prices, shortPeriod, i);
      const l = sma(prices, longPeriod, i);
      history.push({
        date: prices[i].date,
        price: prices[i].price,
        shortSMA: s,
        longSMA: l,
      });
      // Detect crossover
      if (i > len - historyLen) {
        const prevS = sma(prices, shortPeriod, i - 1);
        const prevL = sma(prices, longPeriod, i - 1);
        if (s != null && l != null && prevS != null && prevL != null) {
          const aboveNow = s > l;
          const abovePrev = prevS > prevL;
          if (aboveNow && !abovePrev) {
            crossovers.push({ date: prices[i].date, type: 'golden', price: prices[i].price, index: history.length - 1 });
          } else if (!aboveNow && abovePrev) {
            crossovers.push({ date: prices[i].date, type: 'death', price: prices[i].price, index: history.length - 1 });
          }
        }
      }
    }

    res.json({
      asset,
      currentPrice: Math.round(currentPrice * 100) / 100,
      currentDate,
      shortPeriod,
      longPeriod,
      shortSMA: shortSMA !== null ? Math.round(shortSMA * 100) / 100 : null,
      longSMA: longSMA !== null ? Math.round(longSMA * 100) / 100 : null,
      signal,
      signalLabel,
      signalColor,
      history,
      crossovers,
    });
  } catch (err) {
    console.error(`[CTA ${asset}] Error:`, err.message);
    res.status(502).json({ error: err.message });
  }
});

// ═══════════ Delta Neutral Strategy APIs ═══════════

// GET /api/funding-rates — major exchange perpetual funding rates
const FUNDING_CACHE_KEY = 'delta:funding-rates';
const FUNDING_CACHE_TTL = 5 * 60 * 1000; // 5 min

router.get('/funding-rates', async (req, res) => {
  const cached = cache.get(FUNDING_CACHE_KEY);
  if (cached) return res.json({ rates: cached, source: 'cache' });

  try {
    // Fetch from Binance, OKX (multi-coin), Bybit (multi-coin) in parallel
    const OKX_COINS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP', 'ADA', 'AVAX'];
    const BYBIT_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'DOGEUSDT', 'XRPUSDT'];

    const okxFetches = OKX_COINS.map(coin =>
      fetch(`https://www.okx.com/api/v5/public/funding-rate?instId=${coin}-USDT-SWAP`)
        .then(r => r.ok ? r.json() : { data: [] })
        .catch(() => ({ data: [] }))
    );
    const bybitFetches = BYBIT_COINS.map(sym =>
      fetch(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${sym}`)
        .then(r => r.ok ? r.json() : { result: { list: [] } })
        .catch(() => ({ result: { list: [] } }))
    );

    const [binanceRes, ...rest] = await Promise.allSettled([
      fetch('https://fapi.binance.com/fapi/v1/premiumIndex').then(r => r.ok ? r.json() : []),
      ...okxFetches,
      ...bybitFetches,
    ]);

    const okxResults = rest.slice(0, OKX_COINS.length);
    const bybitResults = rest.slice(OKX_COINS.length);

    const rates = [];

    // Binance funding rates — take ALL USDT perps, then keep top positive + top negative + key coins
    if (binanceRes.status === 'fulfilled' && Array.isArray(binanceRes.value)) {
      const KEY_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT']);
      const allBinance = binanceRes.value
        .filter(item => item.symbol.endsWith('USDT') && item.lastFundingRate != null)
        .map(item => ({
          symbol: item.symbol.replace('USDT', ''),
          exchange: 'Binance',
          rate: parseFloat(item.lastFundingRate),
          ratePercent: (parseFloat(item.lastFundingRate) * 100).toFixed(4),
          markPrice: parseFloat(item.markPrice),
          nextFundingTime: item.nextFundingTime,
          _isKey: KEY_SYMBOLS.has(item.symbol),
        }));

      // Always include key coins + top 10 positive + top 10 negative by rate
      const keyed = allBinance.filter(r => r._isKey);
      const topPos = allBinance.filter(r => r.rate > 0 && !r._isKey).sort((a, b) => b.rate - a.rate).slice(0, 10);
      const topNeg = allBinance.filter(r => r.rate < 0 && !r._isKey).sort((a, b) => a.rate - b.rate).slice(0, 10);

      const seen = new Set();
      for (const r of [...keyed, ...topPos, ...topNeg]) {
        if (!seen.has(r.symbol + r.exchange)) {
          seen.add(r.symbol + r.exchange);
          delete r._isKey;
          rates.push(r);
        }
      }
    }

    // OKX funding rates (multi-coin)
    OKX_COINS.forEach((coin, i) => {
      const res = okxResults[i];
      if (res.status === 'fulfilled' && res.value?.data?.length > 0) {
        const d = res.value.data[0];
        rates.push({
          symbol: coin,
          exchange: 'OKX',
          rate: parseFloat(d.fundingRate),
          ratePercent: (parseFloat(d.fundingRate) * 100).toFixed(4),
          nextFundingTime: parseInt(d.nextFundingTime),
        });
      }
    });

    // Bybit funding rates (multi-coin)
    BYBIT_COINS.forEach((sym, i) => {
      const res = bybitResults[i];
      if (res.status === 'fulfilled' && res.value?.result?.list?.length > 0) {
        const d = res.value.result.list[0];
        if (d.fundingRate) {
          rates.push({
            symbol: sym.replace('USDT', ''),
            exchange: 'Bybit',
            rate: parseFloat(d.fundingRate),
            ratePercent: (parseFloat(d.fundingRate) * 100).toFixed(4),
            markPrice: parseFloat(d.markPrice || 0),
          });
        }
      }
    });

    // If no live data, use simulated data
    if (rates.length === 0) {
      const simRates = [
        { symbol: 'BTC', exchange: 'Binance', rate: 0.0001, ratePercent: '0.0100', markPrice: 85000 },
        { symbol: 'ETH', exchange: 'Binance', rate: 0.00008, ratePercent: '0.0080', markPrice: 3200 },
        { symbol: 'SOL', exchange: 'Binance', rate: 0.00015, ratePercent: '0.0150', markPrice: 180 },
        { symbol: 'BTC', exchange: 'OKX', rate: 0.00012, ratePercent: '0.0120' },
        { symbol: 'BTC', exchange: 'Bybit', rate: 0.00009, ratePercent: '0.0090' },
        { symbol: 'ETH', exchange: 'OKX', rate: 0.00007, ratePercent: '0.0070' },
        { symbol: 'SOL', exchange: 'Bybit', rate: -0.00003, ratePercent: '-0.0030' },
        { symbol: 'DOGE', exchange: 'Binance', rate: 0.00025, ratePercent: '0.0250' },
      ];
      cache.set(FUNDING_CACHE_KEY, simRates, FUNDING_CACHE_TTL);
      return res.json({ rates: simRates, source: 'simulated' });
    }

    // Sort by absolute rate descending
    rates.sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));
    cache.set(FUNDING_CACHE_KEY, rates, FUNDING_CACHE_TTL);
    console.log(`[Funding Rates] Fetched ${rates.length} rates from exchanges`);
    res.json({ rates, source: 'live' });
  } catch (err) {
    console.error('[Funding Rates] Error:', err.message);
    const stale = cache.get(FUNDING_CACHE_KEY);
    if (stale) return res.json({ rates: stale, source: 'stale-cache' });
    res.status(502).json({ error: err.message });
  }
});

// GET /api/jlp-stats — JLP price, APR, composition
// Uses CoinGecko for prices + DeFiLlama for APR
const JLP_CACHE_KEY = 'delta:jlp';
const JLP_CACHE_TTL = 5 * 60 * 1000;

// JLP component CoinGecko IDs (weights fetched live from market caps)
const JLP_COMPONENT_IDS = [
  { asset: 'SOL', coingeckoId: 'solana' },
  { asset: 'ETH', coingeckoId: 'ethereum' },
  { asset: 'WBTC', coingeckoId: 'bitcoin' },
  { asset: 'USDC', coingeckoId: 'usd-coin' },
];

const JLP_COINGECKO_ID = 'jupiter-perpetuals-liquidity-provider-token';
// DeFiLlama pool ID for JLP (jupiter-lend, largest TVL pool)
const JLP_DEFILLAMA_POOL = 'cf41a15b-eb6a-46de-bc2b-cf4d0a58569c';

router.get('/jlp-stats', async (req, res) => {
  const cached = cache.get(JLP_CACHE_KEY);
  if (cached) return res.json({ ...cached, source: 'cache' });

  try {
    // Single CoinGecko call for JLP + all components (saves rate limit quota)
    // Add small delay to avoid hitting CoinGecko rate limit during startup burst
    const allCgIds = [JLP_COINGECKO_ID, ...JLP_COMPONENT_IDS.map(c => c.coingeckoId)].join(',');
    const [cgRes, llamaRes] = await Promise.allSettled([
      new Promise(resolve => setTimeout(resolve, 3000)).then(() =>
        fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${allCgIds}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`)
          .then(r => r.ok ? r.json() : null)),
      // DeFiLlama for APR + TVL
      fetch(`https://yields.llama.fi/chart/${JLP_DEFILLAMA_POOL}`)
        .then(r => r.ok ? r.json() : null),
    ]);

    const cgData = cgRes.status === 'fulfilled' ? cgRes.value : null;
    const jlpCgData = cgData ? { [JLP_COINGECKO_ID]: cgData[JLP_COINGECKO_ID] } : null;
    const llamaData = llamaRes.status === 'fulfilled' ? llamaRes.value : null;

    // Composition weights: use DeFiLlama pool data if available, else estimate from perps-api
    let compositionWeights = null;

    // Try Jupiter perps-api pool-info for utilization data per custody
    const custodyMints = {
      SOL: 'So11111111111111111111111111111111111111112',
      ETH: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
      WBTC: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
    };

    // Build composition with real prices
    const composition = JLP_COMPONENT_IDS.map(comp => {
      const priceData = cgData?.[comp.coingeckoId];
      return {
        asset: comp.asset,
        weight: compositionWeights?.[comp.asset] ?? null,
        price: priceData?.usd ?? (comp.asset === 'USDC' || comp.asset === 'USDT' ? 1.0 : null),
        change24h: priceData?.usd_24h_change ?? null,
      };
    });

    // If no live weights, estimate from JLP pool composition (target weights from Jupiter docs)
    // These update slowly so hardcoded is acceptable as fallback
    const FALLBACK_WEIGHTS = { SOL: 0.4409, ETH: 0.0804, WBTC: 0.1564, USDC: 0.3223 };
    for (const c of composition) {
      if (c.weight == null) c.weight = FALLBACK_WEIGHTS[c.asset] || 0;
    }

    // Determine JLP price from CoinGecko
    let jlpPrice = null;
    let dataSource = 'estimated';

    const jlpTokenData = jlpCgData?.[JLP_COINGECKO_ID];
    if (jlpTokenData?.usd != null && jlpTokenData.usd >= 0.5 && jlpTokenData.usd <= 10.0) {
      jlpPrice = jlpTokenData.usd;
      dataSource = 'coingecko';
    }

    // Fallback: weighted basket estimation
    if (jlpPrice == null) {
      const basketValue = composition.reduce((sum, c) => {
        if (c.price != null) return sum + c.weight * c.price;
        return sum;
      }, 0);
      if (basketValue > 0) {
        jlpPrice = basketValue / 3930;
        jlpPrice = Math.max(1.0, Math.min(10.0, jlpPrice));
        dataSource = 'estimated';
      }
    }

    // 24h change
    let change24h = 0;
    if (jlpTokenData?.usd_24h_change != null) {
      change24h = jlpTokenData.usd_24h_change;
    } else if (cgData) {
      change24h = composition.reduce((sum, c) => sum + c.weight * (c.change24h || 0), 0);
    }

    // APR: priority — DeFiLlama pool data > 7d price appreciation > fallback
    let apr7d = null;
    let aprSource = 'estimated';

    // 1. DeFiLlama chart data — get latest APY from the pool
    if (llamaData?.data && llamaData.data.length > 0) {
      const recent = llamaData.data.slice(-7);
      const avgApy = recent.reduce((s, d) => s + (d.apy || 0), 0) / recent.length;
      if (avgApy > 0) {
        apr7d = avgApy;
        aprSource = 'defillama';
      }
    }

    if (apr7d == null) {
      apr7d = 8.0;
      aprSource = 'estimated';
    }

    // TVL: from DeFiLlama or CoinGecko market cap
    let totalValue = null;
    if (llamaData?.data?.length > 0) {
      totalValue = llamaData.data[llamaData.data.length - 1]?.tvlUsd || null;
    }
    if (totalValue == null && jlpTokenData?.usd_market_cap) {
      totalValue = jlpTokenData.usd_market_cap;
    }

    const result = {
      price: jlpPrice != null ? Math.round(jlpPrice * 10000) / 10000 : null,
      change24h: Math.round(change24h * 100) / 100,
      apr7d: Math.round(apr7d * 100) / 100,
      totalValue,
      composition,
      dataNote: `JLP price: ${dataSource} | Components: ${cgData ? 'CoinGecko (live)' : 'unavailable'} | APR: ${aprSource}`,
    };

    cache.set(JLP_CACHE_KEY, result, JLP_CACHE_TTL);
    console.log(`[JLP] Price=$${result.price}, APR=${result.apr7d}%, Source=${dataSource}, APR-src=${aprSource}`);
    res.json({ ...result, source: dataSource });
  } catch (err) {
    console.error('[JLP] Error:', err.message);
    const stale = cache.get(JLP_CACHE_KEY);
    if (stale) return res.json({ ...stale, source: 'stale-cache' });
    res.status(502).json({ error: err.message });
  }
});

// GET /api/hedge-funding — Weighted funding rate for JLP hedge (BTC+ETH+SOL from Binance)
// JLP composition: SOL ~44%, WBTC ~16%, ETH ~8%, USDC ~32% (USDC doesn't need hedging)
// Hedge weights normalized: SOL 64.7%, BTC 23.5%, ETH 11.8%
const HEDGE_CACHE_KEY = 'delta:hedge-funding';
const HEDGE_CACHE_TTL = 5 * 60 * 1000;

const HEDGE_ASSETS = [
  { symbol: 'SOLUSDT', label: 'SOL', weight: 0.647 },
  { symbol: 'BTCUSDT', label: 'BTC', weight: 0.235 },
  { symbol: 'ETHUSDT', label: 'ETH', weight: 0.118 },
];

// Keep old route as alias for backward compatibility
router.get('/astar-funding', (req, res) => {
  req.url = '/hedge-funding';
  router.handle(req, res);
});

router.get('/hedge-funding', async (req, res) => {
  const cached = cache.get(HEDGE_CACHE_KEY);
  if (cached) return res.json({ ...cached, source: 'cache' });

  try {
    // Fetch current rates + 7-day history for all 3 hedge assets from Binance
    const fetches = HEDGE_ASSETS.flatMap(a => [
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${a.symbol}`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${a.symbol}&limit=21`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    const results = await Promise.allSettled(fetches);

    let weightedRate = 0;
    let dataSource = 'binance-live';
    let nextFundingTime = null;
    const breakdown = [];

    // Parse current rates (results[0], results[2], results[4])
    for (let i = 0; i < HEDGE_ASSETS.length; i++) {
      const rateRes = results[i * 2];
      const asset = HEDGE_ASSETS[i];
      const rateData = rateRes.status === 'fulfilled' ? rateRes.value : null;

      if (rateData?.lastFundingRate) {
        const rate = parseFloat(rateData.lastFundingRate);
        weightedRate += rate * asset.weight;
        breakdown.push({
          asset: asset.label,
          rate,
          ratePercent: (rate * 100).toFixed(4),
          weight: asset.weight,
          annualized: Math.round(rate * 3 * 365 * 100 * 100) / 100,
        });
        if (!nextFundingTime) nextFundingTime = rateData.nextFundingTime;
      } else {
        dataSource = 'binance-partial';
        breakdown.push({ asset: asset.label, rate: 0, ratePercent: '0.0000', weight: asset.weight, annualized: 0 });
      }
    }

    const annualized = weightedRate * 3 * 365 * 100;

    // Build weighted 7-day history from all 3 assets
    const history = [];
    // Collect per-asset daily rates
    const assetDayRates = {}; // { 'YYYY-MM-DD': { SOL: avg, BTC: avg, ETH: avg } }
    for (let i = 0; i < HEDGE_ASSETS.length; i++) {
      const histRes = results[i * 2 + 1];
      const histData = histRes.status === 'fulfilled' ? histRes.value : null;
      if (!histData || !Array.isArray(histData)) continue;

      const dayMap = {};
      for (const entry of histData) {
        const date = new Date(entry.fundingTime).toISOString().slice(0, 10);
        if (!dayMap[date]) dayMap[date] = [];
        dayMap[date].push(parseFloat(entry.fundingRate));
      }
      for (const [date, rates] of Object.entries(dayMap)) {
        const avg = rates.reduce((s, r) => s + r, 0) / rates.length;
        if (!assetDayRates[date]) assetDayRates[date] = {};
        assetDayRates[date][HEDGE_ASSETS[i].label] = avg;
      }
    }

    // Calculate weighted daily rates
    for (const [date, assets] of Object.entries(assetDayRates).sort()) {
      let dayWeightedRate = 0;
      for (const a of HEDGE_ASSETS) {
        dayWeightedRate += (assets[a.label] || 0) * a.weight;
      }
      history.push({ date, rate: dayWeightedRate });
    }

    // Fallback: placeholder history
    if (history.length === 0) {
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        history.push({ date: d.toISOString().slice(0, 10), rate: weightedRate });
      }
      if (dataSource === 'binance-live') dataSource = 'binance-partial';
    }

    const result = {
      rate8h: weightedRate,
      ratePercent: (weightedRate * 100).toFixed(4),
      annualized: Math.round(annualized * 100) / 100,
      settlementInterval: '8h',
      nextFundingTime: nextFundingTime || (Date.now() + 4 * 3600 * 1000),
      history,
      breakdown,
      hedgeAsset: 'BTC+ETH+SOL 加权',
      dataNote: dataSource === 'binance-live'
        ? 'Binance 加权费率 (SOL 64.7% + BTC 23.5% + ETH 11.8%)'
        : '部分数据不可用，使用可用数据计算',
    };

    cache.set(HEDGE_CACHE_KEY, result, HEDGE_CACHE_TTL);
    console.log(`[Hedge] Weighted=${result.ratePercent}%, Ann=${result.annualized}%, Source=${dataSource}, Breakdown: ${breakdown.map(b => `${b.asset}=${b.ratePercent}%`).join(', ')}`);
    res.json({ ...result, source: dataSource });
  } catch (err) {
    console.error('[Hedge] Error:', err.message);
    const stale = cache.get(HEDGE_CACHE_KEY);
    if (stale) return res.json({ ...stale, source: 'stale-cache' });
    res.status(502).json({ error: err.message });
  }
});

// GET /api/delta-neutral-calc — net yield calculation
router.get('/delta-neutral-calc', async (req, res) => {
  try {
    const jlpCached = cache.get(JLP_CACHE_KEY);
    const hedgeCached = cache.get(HEDGE_CACHE_KEY);

    let jlpApr = jlpCached?.apr7d || 8.5;
    let hedgeAnnualized = hedgeCached?.annualized || 5.48;
    let hedgeRate = hedgeCached?.rate8h || 0.005;

    const netYield = Math.round((jlpApr - hedgeAnnualized) * 100) / 100;
    const capitalInput = parseFloat(req.query.capital) || 10000;
    const annualProfit = Math.round(capitalInput * (netYield / 100));
    const monthlyProfit = Math.round(annualProfit / 12);

    res.json({
      jlpApr,
      astarRate8h: hedgeRate,
      astarAnnualized: hedgeAnnualized,
      netYield,
      profitable: netYield > 0,
      simulation: {
        capital: capitalInput,
        annualProfit,
        monthlyProfit,
        dailyProfit: Math.round(annualProfit / 365),
      },
      riskFactors: [
        { name: 'JLP IL风险', level: 'medium', note: 'JLP组合资产价格波动可能导致无常损失' },
        { name: '资金费率波动', level: 'medium', note: '资金费率可能大幅波动，需持续监控' },
        { name: '智能合约风险', level: 'low', note: 'Jupiter为成熟协议，但仍有合约风险' },
      ],
    });
  } catch (err) {
    console.error('[Delta Calc] Error:', err.message);
    res.status(500).json({ error: 'Failed to compute delta neutral yield' });
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

// ═══════════ All Weather Strategy APIs ═══════════

// GET /api/allweather/config — target vs current allocation with positions
router.get('/allweather/config', (req, res) => {
  const sectors = allweatherConfig.sectors;
  const totalCapital = allweatherConfig.totalCapital;

  const targetAllocation = {};
  const currentAllocation = {};
  const deviation = {};
  const positions = [];

  for (const sector of sectors) {
    const sectorKey = sector.nameEn;
    targetAllocation[sectorKey] = sector.targetWeight;

    let sectorCurrentWeight = 0;
    for (const pos of sector.positions) {
      sectorCurrentWeight += pos.currentWeight;
      positions.push({
        symbol: pos.symbol,
        name: pos.name,
        sector: sector.name,
        sectorEn: sectorKey,
        category: pos.category,
        targetWeight: pos.targetWeight,
        currentWeight: pos.currentWeight,
        targetAmount: Math.round(pos.targetWeight * totalCapital),
        currentAmount: Math.round(pos.currentWeight * totalCapital),
        deviation: Math.round((pos.currentWeight - pos.targetWeight) * 10000) / 10000,
        deviationPercent: Math.round((pos.currentWeight - pos.targetWeight) * 10000) / 100,
        proxy: pos.proxy || false,
        proxyNote: pos.proxyNote || null,
      });
    }
    currentAllocation[sectorKey] = Math.round(sectorCurrentWeight * 10000) / 10000;
    deviation[sectorKey] = Math.round((sectorCurrentWeight - sector.targetWeight) * 10000) / 10000;
  }

  res.json({
    totalCapital,
    targetAllocation,
    currentAllocation,
    deviation,
    positions,
    sectorCount: sectors.length,
    positionCount: positions.length,
    rebalanceThreshold: allweatherConfig.rebalanceThreshold,
  });
});

// GET /api/allweather/rebalance — rebalance alerts when deviation exceeds threshold
router.get('/allweather/rebalance', (req, res) => {
  const threshold = allweatherConfig.rebalanceThreshold;
  const sectorThreshold = allweatherConfig.sectorThreshold;
  const totalCapital = allweatherConfig.totalCapital;
  const alerts = [];

  // Position-level alerts
  for (const sector of allweatherConfig.sectors) {
    for (const pos of sector.positions) {
      const dev = pos.currentWeight - pos.targetWeight;
      if (Math.abs(dev) >= threshold) {
        alerts.push({
          asset: pos.symbol,
          name: pos.name,
          sector: sector.name,
          target: pos.targetWeight,
          current: pos.currentWeight,
          deviation: Math.round(dev * 10000) / 10000,
          deviationPercent: Math.round(dev * 10000) / 100,
          action: dev > 0 ? 'SELL' : 'BUY',
          amount: Math.abs(Math.round(dev * totalCapital)),
          level: 'position',
        });
      }
    }
  }

  // Sector-level alerts
  for (const sector of allweatherConfig.sectors) {
    const sectorCurrent = sector.positions.reduce((sum, p) => sum + p.currentWeight, 0);
    const dev = sectorCurrent - sector.targetWeight;
    if (Math.abs(dev) >= sectorThreshold) {
      alerts.push({
        asset: sector.name,
        name: sector.nameEn,
        sector: sector.name,
        target: sector.targetWeight,
        current: Math.round(sectorCurrent * 10000) / 10000,
        deviation: Math.round(dev * 10000) / 10000,
        deviationPercent: Math.round(dev * 10000) / 100,
        action: dev > 0 ? 'REDUCE' : 'INCREASE',
        amount: Math.abs(Math.round(dev * totalCapital)),
        level: 'sector',
      });
    }
  }

  // Sort by absolute deviation descending
  alerts.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));

  res.json({
    needsRebalance: alerts.length > 0,
    threshold,
    sectorThreshold,
    alertCount: alerts.length,
    alerts,
  });
});

// GET /api/allweather/cta-signal — CTA synergy status and AW allocation suggestion
router.get('/allweather/cta-signal', async (req, res) => {
  try {
    // Fetch current CTA signal for BTC (default params)
    const ctaCacheKey = 'crypto:BTC:prices';
    let priceData = cache.get(ctaCacheKey);
    if (!priceData || !priceData.prices || priceData.prices.length < 60) {
      const url = 'https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=365';
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`CryptoCompare API ${resp.status}`);
      const json = await resp.json();
      if (json.Response !== 'Success') throw new Error(json.Message || 'CryptoCompare error');
      const prices = (json.Data?.Data || [])
        .filter(d => d.close > 0)
        .map(d => ({ date: new Date(d.time * 1000).toISOString().slice(0, 10), price: d.close }));
      priceData = { prices, days: 365 };
      cache.set(ctaCacheKey, priceData, 60 * 60 * 1000);
    }

    const prices = priceData.prices;
    const shortPeriod = 20;
    const longPeriod = 50;

    function sma(arr, period, idx) {
      if (idx < period - 1) return null;
      let sum = 0;
      for (let i = idx - period + 1; i <= idx; i++) sum += arr[i].price;
      return sum / period;
    }

    const len = prices.length;
    const shortSMA = sma(prices, shortPeriod, len - 1);
    const longSMA = sma(prices, longPeriod, len - 1);

    // Determine current CTA signal
    let ctaStatus = '观望';
    let ctaSignal = 'neutral';
    if (shortSMA !== null && longSMA !== null) {
      if (shortSMA > longSMA) {
        // Check if recent golden cross
        const prevShort = sma(prices, shortPeriod, len - 2);
        const prevLong = sma(prices, longPeriod, len - 2);
        if (prevShort !== null && prevLong !== null && prevShort <= prevLong) {
          ctaSignal = 'golden_cross';
          ctaStatus = '金叉形成';
        } else {
          ctaSignal = 'bullish';
          ctaStatus = '多头排列';
        }
      } else {
        const prevShort = sma(prices, shortPeriod, len - 2);
        const prevLong = sma(prices, longPeriod, len - 2);
        if (prevShort !== null && prevLong !== null && prevShort >= prevLong) {
          ctaSignal = 'death_cross';
          ctaStatus = '死叉形成';
        } else {
          ctaSignal = 'bearish';
          ctaStatus = '空头排列';
        }
      }
    }

    // Calculate duration of current signal (days since last crossover)
    let ctaDuration = 0;
    for (let i = len - 2; i >= Math.max(0, len - 365); i--) {
      const s = sma(prices, shortPeriod, i);
      const l = sma(prices, longPeriod, i);
      if (s === null || l === null) break;
      const aboveNow = shortSMA > longSMA;
      const aboveThen = s > l;
      if (aboveNow !== aboveThen) {
        ctaDuration = len - 1 - i;
        break;
      }
      ctaDuration = len - 1 - i;
    }

    // Apply CTA synergy rules
    const rules = allweatherConfig.ctaSynergy.rules;
    let suggestedAW = allweatherConfig.ctaSynergy.defaultAW;
    let suggestedCTA = allweatherConfig.ctaSynergy.defaultCTA;
    let reason = '默认均衡配置';
    let matchedRule = null;

    for (const rule of rules) {
      if (rule.ctaSignal === ctaSignal && ctaDuration >= rule.minDays && ctaDuration <= rule.maxDays) {
        suggestedAW = rule.awAllocation;
        suggestedCTA = rule.ctaAllocation;
        reason = rule.label;
        matchedRule = rule;
        break;
      }
    }

    // Special case: bearish > 14 days (空仓观望)
    if (ctaSignal === 'bearish' && ctaDuration > 14) {
      suggestedAW = 0.80;
      suggestedCTA = 0.20;
      reason = `CTA空仓已持续${ctaDuration}天，建议增配All Weather至80%`;
    }

    res.json({
      ctaStatus,
      ctaSignal,
      ctaDuration,
      btcPrice: Math.round(prices[len - 1].price * 100) / 100,
      shortSMA: shortSMA !== null ? Math.round(shortSMA * 100) / 100 : null,
      longSMA: longSMA !== null ? Math.round(longSMA * 100) / 100 : null,
      currentAW: allweatherConfig.ctaSynergy.defaultAW,
      suggestedAW,
      suggestedCTA,
      reason,
    });
  } catch (err) {
    console.error('[AW CTA Signal] Error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sentiment — Multi-dimensional market sentiment composite score
// Aggregates: Fear & Greed + Funding Rate pressure + VRP + CTA trend
// Returns score 0-100 (0=extreme fear/risk-off, 100=extreme greed/risk-on)
// ─────────────────────────────────────────────────────────────────────────────
const SENTIMENT_CACHE_KEY = 'sentiment:composite';
const SENTIMENT_TTL = 5 * 60 * 1000;

router.get('/sentiment', async (req, res) => {
  const cached = cache.get(SENTIMENT_CACHE_KEY);
  if (cached) return res.json(cached);

  try {
    const result = await computeSentiment();
    cache.set(SENTIMENT_CACHE_KEY, result, SENTIMENT_TTL);
    res.json(result);
  } catch (err) {
    console.error('[Sentiment] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

async function computeSentiment() {
  // ── 1. Fear & Greed ────────────────────────────────────────────────────────
  let fng = fearGreed.getCached();
  if (!fng) fng = await fearGreed.fetchFearGreed();
  const fngValue = fng?.current?.value ?? 50;
  const fngLabel = fng?.current?.label ?? 'Neutral';
  const fngHistory = (fng?.history || []).slice(0, 30).map(d => ({ date: d.timestamp, value: d.value }));

  // ── 2. Funding Rate pressure ────────────────────────────────────────────────
  // Positive funding = longs paying = greed; negative = shorts paying = fear
  let fundingScore = 50;
  let btcFundingRate = null;
  let ethFundingRate = null;
  try {
    const coins = ['BTC', 'ETH', 'SOL'];
    const fundingFetches = await Promise.allSettled(coins.map(c =>
      fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${c}USDT`)
        .then(r => r.json())
    ));
    const rates = fundingFetches
      .filter(r => r.status === 'fulfilled')
      .map(r => parseFloat(r.value.lastFundingRate || 0));
    if (rates.length > 0) {
      const avgRate = rates.reduce((s, r) => s + r, 0) / rates.length;
      // Scale: ±0.03% per 8h is "extreme"; map to 0-100 around 50
      fundingScore = Math.min(100, Math.max(0, Math.round(50 + avgRate * 100000)));
      btcFundingRate = fundingFetches[0].status === 'fulfilled'
        ? parseFloat(fundingFetches[0].value.lastFundingRate || 0)
        : null;
      ethFundingRate = fundingFetches[1].status === 'fulfilled'
        ? parseFloat(fundingFetches[1].value.lastFundingRate || 0)
        : null;
    }
  } catch (_) { /* use default 50 */ }

  // ── 3. VRP (IV premium) ─────────────────────────────────────────────────────
  let vrpScore = 50;
  let vrpSpread = null;
  let currentDvol = null;
  try {
    const dvolData = await ensureBTCDvol();
    if (dvolData && dvolData.length > 30) {
      const recent = dvolData.slice(-365);
      currentDvol = recent[recent.length - 1]?.iv;
      if (currentDvol != null) {
        const btcData = await ensureBTCPrices();
        if (btcData?.prices?.length > 31) {
          const slice = btcData.prices.slice(-31);
          const returns = [];
          for (let i = 1; i < slice.length; i++) {
            returns.push(Math.log(slice[i].price / slice[i - 1].price));
          }
          const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
          const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
          const rv30 = Math.sqrt(variance * 365);
          vrpSpread = Math.round((currentDvol - rv30) * 10000) / 100;
          // Positive VRP = IV > RV = expensive options = uncertainty/risk-off = lower sentiment
          vrpScore = Math.min(100, Math.max(0, Math.round(50 - vrpSpread * 1.5)));
        }
      }
    }
  } catch (_) { /* use default 50 */ }

  // ── 4. CTA Trend ────────────────────────────────────────────────────────────
  let ctaScore = 50;
  let ctaSignal = 'neutral';
  let btcPrice = null;
  try {
    const ctaCacheKey = 'crypto:BTC:prices';
    let priceData = cache.get(ctaCacheKey);
    if (!priceData || !priceData.prices || priceData.prices.length < 60) {
      const url = 'https://min-api.cryptocompare.com/data/v2/histoday?fsym=BTC&tsym=USD&limit=90';
      const resp = await fetch(url);
      const json = await resp.json();
      if (json.Response === 'Success') {
        const prices = (json.Data?.Data || []).filter(d => d.close > 0)
          .map(d => ({ date: new Date(d.time * 1000).toISOString().slice(0, 10), price: d.close }));
        priceData = { prices };
        cache.set(ctaCacheKey, priceData, 60 * 60 * 1000);
      }
    }
    if (priceData?.prices?.length >= 60) {
      const prices = priceData.prices;
      const len = prices.length;
      btcPrice = prices[len - 1].price;
      const sma25 = prices.slice(-25).reduce((s, d) => s + d.price, 0) / 25;
      const sma60 = prices.slice(-60).reduce((s, d) => s + d.price, 0) / 60;
      const diff = (sma25 - sma60) / sma60;
      ctaSignal = diff > 0.02 ? 'bullish' : diff < -0.02 ? 'bearish' : 'neutral';
      ctaScore = ctaSignal === 'bullish' ? 75 : ctaSignal === 'bearish' ? 25 : 50;
    }
  } catch (_) { /* use default */ }

  // ── Composite Score (equal weight) ──────────────────────────────────────────
  const composite = Math.round((fngValue + fundingScore + vrpScore + ctaScore) / 4);

  // ── Risk Level & Recommendation ─────────────────────────────────────────────
  let riskLevel, riskColor, recommendation, ctaAllocation, stableAllocation;
  if (composite <= 20) {
    riskLevel = 'Extreme Fear'; riskColor = '#ef4444';
    recommendation = '极度恐慌，期权 Sell Put 最佳开仓窗口，稳定币保底';
    ctaAllocation = 50; stableAllocation = 30;
  } else if (composite <= 35) {
    riskLevel = 'Fear'; riskColor = '#f97316';
    recommendation = '市场恐慌，可分批建仓 CTA + 小仓期权';
    ctaAllocation = 40; stableAllocation = 30;
  } else if (composite <= 55) {
    riskLevel = 'Neutral'; riskColor = '#f59e0b';
    recommendation = '市场中性，按计划维持组合，不追涨不杀跌';
    ctaAllocation = 25; stableAllocation = 35;
  } else if (composite <= 70) {
    riskLevel = 'Greed'; riskColor = '#10b981';
    recommendation = '情绪偏热，CTA 继续持有，期权谨慎开仓';
    ctaAllocation = 20; stableAllocation = 40;
  } else {
    riskLevel = 'Extreme Greed'; riskColor = '#8b5cf6';
    recommendation = '极度贪婪，高风险信号！减仓CTA，增配稳定币，等待回调';
    ctaAllocation = 10; stableAllocation = 50;
  }

  return {
    composite,
    riskLevel,
    riskColor,
    recommendation,
    suggestedAllocation: { cta: ctaAllocation, stable: stableAllocation, options: 15, longHold: 100 - ctaAllocation - stableAllocation - 15 },
    dimensions: {
      fearGreed: {
        value: fngValue,
        label: fngLabel,
        score: fngValue,
        history: fngHistory,
        description: '市场恐慌/贪婪程度（Alternative.me）',
      },
      funding: {
        btcRate: btcFundingRate != null ? Math.round(btcFundingRate * 1e6) / 10000 : null,
        ethRate: ethFundingRate != null ? Math.round(ethFundingRate * 1e6) / 10000 : null,
        score: fundingScore,
        description: '永续合约资金费率（正=多头付费=贪婪）',
      },
      vrp: {
        dvol: currentDvol != null ? Math.round(currentDvol * 10000) / 100 : null,
        spread: vrpSpread,
        score: vrpScore,
        description: 'VRP 波动率溢价（正=IV>RV=不确定性高）',
      },
      cta: {
        signal: ctaSignal,
        btcPrice: btcPrice ? Math.round(btcPrice) : null,
        score: ctaScore,
        description: 'BTC CTA趋势信号（25/60日均线）',
      },
    },
    lastUpdate: new Date().toISOString(),
  };
}

// Export computeSentiment for use by alert system
router.computeSentiment = computeSentiment;

// GET /api/alerts/test — send a test Telegram message
router.get('/alerts/test', async (req, res) => {
  try {
    const telegramAlert = require('../fetchers/telegram-alert');
    if (!telegramAlert.isConfigured()) {
      return res.json({ ok: false, message: 'Telegram not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env' });
    }
    const ok = await telegramAlert.sendTestMessage();
    res.json({ ok, message: ok ? 'Test message sent!' : 'Send failed — check server logs' });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.buildPortfolioSummary = buildPortfolioSummary;
module.exports = router;
