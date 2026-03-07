const cache = require('../cache/store');
const cefiRates = require('../config/cefi-rates.json');

const CACHE_KEY = 'cefi:okx';
const TTL = 30 * 60 * 1000; // 30 minutes

const API_URL = 'https://www.okx.com/api/v5/finance/savings/lending-rate-summary';

async function fetchRates() {
  // Try OKX public API (no auth required)
  try {
    const rates = [];
    for (const ccy of ['USDT', 'USDC']) {
      const resp = await fetch(`${API_URL}?ccy=${ccy}`);
      if (!resp.ok) continue;
      const json = await resp.json();
      const items = json.data || [];
      for (const item of items) {
        rates.push({
          asset: item.ccy || ccy,
          product: 'Simple Earn',
          apy: parseFloat(item.avgRate || 0) * 365, // daily % → annual %
          lendingRate: parseFloat(item.avgRate || 0),
          platform: 'okx',
        });
      }
    }

    if (rates.length > 0) {
      cache.set(CACHE_KEY, { rates, source: 'api' }, TTL);
      console.log(`[OKX] Fetched ${rates.length} rates from API`);
      return { rates, source: 'api' };
    }
  } catch (err) {
    console.error('[OKX] API error:', err.message);
  }

  // Fallback to manual
  const manual = formatManualRates();
  cache.set(CACHE_KEY, { rates: manual, source: 'manual' }, TTL);
  console.log('[OKX] Using manual fallback rates');
  return { rates: manual, source: 'manual' };
}

function formatManualRates() {
  const rates = [];
  for (const [asset, products] of Object.entries(cefiRates.okx || {})) {
    for (const [product, info] of Object.entries(products)) {
      rates.push({
        asset,
        product: product.replace(/_/g, ' '),
        apy: info.apy,
        platform: 'okx',
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
