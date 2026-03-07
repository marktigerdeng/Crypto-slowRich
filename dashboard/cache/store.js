// In-memory cache with TTL
const store = new Map();

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function set(key, value, ttlMs) {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    updatedAt: new Date().toISOString(),
  });
}

function getMeta(key) {
  const entry = store.get(key);
  if (!entry) return null;
  return {
    updatedAt: entry.updatedAt,
    expired: Date.now() > entry.expiresAt,
  };
}

function keys() {
  return [...store.keys()];
}

module.exports = { get, set, getMeta, keys };
