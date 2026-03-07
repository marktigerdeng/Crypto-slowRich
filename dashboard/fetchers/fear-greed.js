const cache = require('../cache/store');

const CACHE_KEY = 'fng:index';
const TTL = 30 * 60 * 1000; // 30 minutes
const API_URL = 'https://api.alternative.me/fng/?limit=30';

async function fetchFearGreed() {
  try {
    const resp = await fetch(API_URL);
    if (!resp.ok) throw new Error(`Fear & Greed API ${resp.status}`);
    const json = await resp.json();

    const data = (json.data || []).map(d => ({
      value: parseInt(d.value),
      label: d.value_classification,
      timestamp: new Date(parseInt(d.timestamp) * 1000).toISOString().slice(0, 10),
    }));

    const result = {
      current: data[0] || null,
      history: data,
    };

    cache.set(CACHE_KEY, result, TTL);
    console.log(`[Fear&Greed] Fetched: ${result.current?.value} (${result.current?.label})`);
    return result;
  } catch (err) {
    console.error('[Fear&Greed] Error:', err.message);
    const stale = cache.get(CACHE_KEY);
    if (stale) return stale;
    return { current: null, history: [] };
  }
}

function getCached() {
  return cache.get(CACHE_KEY);
}

module.exports = { fetchFearGreed, getCached };
