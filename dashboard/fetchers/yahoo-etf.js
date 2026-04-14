const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });
const cache = require('../cache/store');

const ETF_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours
const MAX_RETRIES = 3;

// ETF 代理映射（当 Yahoo API 限流时使用 CryptoCompare 或 Alpha Vantage）
const ETF_PROXIES = {
  'IBIT': { proxy: 'BTC-USD', scaleFactor: 0.000625, correlation: 0.95, description: 'Bitcoin spot ETF (~1/1600 BTC per share)' },
};

// Stooq.com free CSV fallback for ETFs (no API key needed, daily data)
async function fetchFromStooq(symbol, startDate, endDate) {
  try {
    const sd = startDate.toISOString().slice(0, 10).replace(/-/g, '');
    const ed = endDate.toISOString().slice(0, 10).replace(/-/g, '');
    // Stooq uses lowercase tickers with .us suffix for US stocks
    const stooqSym = symbol.toLowerCase() + '.us';
    const url = `https://stooq.com/q/d/l/?s=${stooqSym}&d1=${sd}&d2=${ed}&i=d`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Stooq HTTP ${response.status}`);
    const csv = await response.text();

    const lines = csv.trim().split('\n');
    if (lines.length < 2 || lines[0].toLowerCase().includes('no data')) {
      throw new Error('Stooq: no data for ' + symbol);
    }

    const prices = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 5) continue;
      const date = cols[0]; // YYYY-MM-DD format
      const close = parseFloat(cols[4]);
      if (close > 0 && date.match(/^\d{4}-\d{2}-\d{2}$/)) {
        prices.push({ date, price: Math.round(close * 100) / 100 });
      }
    }

    if (prices.length === 0) throw new Error('Stooq: empty result for ' + symbol);
    prices.sort((a, b) => a.date.localeCompare(b.date));
    return prices;
  } catch (err) {
    console.error('[Stooq] Error:', err.message);
    throw err;
  }
}

// 使用 CryptoCompare 作为备选数据源
async function fetchFromCryptoCompare(symbol, startDate, endDate) {
  try {
    const fsym = symbol.split('-')[0]; // BTC-USD -> BTC
    const tsym = 'USD';
    const limit = 2000; // max allowed
    
    const url = `https://min-api.cryptocompare.com/data/v2/histoday?fsym=${fsym}&tsym=${tsym}&limit=${limit}&toTs=${Math.floor(endDate.getTime()/1000)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.Response === 'Success' && data.Data?.Data) {
      const prices = data.Data.Data
        .filter(d => d.close > 0)
        .map(d => ({
          date: new Date(d.time * 1000).toISOString().slice(0, 10),
          price: d.close,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      
      // Filter to requested date range
      const startStr = startDate.toISOString().slice(0, 10);
      return prices.filter(p => p.date >= startStr);
    }
    throw new Error('CryptoCompare API error: ' + (data.Message || 'Unknown'));
  } catch (err) {
    console.error('[CryptoCompare] Error:', err.message);
    throw err;
  }
}

async function fetchETFPrices(symbol, years = 5) {
  const cacheKey = `etf:${symbol}:prices`;

  const cached = cache.get(cacheKey);
  if (cached && cached.years >= years) {
    return { prices: cached.prices, source: 'cache' };
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - years);

  // Handle newly-listed ETFs (e.g., IBIT launched Jan 2024)
  const ETF_LAUNCH_DATES = {
    'IBIT': '2024-01-11', // BlackRock Bitcoin ETF launch date
  };
  
  const launchDate = ETF_LAUNCH_DATES[symbol];
  if (launchDate) {
    const launch = new Date(launchDate);
    if (startDate < launch) {
      console.log(`[ETF] ${symbol}: adjusting start date to launch date ${launchDate}`);
      startDate.setTime(launch.getTime());
    }
  }

  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await yahooFinance.chart(symbol, {
        period1: startDate.toISOString().slice(0, 10),
        period2: endDate.toISOString().slice(0, 10),
        interval: '1d',
      });

      const quotes = result.quotes || [];
      const prices = quotes
        .filter(d => d.close > 0)
        .map(d => ({
          date: new Date(d.date).toISOString().slice(0, 10),
          price: Math.round(d.close * 100) / 100,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));

      cache.set(cacheKey, { prices, years }, ETF_CACHE_TTL);
      console.log(`[ETF] ${symbol}: fetched ${prices.length} daily prices from Yahoo Finance`);
      return { prices, source: 'yahoo-finance' };
    } catch (err) {
      lastErr = err;
      const isRateLimit = /too many requests|429|rate/i.test(err.message);
      if (isRateLimit && attempt < MAX_RETRIES) {
        const delay = attempt * 2000;
        console.warn(`[ETF] ${symbol}: rate-limited, retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      break;
    }
  }

  console.error(`[ETF] ${symbol} Yahoo error:`, lastErr.message);

  // Try Stooq CSV fallback for all US ETFs (free, no API key)
  try {
    console.log(`[ETF] ${symbol}: trying Stooq fallback`);
    const stooqPrices = await fetchFromStooq(symbol, startDate, endDate);
    if (stooqPrices.length > 0) {
      cache.set(cacheKey, { prices: stooqPrices, years }, ETF_CACHE_TTL);
      console.log(`[ETF] ${symbol}: Stooq fallback OK, ${stooqPrices.length} data points`);
      return { prices: stooqPrices, source: 'stooq' };
    }
  } catch (stooqErr) {
    console.error(`[ETF] ${symbol} Stooq error:`, stooqErr.message);
  }

  // Last resort: proxy symbol (e.g., BTC-USD for IBIT with dynamic scaling)
  const proxyConfig = ETF_PROXIES[symbol];
  if (proxyConfig) {
    console.log(`[ETF] ${symbol}: trying proxy ${proxyConfig.proxy} (${proxyConfig.description})`);

    // IBIT ≈ BTC × 0.000625 (1 share ≈ 1/1600 BTC based on NAV)
    const SCALE_FACTOR = proxyConfig.scaleFactor || 0.000625;

    // Try CryptoCompare first
    try {
      console.log(`[ETF] ${symbol}: trying CryptoCompare API`);
      const prices = await fetchFromCryptoCompare(proxyConfig.proxy, startDate, endDate);

      const scaledPrices = prices.map(p => ({
        date: p.date,
        price: Math.round(p.price * SCALE_FACTOR * 100) / 100,
      }));

      console.log(`[ETF] ${symbol}: using CryptoCompare ${proxyConfig.proxy} proxy, ${scaledPrices.length} data points (scale=${SCALE_FACTOR})`);
      return {
        prices: scaledPrices,
        source: `cryptocompare:${proxyConfig.proxy}`,
        note: `Using ${proxyConfig.proxy} as price proxy (scale: ${SCALE_FACTOR})`
      };
    } catch (ccErr) {
      console.error(`[ETF] ${symbol} CryptoCompare error:`, ccErr.message);

      // Try Yahoo Finance for proxy
      try {
        const proxyResult = await yahooFinance.chart(proxyConfig.proxy, {
          period1: startDate.toISOString().slice(0, 10),
          period2: endDate.toISOString().slice(0, 10),
          interval: '1d',
        });

        const quotes = proxyResult.quotes || [];
        const prices = quotes
          .filter(d => d.close > 0)
          .map(d => ({
            date: new Date(d.date).toISOString().slice(0, 10),
            price: Math.round(d.close * SCALE_FACTOR * 100) / 100,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));

        console.log(`[ETF] ${symbol}: using Yahoo ${proxyConfig.proxy} proxy, ${prices.length} data points (scale=${SCALE_FACTOR})`);
        return {
          prices,
          source: `proxy:${proxyConfig.proxy}`,
          note: `Using ${proxyConfig.proxy} as price proxy (scale: ${SCALE_FACTOR})`
        };
      } catch (proxyErr) {
        console.error(`[ETF] ${symbol} proxy error:`, proxyErr.message);
      }
    }
  }
  
  const stale = cache.get(cacheKey);
  if (stale) return { prices: stale.prices, source: 'stale-cache' };
  
  // Return empty data with error info for newly-listed ETFs
  if (launchDate) {
    return { 
      prices: [], 
      source: 'error',
      error: `${symbol} launched on ${launchDate}. No historical data available before this date.`,
      launchDate 
    };
  }
  
  throw lastErr;
}

module.exports = { fetchETFPrices };
