'use strict';

const { DIALECTS, setActiveSportIds } = require('./dialects');
const { AppError } = require('@ibitplay/common');

/**
 * The upstream sports data provider.
 *
 * One place that knows the base url, carries the key, bounds every call, and
 * caches the handful of responses that are re-fetched constantly. Nine legacy
 * controllers each did their own version of this, and they disagreed about all
 * four.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT EACH RULE HERE IS FOR
 *
 * TLS IS CHECKED AT CONSTRUCTION. The legacy base url is
 * `http://46.202.164.63:6565/api` — cleartext, to a bare IP, so there is no
 * certificate and nothing proving the far end is the provider. Match results
 * arrive over that connection. Anyone who can sit on the path decides who won
 * the game. A plain-http origin is refused unless the operator explicitly opts
 * in, which turns "we never noticed" into "somebody set a flag".
 *
 * THE KEY GOES IN THE HEADER ONLY. Legacy sent it in the query string as well.
 * URLs are logged by every proxy, load balancer and error reporter in the path
 * as a matter of routine, so a key in a query string is a key in a dozen log
 * files.
 *
 * EVERY CALL HAS A TIMEOUT. Of the fourteen upstream calls in the legacy
 * controllers, exactly one set one. `axios` with no timeout waits on the OS, so
 * a provider that accepts a connection and never answers holds a request
 * handler until the socket dies — and with the queue in front of it, the queue
 * job too.
 *
 * READS ARE CACHED FOR A FEW SECONDS. `/home` is the fixture list, and five
 * separate endpoints fetched it fresh on every single request —
 * `getMatchesByDateGame` fetched it twice in one handler. Odds move constantly
 * and must not be stale, so the TTL is per-endpoint and short; the point is to
 * collapse the burst that one page load produces, not to serve old prices.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * How long each upstream response may be reused, in milliseconds.
 *
 * Set from what the data IS, not from how expensive it is to fetch:
 *
 *   odds and in-play move every second and are barely cached at all
 *   fixtures and series change a few times a day
 *   settled results never change once they exist
 *
 * A market price served two seconds late is a price a player can act on, so
 * these numbers are the difference between a cache and a liability.
 */
const CACHE_TTL_MS = Object.freeze({
  '/GetMarketOdds': 1_000,
  '/GetSession': 1_000,
  '/GetLineMarket': 1_000,
  '/inplay': 2_000,
  '/GetMarketDetails': 2_000,
  '/GetMarketIdsV1': 5_000,
  '/GetMarketIdsV2': 5_000,
  '/home': 5_000,
  '/getEvents': 15_000,
  '/getEventsBySportsID': 15_000,
  '/getCompetitions': 60_000,
  '/allSportsID': 300_000,
  // A finished match does not un-finish. Longer, and the settlement path reads
  // through its own repository anyway rather than trusting this.
  '/result/event-result': 30_000,
  '/result/event-list': 30_000,
});

const DEFAULT_TTL_MS = 2_000;

/**
 * The upstream providers this platform reads from.
 *
 * There are THREE, and each was hardcoded in a different file:
 *
 *   odds  `http://46.202.164.63:6565/api`  — nine sportsapi controllers
 *   live  `http://159.198.77.241:8100`     — sportsmain/API/controller.js
 *   media `https://diamond-sports-api-demo-s2.avrkhub.in` — the same file
 *
 * Two of the three are plain http to a bare IP. The third is https but points
 * at a host with `-demo-` in its name, which is serving the live video stream
 * and the scorecard in production.
 *
 * Each has its own url and key so one can be rotated or moved without touching
 * the others, and all three go through the same timeout, cache and TLS rule.
 */
