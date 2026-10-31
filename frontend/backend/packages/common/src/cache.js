'use strict';

/**
 * The shared cache.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY A SHARED ONE, AND NOT THE PER-CLIENT MAP THAT WAS ALREADY THERE
 *
 * `FeedClient` caches in its own heap, which is right for collapsing a burst of
 * identical requests inside one process. It cannot do the job the sports crons
 * do, because that job spans processes:
 *
 *   cron/odds.js polls every 2 SECONDS and writes `oddsData:<gmid>`.
 *   API/service.js READS that key and never calls the provider at all.
 *
 * A writer in the worker process and a reader in the HTTP process only meet in
 * a store outside both. With a heap cache the worker warms its own copy and the
 * HTTP service reads its own empty one — which looks like it works, because
 * every read falls through to a live fetch, and only shows up as load on the
 * provider and latency on the board.
 *
 * ── THE MEMORY FALLBACK IS DELIBERATE, AND IT WARNS ──────────────────────
 *
 * Without `REDIS_URL` this degrades to an in-process Map rather than refusing
 * to start, so a laptop with no Redis can still run `npm run dev`. That is only
 * honest if it is loud: a deployment that silently ran this way would have the
 * worker polling every two seconds into a heap nothing else can read, and the
 * only symptom would be the provider bill.
 *
 * `dev:mono` runs everything in one process, where the fallback is genuinely
 * equivalent. Anywhere else it is a degradation, and it says so on boot.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * An in-process store with the same surface as the Redis one.
 *
 * Expiry is checked on read rather than swept on a timer: a key nobody reads
 * again costs one Map entry until the next `prune`, and a timer per key would
 * cost far more for a cache holding thousands of odds entries.
 */
class MemoryCache {
  constructor() {
    this.store = new Map();
  }

  async get(key) {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expires <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key, value, ttlSeconds) {
    this.store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    return true;
  }

  async del(key) {
    return this.store.delete(key);
  }

  /** Every live key matching a `prefix*` glob. */
  async keys(prefix) {
    const now = Date.now();
    const found = [];
    for (const [key, hit] of this.store) {
      if (hit.expires <= now) {
        this.store.delete(key);
        continue;
      }
      if (key.startsWith(prefix)) found.push(key);
    }
    return found;
  }

  async ping() {
    return 'PONG';
  }

  async close() {
    this.store.clear();
  }

  get kind() {
    return 'memory';
  }
}

/** Redis, through ioredis. */
class RedisCache {
  constructor({ url, prefix, logger }) {
    // Required lazily so a deployment without Redis never loads the driver.
    const Redis = require('ioredis');

    this.prefix = prefix ? `${prefix}:` : '';
    this.logger = logger;

    this.client = new Redis(url, {
      /**
       * A cache must never be the reason a request hangs — but it must also not
       * fail every command issued in the second before the socket is ready.
       *
       * `enableOfflineQueue: false` does the second thing: commands sent during
       * connection setup are rejected outright with "Stream isn't writeable",
       * so the first read after boot is always a miss and the first write is
       * always lost. The offline queue holds them for the handful of
       * milliseconds it takes to connect.
       *
       * Failing fast during a real OUTAGE is `commandTimeout`'s job, and it is
       * the right tool: it bounds how long a command waits regardless of why.
       */
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
      commandTimeout: 2_000,
      connectTimeout: 3_000,
      lazyConnect: false,
    });

    this.client.on('error', (error) => {
      // Rate-limited by ioredis' own reconnect backoff; logging every attempt
      // would drown the log during an outage.
      this.logger?.warn({ err: error.message }, 'Redis connection error');
    });
    this.client.on('connect', () => this.logger?.info({ url: redact(url) }, 'Redis connected'));
  }

  #key(key) {
    return `${this.prefix}${key}`;
  }

  async get(key) {
    try {
      return await this.client.get(this.#key(key));
    } catch (error) {
      // A cache miss and a cache outage are the same thing to a caller: go and
      // fetch it. Throwing here would turn a Redis blip into a 500.
      this.logger?.debug({ err: error.message, key }, 'Cache read failed — treating as a miss');
      return null;
    }
  }

  async set(key, value, ttlSeconds) {
    try {
      await this.client.set(this.#key(key), value, 'EX', Math.max(1, Math.floor(ttlSeconds)));
      return true;
    } catch (error) {
      this.logger?.debug({ err: error.message, key }, 'Cache write failed');
      return false;
    }
  }

  async del(key) {
    try {
      return await this.client.del(this.#key(key));
    } catch {
      return 0;
    }
  }

  /**
   * Keys matching `prefix*`.
   *
   * `SCAN`, never `KEYS` — `KEYS` blocks the whole server for the length of the
   * scan, and this runs against a keyspace holding one entry per live match.
   */
  async keys(prefix) {
    const match = `${this.#key(prefix)}*`;
    const found = [];
    let cursor = '0';

    try {
      do {
        const [next, batch] = await this.client.scan(cursor, 'MATCH', match, 'COUNT', 200);
        cursor = next;
        found.push(...batch.map((k) => k.slice(this.prefix.length)));
      } while (cursor !== '0');
    } catch (error) {
      this.logger?.debug({ err: error.message }, 'Cache scan failed');
    }

    return found;
  }

  async ping() {
    return this.client.ping();
  }

  async close() {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  get kind() {
    return 'redis';
  }
}

/** Never log a url that may carry a password. */
function redact(url) {
  return String(url).replace(/\/\/[^@]*@/, '//***@');
}

/**
 * Build the cache for a service.
 *
 * @param {object}  options
 * @param {object}  options.config  needs `REDIS_URL` and optionally `REDIS_PREFIX`
 * @param {object}  options.logger
 * @param {string}  [options.role]  what this process is, for the warning below
 */
function createCache({ config, logger, role = 'service' } = {}) {
  const url = config?.REDIS_URL;

  if (url) return new RedisCache({ url, prefix: config.REDIS_PREFIX, logger });

  /**
   * Loud, and specific about the consequence.
   *
   * A worker caching into its own heap is not a slower version of the right
   * thing — it is a process doing work nobody can see the result of.
   */
  logger?.warn(
    { role },
    'REDIS_URL is not set — caching into this process\'s own heap. ' +
      'Anything written here is invisible to the other services, so a background ' +
      'job warming this cache warms nothing they can read. Fine for dev:mono; ' +
      'not fine anywhere the services run as separate processes.'
  );

  return new MemoryCache();
}

module.exports = { createCache, MemoryCache, RedisCache };
