// Risk scoring algorithm — ported from YieldGPS + stablecoin-mvp safety rules
// Score range: 1-10 (higher = safer)

// Protocol maturity tiers
const BLUE_CHIPS = new Set([
  'aave-v3', 'aave-v2', 'compound-v3', 'compound-v2',
  'sky-lending', 'maker', 'lido', 'rocket-pool',
  'curve-dex', 'uniswap-v3', 'convex-finance',
]);

const ESTABLISHED = new Set([
  'ethena-usde', 'maple', 'morpho-v1', 'morpho-blue', 'euler-v2',
  'venus-core-pool', 'venus', 'benqi-lending', 'radiant-v2',
  'spark', 'spark-savings', 'fluid-lending',
  'kamino-lend', 'save', 'navi-lending', 'scallop-lend',
  'moonwell-lending', 'pendle', 'aerodrome-v1', 'aerodrome-slipstream',
]);

// Chains with stronger security track records
const SAFE_CHAINS = new Set([
  'Ethereum', 'Arbitrum', 'Base', 'Polygon', 'BSC', 'Avalanche', 'Optimism',
]);

// Lending protocols (organic yield source)
const LENDING_RE = /aave|compound|morpho|euler|venus|spark|fluid|maple|benqi|kamino-lend|save|navi|scallop|moonwell|lista/i;
const DEX_RE = /curve|uniswap|pancake|aerodrome|velodrome|camelot|cetus|orca|raydium|bluefin/i;
const STAKING_RE = /lido|rocket|coinbase|frax-ether|mantle|binance-staked|jito/i;
const BASIS_RE = /ethena/i;
const RWA_RE = /sky|maker|ondo|mountain|backed|hashnote|spark-savings/i;

function scorePool(pool) {
  const proj = (pool.project || '').toLowerCase();
  const apy = pool.apy || 0;
  const tvl = pool.tvlUsd || 0;
  const chain = pool.chain || '';
  const apyBase = pool.apyBase || 0;
  const apyReward = pool.apyReward || 0;

  let score = 5; // baseline

  // --- Protocol maturity ---
  if (BLUE_CHIPS.has(proj)) score += 2.5;
  else if (ESTABLISHED.has(proj)) score += 1.5;
  else score -= 0.5;

  // --- TVL ---
  if (tvl >= 1_000_000_000) score += 1.5;       // $1B+
  else if (tvl >= 100_000_000) score += 1.0;     // $100M+
  else if (tvl >= 50_000_000) score += 0.5;      // $50M+
  else if (tvl >= 10_000_000) score += 0;        // $10M+ baseline
  else score -= 1.0;                              // below $10M — risky

  // --- APY sustainability (unusually high = suspicious) ---
  if (apy > 100) score -= 3;
  else if (apy > 50) score -= 2;
  else if (apy > 30) score -= 1;
  else if (apy > 15) score -= 0.3;

  // --- Yield source quality ---
  const organicRatio = apy > 0 ? apyBase / apy : 1;
  if (organicRatio > 0.8) score += 0.5;         // mostly organic
  else if (organicRatio < 0.3) score -= 0.5;    // mostly token rewards

  // Yield type bonus
  if (LENDING_RE.test(proj)) score += 0.3;
  if (RWA_RE.test(proj)) score += 0.3;
  if (BASIS_RE.test(proj)) score += 0.1;

  // --- Chain safety ---
  if (SAFE_CHAINS.has(chain)) score += 0.3;

  // Clamp to 1-10
  score = Math.max(1, Math.min(10, score));
  score = Math.round(score * 10) / 10;

  // Risk label
  let riskLabel;
  if (score >= 8) riskLabel = 'low';
  else if (score >= 6) riskLabel = 'medium';
  else if (score >= 4) riskLabel = 'elevated';
  else riskLabel = 'high';

  return { score, riskLabel };
}

// Safety filter: returns true if pool passes minimum safety criteria
function passesFilter(pool, opts = {}) {
  const minTvl = opts.minTvl || 10_000_000;    // $10M default
  const minScore = opts.minScore || 3;           // reject <3 as dangerous
  const maxApy = opts.maxApy || 200;             // reject obviously broken data

  const tvl = pool.tvlUsd || 0;
  const apy = pool.apy || 0;

  if (tvl < minTvl) return false;
  if (apy <= 0) return false;
  if (apy > maxApy) return false;

  const { score } = scorePool(pool);
  if (score < minScore) return false;

  return true;
}

module.exports = { scorePool, passesFilter, BLUE_CHIPS, ESTABLISHED };
