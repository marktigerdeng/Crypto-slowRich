/**
 * telegram-alert.js
 *
 * Telegram 预警模块 — 当市场情绪触发关键阈值时自动推送通知
 *
 * 环境变量：
 *   TELEGRAM_BOT_TOKEN  — Bot Token (从 @BotFather 获取)
 *   TELEGRAM_CHAT_ID    — 目标 Chat ID（虎哥的 Telegram ID 或群组 ID）
 *
 * 触发条件（任一满足即推送）：
 *   - 综合情绪评分 >= 75（极度贪婪预警）
 *   - 综合情绪评分 <= 20（极度恐慌信号 → Sell Put 窗口）
 *   - 情绪评分穿越关键阈值（35/55/70 附近 ±3）
 *   - 恐慌指数 <= 20 且 VRP > 0（期权开仓信号）
 *   - 每日 21:00 固定晚报
 */

const cache = require('../cache/store');

const TELEGRAM_API = 'https://api.telegram.org';
const ALERT_STATE_KEY = 'telegram:alert:state';
const DAILY_REPORT_KEY = 'telegram:daily:lastSent';

// Alert thresholds
const THRESHOLDS = {
  extremeGreed: 75,   // score >= 75
  extremeFear: 20,    // score <= 20
  greedZone: 70,      // score crosses 70
  fearZone: 30,       // score crosses 30
  optionWindow: { fg: 30, vrp: 0 },  // fg <= 30 AND vrp > 0
};

// Cooldown: don't re-alert same condition within N minutes
const COOLDOWNS = {
  extremeGreed: 4 * 60,   // 4 hours
  extremeFear: 4 * 60,
  greedZone: 2 * 60,
  fearZone: 2 * 60,
  optionWindow: 6 * 60,
  daily: 23 * 60,         // once per day
};

function getToken() { return process.env.TELEGRAM_BOT_TOKEN; }
function getChatId() { return process.env.TELEGRAM_CHAT_ID; }
function isConfigured() { return !!(getToken() && getChatId()); }

async function sendMessage(text, parseMode = 'HTML') {
  if (!isConfigured()) {
    console.log('[TelegramAlert] Not configured (missing BOT_TOKEN or CHAT_ID), skipping.');
    return false;
  }
  try {
    const url = `${TELEGRAM_API}/bot${getToken()}/sendMessage`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: getChatId(), text, parse_mode: parseMode }),
    });
    const json = await resp.json();
    if (!json.ok) {
      console.error('[TelegramAlert] Send failed:', json.description);
      return false;
    }
    console.log('[TelegramAlert] Sent:', text.slice(0, 60));
    return true;
  } catch (err) {
    console.error('[TelegramAlert] Error:', err.message);
    return false;
  }
}

function getState() {
  return cache.get(ALERT_STATE_KEY) || {};
}

function setState(key, value) {
  const state = getState();
  state[key] = value;
  // State TTL: 24 hours
  cache.set(ALERT_STATE_KEY, state, 24 * 60 * 60 * 1000);
}

function inCooldown(key) {
  const state = getState();
  const last = state[key];
  if (!last) return false;
  const cooldownMs = (COOLDOWNS[key] || 60) * 60 * 1000;
  return Date.now() - last < cooldownMs;
}

function markSent(key) {
  setState(key, Date.now());
}

function scoreEmoji(score) {
  if (score <= 20) return '😱';
  if (score <= 35) return '😨';
  if (score <= 55) return '😐';
  if (score <= 70) return '😊';
  return '🤑';
}

function scoreLevel(score) {
  if (score <= 20) return '极度恐慌';
  if (score <= 35) return '恐慌';
  if (score <= 55) return '中性';
  if (score <= 70) return '贪婪';
  return '极度贪婪';
}

function buildAlertMessage(sentiment, type) {
  const c = sentiment.composite;
  const d = sentiment.dimensions;
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

  const header = {
    extremeGreed: `🤑 <b>极度贪婪预警</b>`,
    extremeFear: `😱 <b>极度恐慌信号</b>`,
    greedZone: `⚠️ <b>情绪进入贪婪区间</b>`,
    fearZone: `😨 <b>情绪进入恐慌区间</b>`,
    optionWindow: `🎯 <b>期权开仓窗口开启</b>`,
  }[type] || '📊 市场情绪预警';

  const body = `
${header}

${scoreEmoji(c)} <b>综合评分：${c} / 100</b>（${scoreLevel(c)}）

📊 各维度数据：
• 恐慌贪婪：${d.fearGreed.value} — ${d.fearGreed.label}
• 资金费率：BTC ${d.funding.btcRate != null ? (d.funding.btcRate > 0 ? '+' : '') + d.funding.btcRate.toFixed(4) + '%' : '—'}/8h
• VRP溢价：${d.vrp.spread != null ? (d.vrp.spread > 0 ? '+' : '') + d.vrp.spread.toFixed(1) + '%' : '—'}
• CTA信号：${d.cta.signal === 'bullish' ? '看涨 ↑' : d.cta.signal === 'bearish' ? '看跌 ↓' : '震荡'}

💡 建议：${sentiment.recommendation}

🕐 ${ts}`;

  return body.trim();
}

