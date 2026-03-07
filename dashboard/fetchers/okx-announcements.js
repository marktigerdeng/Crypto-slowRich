const cache = require('../cache/store');

const CACHE_KEY = 'announcements:okx';
const TTL = 15 * 60 * 1000; // 15 minutes

// OKX announcement API
const API_URL = 'https://www.okx.com/v2/support/home/web';

const HIGHLIGHT_KEYWORDS = [
  'earn', 'savings', 'simple earn', 'lending',
  'usdt', 'usdc', 'stablecoin', 'interest', 'apy',
  'yield', 'promotion', 'bonus', 'structured',
];

async function fetchAnnouncements() {
  try {
    // Try OKX API for announcements
    const resp = await fetch('https://www.okx.com/api/v5/support/announcements?page=1&limit=20', {
      headers: { 'Accept': 'application/json' },
    });

    if (resp.ok) {
      const json = await resp.json();
      const articles = (json.data || [])
        .map(a => ({
          id: a.id || a.announcementId,
          title: a.title,
          url: a.url || `https://www.okx.com/support/hc/articles/${a.id}`,
          date: a.publishDate || a.pTime,
          platform: 'okx',
          highlighted: isHighlighted(a.title),
        }))
        .slice(0, 20);

      if (articles.length > 0) {
        cache.set(CACHE_KEY, articles, TTL);
        console.log(`[OKX Announcements] Fetched ${articles.length} articles`);
        return articles;
      }
    }

    // Fallback: try scraping the announcements page
    return await fetchFromPage();
  } catch (err) {
    console.error('[OKX Announcements] Error:', err.message);
    return cache.get(CACHE_KEY) || [{
      title: '⚠️ Unable to load — visit OKX Announcements directly',
      url: 'https://www.okx.com/support/hc/en-us/sections/earn',
      platform: 'okx',
      highlighted: false,
      fallback: true,
    }];
  }
}

async function fetchFromPage() {
  try {
    const resp = await fetch('https://www.okx.com/support/hc/en-us/categories/earn', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        'Accept': 'text/html',
      },
    });
    if (!resp.ok) throw new Error(`OKX page ${resp.status}`);

    const html = await resp.text();
    // Simple regex extraction of article links and titles
    const articles = [];
    const regex = /<a[^>]*href="(\/support\/hc\/[^"]*articles\/[^"]*)"[^>]*>([^<]+)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) && articles.length < 20) {
      articles.push({
        title: match[2].trim(),
        url: `https://www.okx.com${match[1]}`,
        platform: 'okx',
        highlighted: isHighlighted(match[2]),
      });
    }

    if (articles.length > 0) {
      cache.set(CACHE_KEY, articles, TTL);
      console.log(`[OKX Announcements] Scraped ${articles.length} articles from page`);
      return articles;
    }

    throw new Error('No articles found on page');
  } catch (err) {
    console.error('[OKX Announcements] Page scrape error:', err.message);
    return cache.get(CACHE_KEY) || [{
      title: '⚠️ Unable to load — visit OKX Announcements directly',
      url: 'https://www.okx.com/support/hc/en-us/categories/earn',
      platform: 'okx',
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
