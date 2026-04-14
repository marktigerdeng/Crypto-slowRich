require('dotenv').config();
const express = require('express');
const path = require('path');
const apiRoutes = require('./routes/api');
const telegramAlert = require('./fetchers/telegram-alert');

// Fetchers
const defillama = require('./fetchers/defillama');
const binanceEarn = require('./fetchers/binance-earn');
const okxEarn = require('./fetchers/okx-earn');
const binanceAnn = require('./fetchers/binance-announcements');
const okxAnn = require('./fetchers/okx-announcements');
const deribitOptions = require('./fetchers/deribit-options');
const fearGreed = require('./fetchers/fear-greed');
const portfolioHistory = require('./cache/portfolio-history');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Global error handlers (prevent process crash) ---
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiRoutes);

// SPA fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/portfolio', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portfolio.html'));
});

// --- Scheduled fetching ---

async function fetchAll() {
  console.log(`[Scheduler] Fetching all data at ${new Date().toISOString()}`);
  await Promise.allSettled([
    defillama.fetchPools(),
    binanceEarn.fetchRates(),
    okxEarn.fetchRates(),
    binanceAnn.fetchAnnouncements(),
    okxAnn.fetchAnnouncements(),
    deribitOptions.fetchOptions(),
    fearGreed.fetchFearGreed(),
  ]);
}

// Initial fetch on startup
fetchAll();

// Record portfolio snapshot after initial data load
setTimeout(() => recordPortfolioSnapshot(), 30 * 1000);

// DeFi rates + portfolio snapshot: every 5 minutes
setInterval(() => {
  defillama.fetchPools().then(() => recordPortfolioSnapshot());
}, 5 * 60 * 1000);

// CeFi rates: every 30 minutes
setInterval(() => {
  binanceEarn.fetchRates();
  okxEarn.fetchRates();
}, 30 * 60 * 1000);

// Announcements: every 15 minutes
setInterval(() => {
  binanceAnn.fetchAnnouncements();
  okxAnn.fetchAnnouncements();
}, 15 * 60 * 1000);

// Options data: every 2 minutes
setInterval(() => deribitOptions.fetchOptions(), 2 * 60 * 1000);

// Fear & Greed: every 30 minutes
setInterval(() => fearGreed.fetchFearGreed(), 30 * 60 * 1000);

// Sentiment check: every 10 minutes — fire Telegram alerts when thresholds crossed
setInterval(async () => {
  try {
    const sentiment = await apiRoutes.computeSentiment();
    await telegramAlert.checkAndAlert(sentiment);
  } catch (err) {
    console.error('[SentimentAlert] Error:', err.message);
  }
}, 10 * 60 * 1000);

// Daily report at 21:00 CST (13:00 UTC)
function scheduleDailyReport() {
  const now = new Date();
  const next = new Date();
  next.setUTCHours(13, 0, 0, 0); // 21:00 CST = 13:00 UTC
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const delay = next - now;
  console.log(`[DailyReport] Scheduled in ${Math.round(delay / 60000)} min`);
  setTimeout(async () => {
    try {
      const sentiment = await apiRoutes.computeSentiment();
      await telegramAlert.sendDailyReport(sentiment);
    } catch (err) {
      console.error('[DailyReport] Error:', err.message);
    }
    scheduleDailyReport(); // reschedule for next day
  }, delay);
}
scheduleDailyReport();

// Portfolio snapshot recorder
function recordPortfolioSnapshot() {
  try {
    const summary = apiRoutes.buildPortfolioSummary();
    if (summary && summary.weightedApy > 0) {
      portfolioHistory.addSnapshot(summary);
      console.log(`[Snapshot] Recorded: APY=${summary.weightedApy}%, Income=$${summary.annualIncome}/yr`);
    }
  } catch (err) {
    console.error('[Snapshot] Error:', err.message);
  }
}

// Start server
const server = app.listen(PORT, () => {
  console.log(`\nStablecoin Dashboard running at http://localhost:${PORT}\n`);
});

// --- Graceful shutdown ---
function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down gracefully...`);
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
  // Force exit after 5s if server doesn't close
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
