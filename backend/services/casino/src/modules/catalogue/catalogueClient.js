'use strict';

const errors = require('./catalogue.errors');
const { UPSTREAM_CACHE_MS } = require('./catalogue.constants');

/**
 * Talking to the two catalogue aggregators.
 *
 * Modelled on `services/sports/src/modules/feed/feedClient.js`, for the same
 * reasons and against the same legacy pattern: credentials in the source, no
 * cache, no timeout, and the upstream's errors forwarded to the caller.
 */

/**
 * The upstreams, and the settings that name their credentials.
 *
 * There is deliberately NO fallback value for any of them. Legacy hardcoded
 * `agent_code: "Skyla_USD"` and `agent_token: "83eb5e…"` in three handlers; a
 * default here would mean a deployment that looks configured and is playing
 * through somebody else's aggregator account.
 */
const UPSTREAMS = Object.freeze({
  /** nexusggreu — game lists and launches. */
  nexus: { url: 'CASINO_NEXUS_URL', agent: 'CASINO_NEXUS_AGENT', token: 'CASINO_NEXUS_TOKEN' },
  /** gaminghub360 — the vendor catalogue and jackpots. */
  hub: { url: 'CASINO_HUB_URL', key: 'CASINO_HUB_KEY' },
});

class CatalogueClient {
  constructor({ config, logger, http }) {
    this.config = config;
    this.logger = logger;
    /** Injected so the module is testable without a network. */
    this.http = http ?? null;

    this.cache = new Map();
    /**
     * In-flight requests, keyed the same way as the cache.
     *
     * Without this, a cold cache plus fifty simultaneous lobby loads is fifty
     * identical upstream calls. Legacy had neither the cache nor this.
     */
    this.inflight = new Map();
  }

  /** Resolve an upstream's base URL, refusing cleartext. */
  #baseUrl(name) {
    const names = UPSTREAMS[name];
    if (!names) throw errors.UNKNOWN_UPSTREAM({ upstream: name });

    const url = this.config?.[names.url];
    if (!url) throw errors.NOT_CONFIGURED({ setting: names.url });

    if (url.startsWith('http://') && !this.config?.CASINO_ALLOW_INSECURE) {
      /**
       * These requests carry the agent token. Legacy's URLs were https, but
       * they were also literals — a configured one can be anything, and a
       * credential over cleartext to a bare IP is exactly what this port found
       * on the sports odds feed.
       */
      throw errors.NOT_CONFIGURED({ setting: names.url, reason: 'must be https' });
    }

    return url.replace(/\/$/, '');
  }

  #credentials(name) {
    const names = UPSTREAMS[name];
    const missing = ['agent', 'token', 'key']
      .filter((field) => names[field])
      .filter((field) => !this.config?.[names[field]]);

    if (missing.length) throw errors.NOT_CONFIGURED({ setting: names[missing[0]] });

    return {
      agent: names.agent ? this.config[names.agent] : undefined,
      token: names.token ? this.config[names.token] : undefined,
      key: names.key ? this.config[names.key] : undefined,
    };
  }

  /**
   * A cached upstream read.
   *
   * @param {string} key      Cache key.
   * @param {() => Promise<any>} load
   * @param {number} ttlMs
   */
  async #cached(key, load, ttlMs) {
    const hit = this.cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const value = await load();
        this.cache.set(key, { value, expires: Date.now() + ttlMs });
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }

  /**
   * The nexus game list for one provider.
   *
   * @legacy GET /game-list
   * @legacy GET /game-list-new
   */
  async nexusGameList(providerCode) {
    const key = `nexus:games:${providerCode}`;

    return this.#cached(
      key,
      async () => {
        const { agent, token } = this.#credentials('nexus');

        const body = await this.#post(this.#baseUrl('nexus'), {
          method: 'game_list',
          agent_code: agent,
          agent_token: token,
          provider_code: providerCode,
        });

        if (body?.status !== 1) {
          /**
           * The upstream's message goes to the LOG, not to the caller.
           *
           * Legacy did `res.status(error.response.status).json({ error:
           * error.response.data })` — forwarding the aggregator's own error
           * text, which quotes the request back, and the request contains the
           * agent token.
           */
          this.logger?.error({ providerCode, upstreamMessage: body?.msg }, 'Nexus rejected the game list request');
          throw errors.UPSTREAM_REFUSED({ provider: providerCode });
        }

        return body.games ?? [];
      },
      UPSTREAM_CACHE_MS.gameList
    );
  }

  /**
   * Open a game session with nexus.
   *
   * @legacy POST /game_launch
   * @legacy POST /game_launch_new
   *
   * Never cached — a launch mints a session.
   */
  async nexusLaunch({ userCode, providerCode, gameCode, language }) {
    const { agent, token } = this.#credentials('nexus');

    const body = await this.#post(this.#baseUrl('nexus'), {
      method: 'game_launch',
      agent_code: agent,
      agent_token: token,
      user_code: userCode,
      provider_code: providerCode,
      game_code: gameCode,
      ...(language ? { lang: language } : {}),
    });

    if (body?.status !== 1 || !body?.launch_url) {
      this.logger?.error({ providerCode, gameCode, upstreamMessage: body?.msg }, 'Nexus refused the launch');
      throw errors.UPSTREAM_REFUSED({ provider: providerCode });
    }

    return { launchUrl: body.launch_url };
  }

  /**
   * The gaminghub360 catalogue.
   *
   * @legacy GET /api/casino/games/list
   * @legacy GET /api/casino/games/lists
   * @legacy GET /api/casino/vendors
   *
   * All three called `fetchGameList()`, which hit the provider every time. One
   * cached read behind all three here.
   */
  async hubGameList() {
    return this.#cached(
      'hub:games',
      async () => {
        const { key } = this.#credentials('hub');
        const body = await this.#get(`${this.#baseUrl('hub')}/api/casino/games/list`, { 'X-Auth': key });
        return Array.isArray(body) ? body : body?.games ?? [];
      },
      UPSTREAM_CACHE_MS.gameList
    );
  }

  /** @legacy GET /api/casino/jackpots */
  async hubJackpots(currency) {
    return this.#cached(
      `hub:jackpots:${currency ?? 'default'}`,
      async () => {
        const { key } = this.#credentials('hub');
        return this.#get(`${this.#baseUrl('hub')}/api/jackpots/egt-jackpot-info`, { 'X-Auth': key }, { currency });
      },
      // Jackpot figures move constantly and are shown as a ticker — a short
      // TTL, but not zero, or the lobby polls the provider once per visitor.
      UPSTREAM_CACHE_MS.jackpots
    );
  }

  // ══════════════════════════════════════════════════════════════════════

  async #post(url, payload) {
    if (!this.http) throw errors.NOT_CONFIGURED({ setting: 'http client' });
    return this.http.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
  }

  async #get(url, headers, query) {
    if (!this.http) throw errors.NOT_CONFIGURED({ setting: 'http client' });
    return this.http.get(url, { headers, query });
  }
}

module.exports = { CatalogueClient, UPSTREAMS };
