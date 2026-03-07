const cache = require('../cache/store');

const OPTIONS_CACHE_KEY = 'options:deribit';
const OPTIONS_TTL = 2 * 60 * 1000; // 2 minutes
const DETAIL_TTL = 60 * 1000; // 1 minute

const DERIBIT_BASE = 'https://www.deribit.com/api/v2/public';

// Parse Deribit expiry format: "28FEB25" → Date
function parseDeribitExpiry(str) {
  const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
                   JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  const day = parseInt(str.slice(0, str.length - 5));
  const mon = str.slice(str.length - 5, str.length - 2);
  const yr = parseInt('20' + str.slice(str.length - 2));
  // Deribit options expire at 08:00 UTC
  return new Date(Date.UTC(yr, months[mon], day, 8, 0, 0));
}

// Parse instrument name: "BTC-28FEB25-80000-P" → {expiry, strike, type}
function parseInstrument(name) {
  const parts = name.split('-');
  return {
    expiry: parts[1],
    strike: parseInt(parts[2]),
    type: parts[3], // P or C
  };
}

async function fetchOptions() {
  try {
    // Fetch BTC spot price + all option summaries in parallel
    const [indexResp, summaryResp] = await Promise.all([
      fetch(`${DERIBIT_BASE}/get_index_price?index_name=btc_usd`),
      fetch(`${DERIBIT_BASE}/get_book_summary_by_currency?currency=BTC&kind=option`),
    ]);

    if (!indexResp.ok) throw new Error(`Index price API ${indexResp.status}`);
    if (!summaryResp.ok) throw new Error(`Book summary API ${summaryResp.status}`);

    const indexJson = await indexResp.json();
    const summaryJson = await summaryResp.json();

    const btcSpot = indexJson.result?.index_price;
    if (!btcSpot) throw new Error('No BTC index price');

    const allOptions = summaryJson.result || [];

    // Filter to Puts only
    const puts = allOptions
      .filter(o => o.instrument_name.endsWith('-P'))
      .map(o => {
        const parsed = parseInstrument(o.instrument_name);
        const expiryDate = parseDeribitExpiry(parsed.expiry);
        const now = new Date();
        const daysToExpiry = Math.max(0, (expiryDate - now) / (86400 * 1000));

        // Price conversion: Deribit quotes in BTC, convert to USD
        const bidUsd = (o.bid_price || 0) * btcSpot;
        const markUsd = (o.mark_price || 0) * btcSpot;
        const otmPct = ((btcSpot - parsed.strike) / btcSpot) * 100;

        // Annualized yield: (premium / strike) × (365 / days) × 100
        const annYield = daysToExpiry > 0
          ? (bidUsd / parsed.strike) * (365 / daysToExpiry) * 100
          : 0;

        return {
          instrument: o.instrument_name,
          expiry: parsed.expiry,
          expiryDate: expiryDate.toISOString().slice(0, 10),
          daysToExpiry: Math.round(daysToExpiry * 10) / 10,
          strike: parsed.strike,
          otmPct: Math.round(otmPct * 100) / 100,
          bidBtc: o.bid_price || 0,
          bidUsd: Math.round(bidUsd * 100) / 100,
          markUsd: Math.round(markUsd * 100) / 100,
          annYield: Math.round(annYield * 100) / 100,
          markIv: o.mark_iv || 0,
          openInterest: o.open_interest || 0,
          volume24h: o.volume || 0,
        };
      })
      .filter(p => p.daysToExpiry > 0 && p.bidBtc > 0); // Remove expired & no-bid

    // Group by expiry, sort groups by date, within each group sort by strike descending
    const expiryMap = new Map();
    for (const p of puts) {
      if (!expiryMap.has(p.expiry)) {
        expiryMap.set(p.expiry, {
          expiry: p.expiry,
          expiryDate: p.expiryDate,
          daysToExpiry: p.daysToExpiry,
          puts: [],
        });
      }
      expiryMap.get(p.expiry).puts.push(p);
    }

    const expirations = [...expiryMap.values()]
      .sort((a, b) => a.daysToExpiry - b.daysToExpiry)
      .map(group => {
        group.puts.sort((a, b) => b.strike - a.strike);
        return group;
      });

    const result = { btcSpot, expirations, totalPuts: puts.length };
    cache.set(OPTIONS_CACHE_KEY, result, OPTIONS_TTL);
    console.log(`[Deribit Options] Fetched ${puts.length} puts across ${expirations.length} expirations, BTC=$${Math.round(btcSpot)}`);
    return result;
  } catch (err) {
    console.error('[Deribit Options] Error:', err.message);
    const stale = cache.get(OPTIONS_CACHE_KEY);
    if (stale) return stale;
    return { btcSpot: 0, expirations: [], totalPuts: 0 };
  }
}

async function fetchOptionDetail(instrumentName) {
  const detailKey = `options:detail:${instrumentName}`;
  const cached = cache.get(detailKey);
  if (cached) return cached;

  try {
    const resp = await fetch(`${DERIBIT_BASE}/ticker?instrument_name=${encodeURIComponent(instrumentName)}`);
    if (!resp.ok) throw new Error(`Ticker API ${resp.status}`);
    const json = await resp.json();
    const r = json.result;
    if (!r) throw new Error('No ticker result');

    const greeks = r.greeks || {};
    const detail = {
      instrument: r.instrument_name,
      delta: greeks.delta || 0,
      gamma: greeks.gamma || 0,
      vega: greeks.vega || 0,
      theta: greeks.theta || 0,
      rho: greeks.rho || 0,
      markIv: r.mark_iv || 0,
      bidIv: r.bid_iv || 0,
      askIv: r.ask_iv || 0,
      underlyingPrice: r.underlying_price || 0,
      openInterest: r.open_interest || 0,
      volume24h: r.stats?.volume || 0,
      bidPrice: r.best_bid_price || 0,
      askPrice: r.best_ask_price || 0,
      markPrice: r.mark_price || 0,
    };

    cache.set(detailKey, detail, DETAIL_TTL);
    return detail;
  } catch (err) {
    console.error(`[Deribit Detail] Error for ${instrumentName}:`, err.message);
    return null;
  }
}

function getCached() {
  return cache.get(OPTIONS_CACHE_KEY);
}

module.exports = { fetchOptions, fetchOptionDetail, getCached, parseDeribitExpiry };
