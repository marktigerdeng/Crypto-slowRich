const cache = require('../cache/store');

const CACHE_KEY = 'announcements:binance';
const TTL = 15 * 60 * 1000; // 15 minutes

// Binance CMS public API
const API_URL = 'https://www.binance.com/bapi/composite/v1/public/cms/article/list/query';

// Keywords to highlight as relevant to our portfolio
const HIGHLIGHT_KEYWORDS = [
  'earn', 'savings', 'simple earn', 'locked', 'flexible',
  'usdt', 'usdc', 'stablecoin', 'interest rate', 'apy',
  'lending', 'yield', 'promotion', 'bonus',
];

async function fetchAnnouncements() {
  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      body: JSON.stringify({
        type: 1,
        pageNo: 1,
        pageSize: 20,
        catalogId: 48,  // Earn/Finance category
      }),
    });

    if (!resp.ok) throw new Error(`Binance CMS API ${resp.status}`);
    const json = await resp.json();
    const articles = (json.data?.catalogs?.[0]?.articles || json.data?.articles || [])
      .map(a => ({
        id: a.id || a.code,
        title: a.title,
        url: `https://www.binance.com/en/support/announcement/${a.code || a.id}`,
        date: a.releaseDate ? new Date(a.releaseDate).toISOString() : null,
        platform: 'binance',
        highlighted: isHighlighted(a.title),
      }))
      .slice(0, 20);

    cache.set(CACHE_KEY, articles, TTL);
    console.log(`[Binance Announcements] Fetched ${articles.length} articles`);
    return articles;
  } catch (err) {
    console.error('[Binance Announcements] Error:', err.message);
    // Return cached or empty with fallback link
    return cache.get(CACHE_KEY) || [{
      title: '⚠️ Unable to load — visit Binance Announcements directly',
      url: 'https://www.binance.com/en/support/announcement/earn',
      platform: 'binance',
      highlighted: false,
      fallback: true,
    }];
  }
}

function isHighlighted(title) {
  if (!title) return false;
  const lower = title.toLowerCase();
  return HIGHLIGHT_KEYWORDS.some(kw => lower.includes(kw));
}

function getCached() {
  return cache.get(CACHE_KEY);
}

module.exports = { fetchAnnouncements, getCached };
