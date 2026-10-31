'use strict';

/**
 * Per-connection, per-event rate limiting.
 *
 * Legacy had NONE on this transport. That matters most for two events:
 *
 *   - `C.LOGIN_USER`, where password guessing over the socket was unmetered
 *     and invisible to every HTTP rate limiter in front of the service;
 *   - `C.SEND_TIP` and `C.RAIN`, which move money and were callable as fast as
 *     a client could emit.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────
 *
 * IN-PROCESS. Two service replicas keep two counters, so the effective limit
 * is the configured one times the replica count. That is a real limitation and
 * it is written down rather than discovered: the same caveat applies to the
 * staff login throttle in admin-service, and the durable fix for both is a
 * shared store.
 *
 * It is still worth having. The attack it stops — one socket emitting
 * thousands of messages a second — is not distributed across replicas, because
 * one socket is pinned to one replica for its lifetime.
 */

/** A fixed window per key. Simpler than a sliding one and adequate here. */
function createRateLimiter({ logger } = {}) {
  /** key -> { count, resetAt } */
  const buckets = new Map();

  /**
   * Sweep expired buckets.
   *
   * Without this the map grows for the life of the process — every key any
   * socket ever used. Legacy would have had the same problem had it had a
   * limiter at all.
   */
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, 60_000);

  // Never hold the process open for a housekeeping timer.
  sweep.unref?.();

  return {
    /** @returns {boolean} true if the message is within the limit. */
    allow(key, { windowMs, max }) {
      const now = Date.now();
      const bucket = buckets.get(key);

      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }

      bucket.count += 1;
      if (bucket.count <= max) return true;

      /**
       * Log the FIRST rejection in a window, not every one — a client in a
       * loop would otherwise turn a rate limit into a log flood, which is the
       * same denial of service one layer down.
       */
      if (bucket.count === max + 1) logger?.warn({ key }, 'Socket rate limit reached');
      return false;
    },

    /** Drop every bucket for a connection that has gone away. */
    forget(prefix) {
      for (const key of buckets.keys()) {
        if (key.startsWith(`${prefix}:`)) buckets.delete(key);
      }
    },

    /** For tests. */
    stop() {
      clearInterval(sweep);
      buckets.clear();
    },

    get size() {
      return buckets.size;
    },
  };
}

module.exports = { createRateLimiter };
