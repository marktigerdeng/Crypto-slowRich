/**
 * Unified Signals API V2
 * 
 * Endpoint: GET /api/v2/signals
 * 
 * Returns all core strategy signals in one call
 * 
 * Response:
 * {
 *   "generated_at": "2026-04-11T14:52:00Z",
 *   "cta": {
 *     "strategy_name": "TSMOM + Volatility Scaling",
 *     "btc": { "signal": "LONG", "position": 0.75, ... },
 *     "eth": { "signal": "NEUTRAL", "position": 0, ... }
 *   },
 *   "options": {
 *     "strategy_name": "Multi-Factor Sell Put",
 *     "btc": { "signal": "ENTER", "score": 8.5, ... }
 *   },
 *   "defi_yield": { ... }
 * }
 */

const express = require('express');
const router = express.Router();

// Import sub-routers
const ctaTsmomRouter = require('./api-v2-cta-tsmom');
const optionsRouter = require('./api-v2-options');

// Mount sub-routers
router.use('/cta-tsmom', ctaTsmomRouter);
router.use('/options-sell-put', optionsRouter);

// GET /api/v2/signals - Unified endpoint
router.get('/', async (req, res) => {
  try {
    // Fetch all signals in parallel
    const [ctaBtc, ctaEth, optionsBtc, optionsEth] = await Promise.allSettled([
      fetchCTASignal('BTC'),
      fetchCTASignal('ETH'),
      fetchOptionsSignal('BTC'),
      fetchOptionsSignal('ETH')
    ]);

    res.json({
      generated_at: new Date().toISOString(),
      cta: {
        strategy_name: 'TSMOM + Volatility Scaling',
        description: '时间序列动量 + 波动率缩放策略',
        btc: ctaBtc.status === 'fulfilled' ? ctaBtc.value : { error: ctaBtc.reason?.message },
        eth: ctaEth.status === 'fulfilled' ? ctaEth.value : { error: ctaEth.reason?.message }
      },
      options: {
        strategy_name: 'Multi-Factor Sell Put',
        description: '多因子期权Sell Put策略（恐慌指数 + DVOL + 跌幅）',
        btc: optionsBtc.status === 'fulfilled' ? optionsBtc.value : { error: optionsBtc.reason?.message },
        eth: optionsEth.status === 'fulfilled' ? optionsEth.value : { error: optionsEth.reason?.message }
      },
      _links: {
        cta_detail: '/api/v2/signals/cta-tsmom?asset=BTC',
        options_detail: '/api/v2/signals/options-sell-put?asset=BTC'
      }
    });
  } catch (err) {
    console.error('[Unified Signals] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch unified signals' });
  }
});

// Helper: Fetch CTA signal
async function fetchCTASignal(asset) {
  // Simulate internal API call
  const baseUrl = 'http://localhost:3001';
  const resp = await fetch(`${baseUrl}/api/v2/signals/cta-tsmom?asset=${asset}`);
  if (!resp.ok) throw new Error(`CTA API error: ${resp.status}`);
  return resp.json();
}

// Helper: Fetch Options signal
async function fetchOptionsSignal(asset) {
  const baseUrl = 'http://localhost:3001';
  const resp = await fetch(`${baseUrl}/api/v2/signals/options-sell-put?asset=${asset}`);
  if (!resp.ok) throw new Error(`Options API error: ${resp.status}`);
  return resp.json();
}

module.exports = router;
