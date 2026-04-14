// Stores portfolio snapshots for 7-day trend charts
// Ring buffer: one snapshot per 5-min interval, keep 7 days (2016 entries)

const MAX_ENTRIES = 2016; // 7 * 24 * 12 (every 5 min for 7 days)
const snapshots = [];

function addSnapshot(summary) {
  snapshots.push({
    ts: Date.now(),
    weightedApy: summary.weightedApy,
    annualIncome: summary.annualIncome,
    totalCapital: summary.totalCapital,
    tierApys: summary.tiers.map(t => ({
      name: t.name,
      weightedApy: t.weightedApy,
      annualIncome: t.annualIncome,
    })),
  });
  if (snapshots.length > MAX_ENTRIES) {
    snapshots.splice(0, snapshots.length - MAX_ENTRIES);
  }
}

function getHistory(hours = 168) { // default 7 days
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return snapshots.filter(s => s.ts >= cutoff);
}

function getLatest() {
  return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
}

module.exports = { addSnapshot, getHistory, getLatest };
