# Stablecoin Dashboard - Deployment Guide

## Prerequisites

- Node.js >= 18 (tested on v22)
- PM2 (process manager): `sudo npm install -g pm2`

## Quick Start

```bash
cd dashboard
cp .env.example .env    # edit as needed
npm install
npm run pm2:start       # start with PM2
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3001) |
| `BINANCE_API_KEY` | No | Binance API key for auth endpoint |
| `BINANCE_SECRET_KEY` | No | Binance API secret |

> If Binance API keys are not set, the system falls back to manual rates in `config/cefi-rates.json`.

## PM2 Commands

```bash
npm run pm2:start       # Start the dashboard
npm run pm2:stop        # Stop
npm run pm2:restart     # Restart (after code changes)
npm run pm2:logs        # View logs
npm run pm2:status      # Check process status
```

Or directly:

```bash
pm2 start ecosystem.config.js   # Start
pm2 restart stablecoin-dashboard # Restart
pm2 logs stablecoin-dashboard    # Tail logs
pm2 monit                        # Real-time monitor
```

## Auto-Start on Reboot

```bash
pm2 startup             # Generate startup script (run the output command with sudo)
pm2 save                # Save current process list
```

## Architecture

```
dashboard/
  server.js              # Express server + scheduler
  routes/api.js          # All API endpoints
  fetchers/              # Data fetchers (each with cache + fallback)
    defillama.js         # DeFi pool rates (5 min)
    binance-earn.js      # Binance CeFi rates (30 min)
    okx-earn.js          # OKX CeFi rates (30 min)
    binance-announcements.js  # Binance news (15 min)
    okx-announcements.js      # OKX news (15 min)
    deribit-options.js   # BTC put options (2 min)
    fear-greed.js        # Fear & Greed index (30 min)
    yahoo-etf.js         # ETF price data (on-demand, 4h cache)
  cache/
    store.js             # In-memory TTL cache
    risk-scoring.js      # Pool safety scoring (1-10)
  config/
    portfolio.json       # Portfolio allocation config
    cefi-rates.json      # Manual fallback CeFi rates
  public/                # Frontend HTML files
  ecosystem.config.js    # PM2 configuration
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/health` | Service health + data freshness |
| `GET /api/portfolio` | Portfolio with live APY rates |
| `GET /api/rates/defi` | DeFi pool rates with risk scores |
| `GET /api/rates/cefi` | CeFi rates (Binance + OKX) |
| `GET /api/announcements` | Platform announcements |
| `GET /api/options` | BTC put options chain |
| `GET /api/options/detail?instrument=...` | Single option Greeks |
| `GET /api/timing` | Sell-put timing score |
| `GET /api/etf-prices?symbols=SPY,GLD&years=5` | ETF historical prices |
| `GET /api/btc-prices?days=365` | BTC price history |
| `GET /api/crypto-prices?asset=BTC&days=365` | BTC/ETH price history |
| `GET /api/btc-dvol` | BTC implied volatility index |
| `GET /api/crypto-dvol?asset=BTC` | BTC/ETH DVOL data |

## Data Refresh Schedule

| Source | Interval | Fallback |
|--------|----------|----------|
| DeFiLlama pools | 5 min | Stale cache |
| Binance/OKX rates | 30 min | Manual rates (cefi-rates.json) |
| Announcements | 15 min | Cached or fallback link |
| Deribit options | 2 min | Stale cache |
| Fear & Greed | 30 min | Stale cache |
| Yahoo ETF | On-demand | 4h cache, retry on rate-limit |

## Known Limitations

- **Binance 403**: Binance CMS/Earn APIs return 403 from certain server IPs (geo-blocking/WAF). The system gracefully falls back to `config/cefi-rates.json`. Update manual rates periodically.
- **Yahoo Finance rate-limiting**: The Yahoo Finance API may return "Too Many Requests" from cloud IPs. Retry with backoff is implemented; results cache for 4 hours once fetched.

## Logs

PM2 logs are stored in `dashboard/logs/`:
- `out.log` — stdout
- `err.log` — stderr

View with: `pm2 logs stablecoin-dashboard`

## Updating Manual Rates

When API fallbacks are used, update `config/cefi-rates.json` with current rates from Binance/OKX websites. Update the `_updated` date field.
