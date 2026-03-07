const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance();
const cache = require('../cache/store');

const ETF_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours

async function fetchETFPrices(symbol, years = 5) {
  const cacheKey = `etf:${symbol}:prices`;

  const cached = cache.get(cacheKey);
  if (cached && cached.years >= years) {
    return { prices: cached.prices, source: 'cache' };
  }

  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - years);

    const result = await yahooFinance.historical(symbol, {
      period1: startDate.toISOString().slice(0, 10),
      period2: endDate.toISOString().slice(0, 10),
      interval: '1d',
    });

    const prices = result
      .filter(d => d.close > 0)
      .map(d => ({
        date: d.date.toISOString().slice(0, 10),
        price: Math.round(d.close * 100) / 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    cache.set(cacheKey, { prices, years }, ETF_CACHE_TTL);
    console.log(`[ETF] ${symbol}: fetched ${prices.length} daily prices from Yahoo Finance`);
    return { prices, source: 'yahoo-finance' };
  } catch (err) {
    console.error(`[ETF] ${symbol} error:`, err.message);
    // Stale-cache fallback
    const stale = cache.get(cacheKey);
    if (stale) return { prices: stale.prices, source: 'stale-cache' };
    throw err;
  }
}

module.exports = { fetchETFPrices };