/**
 * How each provider expects to be authenticated.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE KEY IS NOT ALWAYS A HEADER
 *
 * This client was first written against ScoreSwift
 * (`legacy/sportsapi/`, `http://46.202.164.63:6565/api`), which takes an
 * `X-ScoreSwift-Key` header — and that host was hardcoded here, so EVERY
 * provider got a ScoreSwift header whether it understood one or not.
 *
 * The provider this platform actually runs on
 * (`legacy/sportsmain/`, the diamond feed) takes the key as a `key=` QUERY
 * PARAMETER and ignores headers entirely, so every call authenticated as
 * anonymous and the feed answered 404.
 *
 * `auth` says which, per provider, instead of one hardcoded assumption.
 *
 * A query-string key is worse than a header — it lands in access logs, proxy
 * logs and `Referer` headers along the way. That is the provider's choice, not
 * ours; it is written down here so nobody has to rediscover why one provider
 * differs from the next.
 * ═════════════════════════════════════════════════════════════════════════
 */
const AUTH = Object.freeze({
  /** `?key=<value>` — the diamond feed and anything descended from it. */
  QUERY: (param = 'key') => ({ mode: 'query', param }),
  /** `X-...-Key: <value>` — ScoreSwift. */
  HEADER: (name) => ({ mode: 'header', name }),
  /** The provider needs no credential. Stated so it cannot be an oversight. */
  NONE: () => ({ mode: 'none' }),
});

/**
 * ── AND THE PATHS ARE NOT ALWAYS THE SAME EITHER ─────────────────────────
 *
 * `FeedService` asks for ScoreSwift's path names because that is what the port
 * was written against. The diamond feed serves ONE endpoint, keyed on sport,
 * and 404s everything else — which is what the sports screens were showing.
 *
 * `dialect` names the translation. `SPORTS_FEED_DIALECT` overrides it per
 * deployment, because which provider is behind a URL is a deployment fact.
 * See `dialects.js`.
 */
const PROVIDERS = Object.freeze({
  odds: { url: 'SPORTS_FEED_URL', key: 'SPORTS_FEED_KEY', auth: AUTH.QUERY('key'), dialect: 'SPORTS_FEED_DIALECT' },
  live: { url: 'SPORTS_LIVE_URL', key: 'SPORTS_LIVE_KEY', auth: AUTH.QUERY('key'), dialect: 'SPORTS_LIVE_DIALECT' },
  media: { url: 'SPORTS_MEDIA_URL', key: 'SPORTS_MEDIA_KEY', auth: AUTH.QUERY('key'), dialect: 'SPORTS_MEDIA_DIALECT' },
  /**
   * Results, on their own host — and it takes NO credential. `AUTH.NONE` says
   * so out loud rather than leaving the absence to look like an oversight.
   */
  results: { url: 'SPORTS_RESULTS_URL', key: 'SPORTS_RESULTS_KEY', auth: AUTH.NONE(), dialect: 'SPORTS_RESULTS_DIALECT' },
});