function buildDailyReport(sentiment) {
  const c = sentiment.composite;
  const d = sentiment.dimensions;
  const ts = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

  // Suggested allocation
  const alloc = sentiment.suggestedAllocation;

  return `
📊 <b>SlowRich 每日晚报</b>
━━━━━━━━━━━━━━━

${scoreEmoji(c)} <b>市场情绪：${c} / 100（${scoreLevel(c)}）</b>

📈 各维度：
• 恐慌贪婪：${d.fearGreed.value}（${d.fearGreed.label}）
• BTC资金费：${d.funding.btcRate != null ? (d.funding.btcRate > 0 ? '+' : '') + d.funding.btcRate.toFixed(4) + '%' : '—'}/8h
• VRP溢价：${d.vrp.spread != null ? (d.vrp.spread > 0 ? '+' : '') + d.vrp.spread.toFixed(1) + '%' : '—'}
• CTA趋势：${d.cta.signal === 'bullish' ? '✅ 看涨' : d.cta.signal === 'bearish' ? '🔴 看跌' : '🟡 震荡'}

📐 建议仓位：
• 稳定币理财：${alloc.stable}%
• 期权 Sell Put：${alloc.options}%
• CTA趋势：${alloc.cta}%
• 长期持有：${alloc.longHold}%

💡 ${sentiment.recommendation}

🕐 ${ts} | SlowRich 🍮
`.trim();
}

/**
 * Check sentiment and fire alerts if thresholds are crossed.
 * Call this from server.js after each sentiment computation.
 */
async function checkAndAlert(sentiment) {
  if (!isConfigured()) return;
  if (!sentiment || sentiment.composite == null) return;

  const c = sentiment.composite;
  const d = sentiment.dimensions;
  const fg = d.fearGreed.value;
  const vrp = d.vrp.spread;

  // Get previous composite for cross detection
  const state = getState();
  const prev = state.prevComposite ?? null;

  const tasks = [];

  // 1. Extreme greed
  if (c >= THRESHOLDS.extremeGreed && !inCooldown('extremeGreed')) {
    tasks.push({ key: 'extremeGreed', msg: buildAlertMessage(sentiment, 'extremeGreed') });
  }

  // 2. Extreme fear
  if (c <= THRESHOLDS.extremeFear && !inCooldown('extremeFear')) {
    tasks.push({ key: 'extremeFear', msg: buildAlertMessage(sentiment, 'extremeFear') });
  }

  // 3. Crosses into greed zone (prev < 70, now >= 70)
  if (prev != null && prev < THRESHOLDS.greedZone && c >= THRESHOLDS.greedZone && !inCooldown('greedZone')) {
    tasks.push({ key: 'greedZone', msg: buildAlertMessage(sentiment, 'greedZone') });
  }

  // 4. Crosses into fear zone (prev > 30, now <= 30)
  if (prev != null && prev > THRESHOLDS.fearZone && c <= THRESHOLDS.fearZone && !inCooldown('fearZone')) {
    tasks.push({ key: 'fearZone', msg: buildAlertMessage(sentiment, 'fearZone') });
  }

  // 5. Option window: fg <= 30 AND vrp > 0
  if (fg != null && vrp != null && fg <= THRESHOLDS.optionWindow.fg && vrp > THRESHOLDS.optionWindow.vrp && !inCooldown('optionWindow')) {
    tasks.push({ key: 'optionWindow', msg: buildAlertMessage(sentiment, 'optionWindow') });
  }

  // Send alerts
  for (const task of tasks) {
    const ok = await sendMessage(task.msg);
    if (ok) markSent(task.key);
  }

  // Save previous composite
  setState('prevComposite', c);
}

/**
 * Send daily report — call this from a daily scheduler (21:00 CST)
 */
async function sendDailyReport(sentiment) {
  if (!isConfigured()) return false;
  if (inCooldown('daily')) return false;
  const msg = buildDailyReport(sentiment);
  const ok = await sendMessage(msg);
  if (ok) markSent('daily');
  return ok;
}

/**
 * Test: send a test message to verify configuration
 */
async function sendTestMessage() {
  return sendMessage(`✅ SlowRich Telegram 预警已配置成功！\n\n布丁将在关键市场时刻推送提醒 🍮\n\n时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
}

module.exports = {
  isConfigured,
  sendMessage,
  checkAndAlert,
  sendDailyReport,
  sendTestMessage,
};
