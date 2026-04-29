// In-memory manifest cache.
//
// Cache key = hash(prompt + inferred_intent). 30-minute TTL. No localStorage —
// cache lives for the lifetime of the host page only, so private/scoped state
// in the prompt never leaks to disk.

const TTL_MS = 30 * 60 * 1000;

const store = new Map(); // key -> { value, expiresAt }

// FNV-1a 32-bit hash — small, fast, stable. Good enough for cache keys.
// Not cryptographic — do NOT use to authenticate anything.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function makeCacheKey(prompt, queryIntent) {
  const p = (prompt ?? "").toString();
  const q = (queryIntent ?? "").toString();
  return `${fnv1a(p)}-${fnv1a(q)}-${p.length}-${q.length}`;
}

function purgeExpired(now = Date.now()) {
  for (const [k, entry] of store) {
    if (entry.expiresAt <= now) store.delete(k);
  }
}

export function get(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function set(key, value, ttlMs = TTL_MS) {
  purgeExpired();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function has(key) {
  return get(key) !== undefined;
}

export function clear() {
  store.clear();
}

export function size() {
  purgeExpired();
  return store.size;
}

// Test/debug helper. Inspect entries without exposing the Map.
export function snapshot() {
  purgeExpired();
  return [...store.entries()].map(([k, { expiresAt }]) => ({
    key: k,
    expiresInMs: Math.max(0, expiresAt - Date.now()),
  }));
}

export const __ttlMs = TTL_MS;