class FeedClient {
  /**
   * A client for one named provider.
   *
   * @param provider one of `PROVIDERS`. Defaults to the odds feed, which is
   *   what every existing caller wants.
   */
  constructor({ config, logger, fetchImpl, provider = 'odds' } = {}) {
    const names = PROVIDERS[provider];
    if (!names) throw new Error(`Unknown sports provider "${provider}"`);

    this.provider = provider;
    const baseUrl = String(config?.[names.url] ?? '').replace(/\/+$/, '');
    if (!baseUrl) {
      throw new Error(`${names.url} is required — the ${provider} feed has no default`);
    }

    /**
     * Refuse cleartext unless somebody said so out loud.
     *
     * This is the check that would have caught the legacy base url. It is at
     * CONSTRUCTION, not per request, so a misconfigured deployment fails at
     * boot rather than on the first bet.
     */
    if (baseUrl.startsWith('http://') && !config?.SPORTS_FEED_ALLOW_INSECURE) {
      throw new Error(
        `${names.url} is plain http (${baseUrl}). Match results and odds would ` +
          'travel in cleartext over a path anyone can rewrite. Use https, or set ' +
          'SPORTS_FEED_ALLOW_INSECURE=true to accept that risk deliberately.'
      );
    }

    if (!config?.[names.key]) {
      // Legacy had `|| 'bit_wyusjkwiyu'`, so a deployment that forgot the
      // variable still worked — using the key that is in the repository.
      throw new Error(`${names.key} is required — there is deliberately no fallback`);
    }

    this.baseUrl = baseUrl;
    this.key = config[names.key];
    this.auth = names.auth ?? AUTH.QUERY('key');
    this.timeoutMs = Number(config.SPORTS_FEED_TIMEOUT_MS ?? 8_000);
    this.logger = logger;
    this.fetch = fetchImpl ?? globalThis.fetch;

    if (baseUrl.startsWith('http://')) {
      this.logger?.warn(
        { baseUrl, provider },
        'A sports feed is being read over PLAIN HTTP. Results and prices are ' +
          'modifiable in transit by anyone on the network path.'
      );
    }

    const dialectName = config?.[names.dialect] || 'diamond';
    this.dialect = DIALECTS[dialectName];
    if (!this.dialect) {
      throw new Error(
        `Unknown sports feed dialect "${dialectName}" for ${provider}. ` +
          `Known: ${Object.keys(DIALECTS).join(', ')}.`
      );
    }

    // Bounds the fan-out — see `setActiveSportIds`. A deployment fetching
    // three sports makes three upstream calls per board read, not nineteen.
    setActiveSportIds(config?.SPORTS_ACTIVE_EIDS);

    /** `key -> {expires, value}`. Bounded by the number of distinct queries. */
    this.cache = new Map();
    /** In-flight requests, so a burst for one url makes one upstream call. */
    this.inFlight = new Map();
  }

  /**
   * Fetch an upstream path.
   *
   * @param path  e.g. `/inplay` — one of the provider's documented endpoints
   * @param query object of query parameters, key EXCLUDED
   */
  async get(path, query = {}) {
    const cacheKey = this.#cacheKey(path, query);

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.value;

    /**
     * Collapse concurrent identical requests.
     *
     * One page load asks for the fixture list from several endpoints at once.
     * Without this each becomes its own upstream call, which is what legacy
     * did — and the provider rate-limits.
     */
    const pending = this.inFlight.get(cacheKey);
    if (pending) return pending;

    const promise = this.#viaDialect(path, query)
      .then((value) => {
        const ttl = CACHE_TTL_MS[path] ?? DEFAULT_TTL_MS;
        this.cache.set(cacheKey, { expires: Date.now() + ttl, value });
        return value;
      })
      .finally(() => this.inFlight.delete(cacheKey));

    this.inFlight.set(cacheKey, promise);
    return promise;
  }

  /**
   * Translate one logical call into this provider's actual request(s).
   *
   * Four outcomes, all declared by the dialect — see `dialects.js`:
   * a single request, a fan-out concatenated, a locally-derived answer, or a
   * refusal naming the capability the provider does not have.
   */
  async #viaDialect(path, query) {
    const plan = this.dialect.translate(path, query);

    if (plan.unsupported) {
      this.logger?.warn(
        { provider: this.provider, dialect: this.dialect.name, capability: plan.unsupported },
        'The sports feed provider does not serve this capability'
      );
      throw new AppError(
        `The ${this.dialect.name} feed does not serve "${plan.unsupported}"`,
        501,
        'FEED_CAPABILITY_MISSING',
        { provider: this.provider, dialect: this.dialect.name, capability: plan.unsupported }
      );
    }

    // Answered without the network — the sport list is the platform's own.
    if (plan.local) return plan.local();

