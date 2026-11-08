// agent/sessionStore.js — state per pelanggan (in-memory + TTL, untuk prototipe)
const TTL_MS = Number(process.env.SESSION_TTL_MS ?? 24 * 60 * 60 * 1000); // retensi 24 jam (UU PDP)
const store = new Map();

function get(msisdn) {
  const s = store.get(msisdn);
  if (!s) return {};
  if (Date.now() - s.updatedAt > TTL_MS) {
    store.delete(msisdn);
    return {};
  }
  return s.data;
}

function set(msisdn, patch) {
  store.set(msisdn, {
    data: { ...get(msisdn), ...patch },
    updatedAt: Date.now(),
  });
}

module.exports = { get, set };
