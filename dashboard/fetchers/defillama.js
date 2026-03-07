const cache = require('../cache/store');
const portfolio = require('../config/portfolio.json');
const { passesFilter } = require('../cache/risk-scoring');

const API_URL = 'https://yields.llama.fi/pools';
const CACHE_KEY = 'defi:pools';
const TTL = 5 * 60 * 1000; // 5 minutes

// Collect all defillamaProject values from portfolio
const portfolioProjects = new Set();
const portfolioPools = new Set();
portfolio.tiers.forEach(tier => {
  tier.positions.forEach(pos => {
    if (pos.defillamaProject) portfolioProjects.add(pos.defillamaProject);
    if (pos.defillamaPool) portfolioPools.add(pos.defillamaPool);
  });
});

// Stablecoin symbols to filter
const STABLECOINS = ['usdc', 'usdt', 'dai', 'usds', 'usde', 'susds', 'susde', 'frax', 'crvusd', 'lusd', 'gusd', 'pyusd', 'buck', 'ausd'];

// Top chains by stablecoin TVL (Ethereum always included via portfolio)
const WATCHLIST_CHAINS = new Set([
  'Base', 'Arbitrum', 'Solana', 'Avalanche', 'BSC',
]);

// Key protocols per chain we want to track
const WATCHLIST_PROJECTS = new Set([
  // Solana
  'kamino-lend', 'save', 'drift', 'marginfi', 'loopscale',
  // Base
  'moonwell-lending', 'aerodrome-v1', 'aerodrome-slipstream', 'compound-v3',
  // BSC
  'venus-core-pool', 'lista-lending',
  // Avalanche
  'benqi-lending', 'spark-savings',
  // Cross-chain
  'aave-v3', 'euler-v2', 'morpho-v1',
]);

function isStablecoinPool(pool) {
  const sym = (pool.symbol || '').toLowerCase();
  return STABLECOINS.some(s => sym.includes(s));
}

async function fetchPools() {
  try {
    const resp = await fetch(API_URL);
    if (!resp.ok) throw new Error(`DeFiLlama API ${resp.status}`);
    const json = await resp.json();
    const pools = json.data || [];

    // Filter: stablecoin pools from portfolio projects OR pools explicitly in portfolio
    // Portfolio pools bypass safety filter (we always want to see our own positions)
    const relevant = pools.filter(p => {
      const proj = (p.project || '').toLowerCase();
      const inPortfolio = portfolioPools.has(p.pool);
      const inProject = portfolioProjects.has(proj) && isStablecoinPool(p);
      return inPortfolio || inProject;
    });

    // Only show pools from target chains (Ethereum always included via portfolio)
    const TARGET_CHAINS = new Set(['Ethereum', ...WATCHLIST_CHAINS]);

    // Top stablecoin pools for rate comparison — apply safety filter + chain filter
    const safeStable = pools.filter(p =>
      isStablecoinPool(p) && passesFilter(p) && TARGET_CHAINS.has(p.chain || '')
    );
    safeStable.sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0));
    const topStable = safeStable.slice(0, 200);

    // Watchlist: additional chain pools that pass safety
    const watchlistPools = pools.filter(p => {
      const proj = (p.project || '').toLowerCase();
      const chain = p.chain || '';
      const isWatchProj = WATCHLIST_PROJECTS.has(proj);
      const isWatchChain = WATCHLIST_CHAINS.has(chain);
      return (isWatchProj || isWatchChain) && isStablecoinPool(p) && passesFilter(p) && TARGET_CHAINS.has(chain);
    });

    // Merge top stable + watchlist, deduplicate by pool ID
    const seen = new Set(topStable.map(p => p.pool));
    const merged = [...topStable];
    for (const p of watchlistPools) {
      if (!seen.has(p.pool)) {
        merged.push(p);
        seen.add(p.pool);
      }
    }
    merged.sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0));

    // Stats for logging
    const filtered = pools.filter(p => isStablecoinPool(p) && (p.tvlUsd || 0) > 0 && (p.apy || 0) > 0).length;

    const result = { portfolioPools: relevant, topStablePools: merged };
    cache.set(CACHE_KEY, result, TTL);
    console.log(`[DeFiLlama] ${pools.length} total → ${filtered} stable → ${merged.length} passed safety (TVL≥$10M, score≥3, APY≤200%)`);
    return result;
  } catch (err) {
    console.error('[DeFiLlama] Fetch error:', err.message);
    return cache.get(CACHE_KEY); // return stale if available
  }
}

function getCached() {
  return cache.get(CACHE_KEY);
}

// Find the best matching pool for a portfolio position
function matchPool(position, pools) {
  if (!pools) return null;
  // Exact pool ID match
  if (position.defillamaPool) {
    const exact = pools.find(p => p.pool === position.defillamaPool);
    if (exact) return exact;
  }
  // Fuzzy: match project + chain
  if (position.defillamaProject && position.chain) {
    const candidates = pools.filter(p =>
      (p.project || '').toLowerCase() === position.defillamaProject &&
      (p.chain || '').toLowerCase() === position.chain.toLowerCase() &&
      isStablecoinPool(p)
    );
    if (candidates.length > 0) {
      // Pick highest TVL match
      return candidates.sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))[0];
    }
  }
  return null;
}

module.exports = { fetchPools, getCached, matchPool };
