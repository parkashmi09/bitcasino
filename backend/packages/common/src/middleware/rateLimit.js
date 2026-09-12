'use strict';

const rateLimit = require('express-rate-limit');
const { fail } = require('../response');

/**
 * Rate limiting.
 *
 * Buckets are named so different route groups get independent budgets — a
 * player hammering login must not consume the allowance for placing bets.
 * Authenticated traffic is keyed by user id (a shared NAT would otherwise
 * throttle every player behind it together); anonymous traffic falls back to IP.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE COUNTERS LIVE IN REDIS, NOT IN THIS PROCESS'S HEAP
 *
 * `express-rate-limit` defaults to an in-memory store. Every limiter here used
 * that default, which means the numbers meant something other than what they
 * said: with four service instances behind the gateway, `max: 20` on login was
 * 80 attempts per window, and it grew with every instance added. The `.env`
 * comment had described `REDIS_URL` as the "shared rate-limit store" for as
 * long as the file existed — the limiter simply never reached for it.
 *
 * A shared store is what makes a limit a limit. Redis holds the counter, so
 * scaling out adds capacity without also handing an attacker more attempts.
 *
 * ── WHY THE CLIENT IS RESOLVED LAZILY ────────────────────────────────────
 *
 * Route modules build their limiters at mount time, which happens before the
 * service has finished wiring its container. Rather than thread a client
 * through fifteen call sites, the store resolves the shared connection on
 * first use — by which point boot is long over. One connection per process,
 * shared by every bucket.
 *
 * ── AND WHY A REDIS OUTAGE DOES NOT FAIL OPEN ────────────────────────────
 *
 * If Redis is unreachable the store falls back to a local counter for that
 * request rather than allowing it unmetered. A degraded limit is a limit; an
 * exception swallowed into `next()` is an open door on the login route.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * INCR and PEXPIRE as one round trip that cannot interleave.
 *
 * Done separately, two instances hitting a fresh key can both see INCR return
 * 1 and both set the TTL — harmless — but a crash between the two leaves a key
 * with no expiry, which never resets and locks the caller out permanently.
 */
const INCREMENT_SCRIPT = `
  local hits = redis.call('INCR', KEYS[1])
  if hits == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
  end
  return { hits, redis.call('PTTL', KEYS[1]) }
`;

/** Resolved once, on first use. `null` means "no Redis configured". */
let sharedClient;
let warnedNoRedis = false;

function getSharedClient(logger) {
  if (sharedClient !== undefined) return sharedClient;

  const url = process.env.REDIS_URL;
  if (!url) {
    sharedClient = null;
    if (!warnedNoRedis) {
      warnedNoRedis = true;
      logger?.warn(
        'REDIS_URL is not set — rate limit counters live in this process\'s heap. ' +
          'Every additional instance multiplies each limit by one. Fine for a single-process ' +
          'dev run; not fine anywhere the services are scaled out.'
      );
    }
    return sharedClient;
  }

  try {
    // Required lazily so a deployment without Redis never loads the driver.
    const Redis = require('ioredis');
    sharedClient = new Redis(url, {
      keyPrefix: `${process.env.REDIS_PREFIX || 'ibitplay'}:rl:`,
      maxRetriesPerRequest: 1,
      /**
       * TRUE, and the distinction is not academic.
       *
       * `false` rejects any command issued before the socket finishes
       * connecting — "Stream isn't writeable" — which is every request in the
       * first few hundred milliseconds after boot. Those all fell through to
       * the local fallback, so the counters silently stayed per-process and
       * the whole change was a no-op that looked like it worked. `cache.js`
       * carries the same warning; this is what it is warning about.
       *
       * Bounding a real OUTAGE is `commandTimeout`'s job, and it is the right
       * tool — it caps how long a command waits regardless of the reason.
       */
      enableOfflineQueue: true,
      commandTimeout: 1_000,
      connectTimeout: 3_000,
    });
    sharedClient.on('error', (error) => {
      logger?.debug({ err: error.message }, 'Rate-limit Redis error — falling back to local counters');
    });

    /**
     * The connection must not, by itself, keep the process alive.
     *
     * ioredis reconnects forever by design, and a socket with a pending
     * reconnect timer is a live handle. An HTTP server holds the loop open
     * anyway, so this changes nothing for a running service — but without it
     * anything SHORT-LIVED that touches a limiter never exits: a CLI, a
     * migration runner, or a test file, which is exactly how this was found.
     *
     * `unref` is re-applied on every reconnect because ioredis builds a new
     * socket each time and the flag does not survive.
     */
    const unref = () => sharedClient?.stream?.unref?.();
    unref();
    sharedClient.on('connect', unref);
    sharedClient.on('reconnecting', unref);
  } catch (error) {
    logger?.warn({ err: error.message }, 'Could not open Redis for rate limiting — using local counters');
    sharedClient = null;
  }

  return sharedClient;
}

