/**
 * In-process TTL cache for subject ids and Gateway tokens.
 *
 * Deliberately not Redis: both values are cheap, idempotent derivations of
 * Gateway state, so a cold cache after a restart costs one extra round trip.
 * Running several broker replicas is safe for the same reason — each converges
 * on the same token through the list-then-reveal path.
 */
export const createCache = () => {
  const entries = new Map();
  return {
    async get(key) {
      const entry = entries.get(key);
      if (!entry) {
        return null;
      }
      if (entry.expiresAt <= Date.now()) {
        entries.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(key, value, ttlSeconds) {
      entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    },
    async del(key) {
      entries.delete(key);
    },
    async close() {
      entries.clear();
    },
  };
};
