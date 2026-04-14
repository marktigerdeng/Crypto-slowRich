# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SlowRich Dashboard — a real-time investment monitoring dashboard for a $1M stablecoin portfolio. Tracks DeFi/CeFi yields, BTC options, ETF prices, and market sentiment. Pure server-rendered HTML frontend (no build step, no framework).

## Commands

```bash
npm install          # install dependencies
npm start            # start server (default port 3001)
npm run pm2:start    # production: start with PM2
npm run pm2:restart  # restart after code changes
npm run pm2:logs     # tail PM2 logs
```

No test suite or linter configured.

## Architecture

**Express server** (`server.js`) with scheduled data fetching + static file serving.

### Data flow: Fetchers → Cache → API → Frontend

1. **Fetchers** (`fetchers/`) — each fetcher pulls from an external API and writes to the in-memory cache (`cache/store.js`). Each has its own refresh interval (2–30 min) set in `server.js`.
2. **Cache** (`cache/store.js`) — simple in-memory Map with TTL expiry. No persistence (data re-fetched on restart).
3. **API routes** (`routes/api.js`) — single file, all endpoints under `/api/*`. Reads from cache, enriches with portfolio config, returns JSON.
4. **Frontend** (`public/`) — standalone HTML files with inline CSS/JS. Uses Chart.js for charts. No build, no bundling.

### Key data sources and their fetchers

| Fetcher | Source | Interval | Notes |
|---------|--------|----------|-------|
| `defillama.js` | DeFiLlama Yields API | 5 min | Stablecoin pool rates, filtered by risk score |
| `binance-earn.js` | Binance Earn | 30 min | Falls back to `config/cefi-rates.json` on 403 |
| `okx-earn.js` | OKX Earn | 30 min | Falls back to `config/cefi-rates.json` |
| `binance-announcements.js` | Binance CMS | 15 min | Exchange announcements feed |
| `okx-announcements.js` | OKX API | 15 min | Exchange announcements feed |
| `deribit-options.js` | Deribit API | 2 min | BTC put options chain + DVOL |
| `yahoo-etf.js` | yahoo-finance2 + Stooq fallback | On-demand, 4h cache | ETF historical prices for backtests |
| `fear-greed.js` | Alternative.me | 30 min | Fear & Greed index |

On-demand API endpoints in `routes/api.js` (not in fetchers/):
- **JLP stats** (`/api/jlp-stats`): CoinGecko for price + DeFiLlama for APR, 5 min cache
- **Funding rates** (`/api/funding-rates`): Binance + OKX + Bybit perpetual rates, 5 min cache
- **Astar/hedge funding** (`/api/astar-funding`): Binance SOL-USDT perp as hedge cost proxy

### Config files

- `config/portfolio.json` — stablecoin portfolio: 3 tiers (safety/growth/tactical), each with positions that reference DeFiLlama pool IDs for live APY matching. The `buildPortfolioSummary()` function in `routes/api.js` computes weighted APY across all positions.
- `config/allweather.json` — all-weather portfolio: sector allocations (US equities, crypto, bonds, commodities, China/HK) with per-position target weights and rebalance thresholds.
- `config/cefi-rates.json` — manually maintained CeFi rates, used as fallback when Binance/OKX APIs return 403.

### Risk scoring

`cache/risk-scoring.js` scores DeFi pools 1–10 based on protocol maturity (blue-chip vs established vs unknown), TVL, APY sustainability, yield source quality, and chain safety. Used to filter the pool list shown in the dashboard.

### Portfolio history

`cache/portfolio-history.js` records periodic snapshots of portfolio performance. Snapshots are triggered after DeFiLlama data refreshes (every 5 min).

## Frontend pages

All in `public/`. Each is a self-contained HTML file with inline styles and scripts.

- `index.html` — main dashboard: live signals (options, DeFi rates, CTA), strategy grid, knowledge base links
- `backtest-*.html` — strategy backtests (wheel, IBIT wheel, dip-buying, all-weather, CTA)
- `options-monitor.html` — BTC options chain monitor
- `delta-neutral.html` — delta-neutral strategy analysis
- `portfolio-summary.html` — portfolio overview with historical tracking
- `allweather.html` — all-weather portfolio dashboard with rebalance signals
- `news.html` — aggregated exchange announcements (Binance + OKX)
- `articles/` — blog/knowledge base articles (WeChat reposts). Named `day{N}-YYYY-MM-DD.html`. See `articles/PUBLISH-GUIDE.md` for publishing workflow.

## Design system

Light theme (Notion/Linear style). See `STYLE_GUIDE.md` in parent directory for full spec:
- Background: #fafafa, cards: #ffffff, borders: #e5e7eb
- Accent colors: #10b981 (green), #f59e0b (amber)
- Font: Inter / system-ui, card border-radius: 10-12px
- Nav: `SlowRich | 实盘信号 | 策略库 | 知识库 | 组合`

## Environment variables

Only `PORT` and optional `BINANCE_API_KEY`/`BINANCE_SECRET_KEY` (see `.env.example`). Missing Binance keys cause graceful fallback to manual rates.

## Known issues

- Binance CMS/Earn APIs return 403 from certain server IPs (geo-blocking). Falls back to `config/cefi-rates.json` — update manual rates periodically.
- Yahoo Finance rate-limits cloud IPs. Retry with backoff is implemented; Stooq.com CSV used as fallback for standard ETFs. Results cache for 4h.
- CoinGecko free tier rate limit (~30 calls/min). JLP stats use a single batched call with 3s startup delay to avoid burst conflicts with other fetchers.

## Related documents

- `STRATEGIES.md` — complete strategy documentation for all four strategies
- `../STYLE_GUIDE.md` — full design system spec (colors, typography, spacing)
- `../DASHBOARD_REQUIREMENTS.md` — product requirements
- `../DELTA_NEURAL_REQUIREMENTS.md` — delta-neutral strategy requirements