/**
 * Replace the shared client.
 *
 * `null` means "no Redis, use local counters"; `undefined` means "resolve it
 * again on next use". Tests use this; nothing else should.
 */
function configureRateLimitStore(client) {
  sharedClient = client === undefined ? undefined : client;
}

/**
 * Close the shared connection.
 *
 * Registered as a shutdown hook by `startServer`, so a deploy does not leave a
 * socket reconnecting into a torn-down service. Safe to call when no client
 * was ever opened.
 */
async function closeRateLimitStore() {
  const client = sharedClient;
  sharedClient = undefined;
  if (!client?.quit) return;

  try {
    await client.quit();
  } catch {
    // Already gone, or mid-reconnect with nothing to say goodbye to.
    client.disconnect?.();
  }
}

/**
 * An `express-rate-limit` v7 store backed by the shared Redis connection,
 * degrading to a local Map when Redis is absent or unreachable.
 */
class SharedStore {
  constructor({ name, logger }) {
    this.name = name;
    this.logger = logger;
    /** The fallback. Also the whole store when no Redis is configured. */
    this.local = new Map();
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  #localIncrement(key) {
    const now = Date.now();
    const entry = this.local.get(key);

    if (!entry || entry.resetTime <= now) {
      const fresh = { totalHits: 1, resetTime: now + this.windowMs };
      this.local.set(key, fresh);

      // Unbounded growth is the failure mode of a Map keyed on client identity.
      // Sweeping on write costs nothing amortised and needs no timer to unref.
      if (this.local.size > 10_000) {
        for (const [k, v] of this.local) if (v.resetTime <= now) this.local.delete(k);
      }
      return { totalHits: 1, resetTime: new Date(fresh.resetTime) };
    }

    entry.totalHits += 1;
    return { totalHits: entry.totalHits, resetTime: new Date(entry.resetTime) };
  }

  async increment(key) {
    const client = getSharedClient(this.logger);
    if (!client) return this.#localIncrement(key);

    try {
      const [hits, ttlMs] = await client.eval(INCREMENT_SCRIPT, 1, key, this.windowMs);
      return {
        totalHits: Number(hits),
        resetTime: new Date(Date.now() + (Number(ttlMs) > 0 ? Number(ttlMs) : this.windowMs)),
      };
    } catch (error) {
      this.logger?.debug(
        { err: error.message, bucket: this.name },
        'Rate-limit store unreachable — counting locally for this request'
      );
      return this.#localIncrement(key);
    }
  }

  async decrement(key) {
    const client = getSharedClient(this.logger);
    if (client) {
      await client.decr(key).catch(() => {});
      return;
    }
    const entry = this.local.get(key);
    if (entry && entry.totalHits > 0) entry.totalHits -= 1;
  }

  async resetKey(key) {
    const client = getSharedClient(this.logger);
    if (client) await client.del(key).catch(() => {});
    this.local.delete(key);
  }
}

function createRateLimiter({
  windowMs = 60_000,
  max = 300,
  name = 'global',
  keyBy = 'auto',
  skipSuccessfulRequests = false,
  message = 'Too many requests, please slow down',
  logger = null,
  // Set false (via RATE_LIMIT_ENABLED=false) for automated test runs, where
  // hundreds of logins come from one address and would trip every bucket.
  // Never disable it in an environment reachable from the internet.
  enabled = true,
} = {}) {
  if (!enabled) {
    const passthrough = (_req, _res, next) => next();
    passthrough.disabled = true;
    return passthrough;
  }

  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests,
    store: new SharedStore({ name, logger }),

    keyGenerator: (req) => {
      if (keyBy === 'ip') return `${name}:${req.ip}`;
      // Identify the caller as precisely as we can, so limits are fair.
      const identity = req.user?.id ? `u${req.user.id}` : req.staff?.id ? `s${req.staff.id}` : req.ip;
      return `${name}:${identity}`;
    },

    // Health checks must never be throttled or the orchestrator will kill a
    // healthy service during a traffic spike.
    skip: (req) => req.path === '/health' || req.path === '/health/live' || req.path === '/health/ready',

    handler: (req, res) => {
      const retryAfter = Math.ceil(windowMs / 1000);
      req.log?.warn({ bucket: name, ip: req.ip, userId: req.user?.id ?? null }, 'Rate limit exceeded');
      res.setHeader('Retry-After', retryAfter);
      return fail(res, 429, 'TOO_MANY_REQUESTS', message, { retryAfter, bucket: name });
    },
  });
}

module.exports = { createRateLimiter, configureRateLimitStore, closeRateLimitStore, SharedStore };