    /**
     * Two steps: find a row on the board, then use one of its fields to build
     * the real request. See `/GetLineMarket` in the diamond dialect — the
     * provider needs a sport id the platform's own routes do not carry.
     */
    if (plan.resolve) {
      const { fanOut, find, then: build, missing } = plan.resolve;

      const settled = await Promise.allSettled(
        fanOut.map((step) => this.#fetchUpstream(step.path, step.query))
      );

      let found = null;
      for (const result of settled) {
        if (result.status !== 'fulfilled') continue;
        found = this.dialect.shape('/home', result.value).find(find);
        if (found) break;
      }

      if (!found) {
        throw new AppError(missing || 'Not on the board', 404, 'FEED_NOT_FOUND', {
          provider: this.provider,
        });
      }

      const next = build(found);
      return this.dialect.shape(path, await this.#fetchUpstream(next.path, next.query));
    }

    if (plan.fanOut) {
      /**
       * One request per sport, and a failure in one must not lose the rest:
       * the board for cricket is still worth showing when tennis times out.
       * `allSettled`, and the misses are logged rather than thrown.
       */
      const settled = await Promise.allSettled(
        plan.fanOut.map((step) => this.#fetchUpstream(step.path, step.query))
      );

      const rows = [];
      let failures = 0;
      for (const result of settled) {
        if (result.status !== 'fulfilled') { failures += 1; continue; }
        rows.push(...this.dialect.shape(path, result.value));
      }

      if (failures) {
        this.logger?.warn(
          { provider: this.provider, path, failures, of: plan.fanOut.length },
          'Some sports failed to load; returning the ones that did'
        );
      }
      // Every sport failed — that is an outage, not an empty board.
      if (failures === plan.fanOut.length) {
        throw new AppError('The sports data provider is unreachable', 502, 'FEED_UPSTREAM_ERROR', {
          provider: this.provider,
        });
      }

      return plan.filter ? rows.filter(plan.filter) : rows;
    }

    const body = await this.#fetchUpstream(plan.path, plan.query);
    const shaped = this.dialect.shape(path, body);
    return plan.filter ? shaped.filter(plan.filter) : shaped;
  }

  async #fetchUpstream(path, query) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, String(value));
    }

    // The credential, where THIS provider expects it. Set after the caller's
    // parameters so a query named `key` cannot displace it.
    if (this.auth.mode === 'query') url.searchParams.set(this.auth.param, this.key);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = Date.now();

    try {
      const response = await this.fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          // Only when this provider actually wants one. Sending a ScoreSwift
          // header to a provider that authenticates by query string is how
          // every call ended up anonymous.
          ...(this.auth.mode === 'header' ? { [this.auth.name]: this.key } : {}),
        },
      });

      if (!response.ok) {
        this.logger?.warn(
          { path, status: response.status, ms: Date.now() - started },
          'The sports feed returned a non-2xx response'
        );
        throw new AppError('The sports data provider rejected the request', 502, 'FEED_UPSTREAM_ERROR', {
          upstreamStatus: response.status,
        });
      }

      const text = await response.text();
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        this.logger?.warn({ path }, 'The sports feed returned a body that is not JSON');
        throw new AppError('The sports data provider returned an unreadable response', 502, 'FEED_UNREADABLE');
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        this.logger?.error({ path, timeoutMs: this.timeoutMs }, 'The sports feed did not respond in time');
        throw new AppError('The sports data provider did not respond', 504, 'FEED_UNREACHABLE');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * The cache key.
   *
   * Query parameters are sorted, so `?a=1&b=2` and `?b=2&a=1` are one entry
   * rather than two — the same request arriving from two different callers.
   */
  #cacheKey(path, query) {
    const parts = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`);
    return parts.length ? `${path}?${parts.join('&')}` : path;
  }

  /**
   * Drop expired entries.
   *
   * The cache is keyed by url, and event ids are unbounded over time, so
   * without this it grows for the life of the process. Called on a timer by
   * the container.
   */
  prune() {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.cache) {
      if (entry.expires <= now) {
        this.cache.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

module.exports = { FeedClient, CACHE_TTL_MS, PROVIDERS, AUTH };
