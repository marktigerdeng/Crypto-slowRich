const cache = require('../cache/store');
const cefiRates = require('../config/cefi-rates.json');

const CACHE_KEY = 'cefi:binance';
const TTL = 30 * 60 * 1000; // 30 minutes

// Binance public savings endpoint (no auth required)
const PUBLIC_URL = 'https://www.binance.com/bapi/earn/v1/public/lending/product/list';

async function fetchRates() {
  // Strategy: Try public endpoint first, then fall back to manual rates
  try {
    const rates = await fetchPublicEndpoint();
    if (rates && rates.length > 0) {
      cache.set(CACHE_KEY, { rates, source: 'api' }, TTL);
      console.log(`[Binance] Fetched ${rates.length} rates from public API`);
      return { rates, source: 'api' };
    }
  } catch (err) {
    console.error('[Binance] Public API error:', err.message);
  }

  // Try authenticated API if keys available
  if (process.env.BINANCE_API_KEY) {
    try {
      const rates = await fetchAuthEndpoint();
      if (rates && rates.length > 0) {
        cache.set(CACHE_KEY, { rates, source: 'auth-api' }, TTL);
        console.log(`[Binance] Fetched ${rates.length} rates from auth API`);
        return { rates, source: 'auth-api' };
      }
    } catch (err) {
      console.error('[Binance] Auth API error:', err.message);
    }
  }

  // Fallback to manual rates
  const manual = formatManualRates();
  cache.set(CACHE_KEY, { rates: manual, source: 'manual' }, TTL);
  console.log('[Binance] Using manual fallback rates');
  return { rates: manual, source: 'manual' };
}

async function fetchPublicEndpoint() {
  const results = [];
  for (const asset of ['USDT', 'USDC']) {
    try {
      const resp = await fetch(PUBLIC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset,
          pageSize: 10,
          pageIndex: 1,
          status: 'SUBSCRIBABLE',
        }),
      });
      if (!resp.ok) continue;
      const json = await resp.json();
      const items = json.data?.list || json.data || [];
      for (const item of items) {
        results.push({
          asset: item.asset || asset,
          product: item.productName || item.duration ? `Locked ${item.duration}d` : 'Flexible',
          apy: parseFloat(item.latestAnnualPercentageRate || item.avgAnnualInterestRate || 0) * 100,
          duration: item.duration || 0,
          platform: 'binance',
        });
      }
    } catch { /* skip */ }
  }
  return results;
}

async function fetchAuthEndpoint() {
  const crypto = require('crypto');
  const apiKey = process.env.BINANCE_API_KEY;
  const secret = process.env.BINANCE_SECRET_KEY;
  if (!apiKey || !secret) return [];

  const timestamp = Date.now();
  const query = `timestamp=${timestamp}`;
  const signature = crypto.createHmac('sha256', secret).update(query).digest('hex');

  const resp = await fetch(
    `https://api.binance.com/sapi/v1/simple-earn/flexible/list?${query}&signature=${signature}`,
    { headers: { 'X-MBX-APIKEY': apiKey } }
  );
  if (!resp.ok) throw new Error(`Binance auth API ${resp.status}`);
  const json = await resp.json();
  return (json.rows || [])
    .filter(r => ['USDT', 'USDC'].includes(r.asset))
    .map(r => ({
      asset: r.asset,
      product: 'Flexible Savings',
      apy: parseFloat(r.latestAnnualPercentageRate || 0) * 100,
      duration: 0,
      platform: 'binance',
    }));
}

function formatManualRates() {
  const rates = [];
  for (const [asset, products] of Object.entries(cefiRates.binance || {})) {
    for (const [product, info] of Object.entries(products)) {
      rates.push({
        asset,
        product: product.replace(/_/g, ' '),
        apy: info.apy,
        duration: product.includes('locked') ? parseInt(product.match(/\d+/)?.[0] || 0) : 0,
        platform: 'binance',
        source: 'manual',
      });
    }
  }
  return rates;
}

function getCached() {
  return cache.get(CACHE_KEY);
}

module.exports = { fetchRates, getCached };
