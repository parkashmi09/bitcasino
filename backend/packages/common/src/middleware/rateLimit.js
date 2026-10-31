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

/**
 * Give back one hit — only if the counter still exists and is positive.
 *
 * `express-rate-limit` calls `decrement` AFTER the response (that is how
 * `skipSuccessfulRequests` works). A bare DECR on a key that expired, or that
 * an operator deleted to clear a lockout, in the meantime CREATES the key at
 * -1 with no TTL: a permanent extra allowance that never resets.
 */
const DECREMENT_SCRIPT = `
  local hits = tonumber(redis.call('GET', KEYS[1]) or '0')
  if hits > 0 then
    return redis.call('DECR', KEYS[1])
  end
  return 0
`;

/**
 * The owner's `rate_limit` policy (featureCatalogue.js), read like the gateway's API encryption:
 * admin-service's public features list every 15 s. `off` stops every bucket counting except
 * ALWAYS_ON — the password and code guards, which stop account takeover and never switch off.
 * Starts on, and an answer that cannot be read keeps the last state.
 */
const ALWAYS_ON = new Set(['auth:login', 'auth:reset', 'otp-issue', 'otp-verify', 'twofa:code', 'staff-auth:signin', 'staff-2fa:code', 'exchange-lookup:txn-verify']);
const OWNER_POLL_MS = 15_000;
let ownerOff = false;
let watching = false;

/** Start following the owner's switch (once per process, from createApp). Returns the poll, for tests. */
function watchOwnerRateLimit({ config, logger } = {}) {
  if (watching || !config?.ADMIN_SERVICE_URL) return null;
  watching = true;
  const poll = async () => {
    try {
      const res = await fetch(`${config.ADMIN_SERVICE_URL}/api/v1/admin/features/public`);
      if (!res.ok) return;
      const list = (await res.json())?.data ?? [];
      const off = list.some((f) => f.feature === 'rate_limit' && f.variant === 'off');
      if (off !== ownerOff) loggerFor(logger).info({ on: !off }, 'Rate limit switched by the owner');
      ownerOff = off;
    } catch (error) {
      loggerFor(logger).warn({ err: error?.message }, 'Rate limit: could not read the owner policy');
    }
  };
  void poll();
  setInterval(poll, OWNER_POLL_MS).unref();
  return poll;
}

/** Resolved once, on first use. `null` means "no Redis configured". */
let sharedClient;
let warnedNoRedis = false;
/** Set while counting in memory because Redis failed; cleared on recovery. */
let fallingBack = false;

/**
 * Most limiters are built without a logger (`createRateLimiter({ name, max })`).
 * The "your limits are per-process" warning must not depend on WHICH limiter
 * happens to be used first — so a missing logger falls back to a real one
 * instead of `logger?.warn` silently swallowing the only warning there is.
 */
let defaultLogger;
function loggerFor(logger) {
  if (logger) return logger;
  if (!defaultLogger) {
    try {
      defaultLogger = require('../logger').createLogger({ service: 'rate-limit' });
    } catch {
      defaultLogger = { warn: console.warn, info: console.info, debug() {} };
    }
  }
  return defaultLogger;
}

/**
 * Where the counters live.
 *
 * `RATE_LIMIT_REDIS_URL` wins so the limiter can be pointed at Redis without
 * also moving the cache, the socket adapter and presence (which all read
 * `REDIS_URL`) — the root `.env` ships `REDIS_URL` blank, which is exactly how
 * the staff sign-in bucket ended up counting in the admin process's heap.
 */
function resolveRedisUrl() {
  /**
   * Not under `node --test`. `npm test` loads the root `.env`, and a suite
   * that mounts real routers would otherwise count into the developer's live
   * Redis — buckets that outlive the run by 15 minutes and fail the next one.
   * A test that wants Redis sets `REDIS_URL` or calls `configureRateLimitStore`.
   */
  const dedicated = process.env.NODE_TEST_CONTEXT ? '' : process.env.RATE_LIMIT_REDIS_URL;
  return dedicated || process.env.REDIS_URL || '';
}

function getSharedClient(logger) {
  if (sharedClient !== undefined) return sharedClient;

  const url = resolveRedisUrl();
  if (!url) {
    sharedClient = null;
    if (!warnedNoRedis) {
      warnedNoRedis = true;
      loggerFor(logger).warn(
        'Neither RATE_LIMIT_REDIS_URL nor REDIS_URL is set — rate limit counters live in this process\'s heap. ' +
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
    loggerFor(logger).warn({ err: error.message }, 'Could not open Redis for rate limiting — using local counters');
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
  fallingBack = false;
}

/**
 * Redis was configured but a command failed, so this request is counted in
 * memory. Warn ONCE per outage (not per request, which would flood the log
 * during exactly the incident someone is reading it for) and say so again on
 * recovery, so the log shows the window in which limits were per-process.
 */
function noteFallback(logger, bucket, error) {
  if (fallingBack) return;
  fallingBack = true;
  loggerFor(logger).warn(
    { err: error?.message, bucket },
    'Rate-limit Redis store unreachable — counting in this process\'s memory until it recovers. ' +
      'Limits are per-instance and cannot be cleared via Redis meanwhile.'
  );
}

function noteRecovered(logger) {
  if (!fallingBack) return;
  fallingBack = false;
  loggerFor(logger).info('Rate-limit Redis store reachable again — counters are shared');
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
      const result = {
        totalHits: Number(hits),
        resetTime: new Date(Date.now() + (Number(ttlMs) > 0 ? Number(ttlMs) : this.windowMs)),
      };
      // Redis holds this key's count now; a stale outage-era local entry
      // must not capture the matching `decrement`.
      this.local.delete(key);
      noteRecovered(this.logger);
      return result;
    } catch (error) {
      noteFallback(this.logger, this.name, error);
      return this.#localIncrement(key);
    }
  }

  #localDecrement(key) {
    const entry = this.local.get(key);
    if (entry && entry.totalHits > 0) entry.totalHits -= 1;
  }

  async decrement(key) {
    // A hit counted locally during an outage is given back locally too —
    // otherwise `skipSuccessfulRequests` stops working while Redis is down.
    if (this.local.has(key)) {
      this.#localDecrement(key);
      return;
    }
    const client = getSharedClient(this.logger);
    if (!client) return;
    try {
      await client.eval(DECREMENT_SCRIPT, 1, key);
    } catch (error) {
      noteFallback(this.logger, this.name, error);
    }
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
  // Extra requests this bucket never counts (createApp: authenticated service-to-service calls).
  skipIf = null,
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
    // socket.io's long-polling is not counted either: one open socket is a
    // request every few seconds, which would spend a player's whole HTTP budget
    // on its own. Every socket EVENT has its own limit (`limit` on each
    // handler in @ibitplay/socket), which is where that traffic is metered.
    skip: (req) =>
      req.path === '/health' || req.path === '/health/live' || req.path === '/health/ready' || req.path.startsWith('/socket.io') ||
      (ownerOff && !ALWAYS_ON.has(name)) ||
      Boolean(skipIf?.(req)),

    handler: (req, res) => {
      const retryAfter = Math.ceil(windowMs / 1000);
      req.log?.warn({ bucket: name, ip: req.ip, userId: req.user?.id ?? null }, 'Rate limit exceeded');
      res.setHeader('Retry-After', retryAfter);
      return fail(res, 429, 'TOO_MANY_REQUESTS', message, { retryAfter, bucket: name });
    },
  });
}

module.exports = { createRateLimiter, watchOwnerRateLimit, configureRateLimitStore, closeRateLimitStore, SharedStore, resolveRedisUrl };
