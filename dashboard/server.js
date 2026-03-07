require('dotenv').config();
const express = require('express');
const path = require('path');
const apiRoutes = require('./routes/api');

// Fetchers
const defillama = require('./fetchers/defillama');
const binanceEarn = require('./fetchers/binance-earn');
const okxEarn = require('./fetchers/okx-earn');
const binanceAnn = require('./fetchers/binance-announcements');
const okxAnn = require('./fetchers/okx-announcements');
const deribitOptions = require('./fetchers/deribit-options');
const fearGreed = require('./fetchers/fear-greed');

const app = express();
const PORT = process.env.PORT || 8082;

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', apiRoutes);

// SPA fallback
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

// DeFi rates: every 5 minutes
setInterval(() => defillama.fetchPools(), 5 * 60 * 1000);

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

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Stablecoin Dashboard running at http://localhost:${PORT}\n`);
});
