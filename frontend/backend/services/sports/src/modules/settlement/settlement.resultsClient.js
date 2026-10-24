'use strict';

/**
 * The result feed, as the settlement crons talked to it.
 *
 * @legacy sportsmain/cron/job.js      `fetchResultForEvent`
 * @legacy sportsmain/cron/settlement.js `fetchResultForEvent` / `fetchResultForEventFancy`
 *
 * Three matchers, not one. Both crons call `GET <base>/get_result?sid&gmid`
 * and then pick ONE market out of the response — but each picks it differently,
 * and which one runs decides whether a market settles at all:
 *
 *   scanner  (job.js)        TIED_MATCH → mname only
 *                            FAN on sid 1|2 → ename + mname
 *                            FAN otherwise  → marketName + mname
 *                            default        → ename + mname
 *   payout MO/BM             mname only
 *   payout FAN               TIED_MATCH → mname only
 *                            sid 1|2 → ename + mname
 *                            otherwise → marketName + mname
 *
 * They are kept as three separate methods rather than merged behind a flag,
 * because the differences are not obviously intentional and merging them would
 * silently change which markets the scanner considers declared.
 *
 * `declared` is `status === 'SETTLE'` in all three. A 404 means the result is
 * simply not published yet and is NOT retried — the job re-checks next tick.
 */

const {
  // The payout worker's pair.
  normalizeText,
  normalizeMarketType,
  // The scanner's pair — NOT the same functions. See settlement.http.js.
  scanNormalizeText,
  scanNormalizeMarketType,
  sleep,
  jitter,
  parseRetryAfter,
} = require('./settlement.http');

/**
 * @legacy settlement.js `AsyncQueue`
 *
 * Caps concurrent provider calls. The scanner had none (it is serial anyway);
 * the payout worker ran three at a time.
 */
class AsyncQueue {
  constructor(max) { this.max = max; this.running = 0; this.q = []; }
  push(task) { return new Promise((res, rej) => { this.q.push({ task, res, rej }); this._next(); }); }
  _next() {
    if (this.running >= this.max) return;
    const n = this.q.shift(); if (!n) return;
    this.running++;
    n.task().then(n.res, n.rej).finally(() => { this.running--; this._next(); });
  }
}

const NOT_DECLARED = () => ({ declared: false, items: [] });

class ResultsClient {
  constructor({ config, logger, fetchImpl } = {}) {
    this.logger = logger;
    this.fetch = fetchImpl ?? globalThis.fetch;

    // `RESULTS_API_BASE` — the results host, which is NOT the odds feed host.
    this.url = `${String(config.SPORTS_RESULTS_URL).replace(/\/+$/, '')}/get_result`;
    this.timeoutMs = config.SPORTS_RESULT_TIMEOUT_MS;
    this.maxAttempts = config.SPORTS_RESULT_MAX_RETRIES || 6;
    this.retryBaseMs = config.SPORTS_RESULT_RETRY_BASE_MS;
    this.rateLimitMs = config.SPORTS_RESULT_RATE_LIMIT_MS;

    this.queue = new AsyncQueue(config.SPORTS_RESULT_MAX_CONCURRENT);
    this.lastApiCallAt = 0;
  }

  /** @legacy settlement.js `globalRateLimit` — one shared gap across all callers. */
  async #rateLimit() {
    const gap = this.rateLimitMs > 0 ? this.rateLimitMs : 0;
    const wait = Math.max(0, this.lastApiCallAt + gap - Date.now());
    if (wait) await sleep(wait);
    this.lastApiCallAt = Date.now();
  }

  /**
   * One GET, bounded by a timeout.
   *
   * Legacy used `axios` with `validateStatus: () => true` so a non-2xx came
   * back as a value rather than a throw; `fetch` behaves that way already.
   * `buildPerAttemptConfig` (keep-alive off + force IPv4 from the 3rd attempt)
   * has no `fetch` equivalent and is dropped — it was a workaround for an agent
   * pooling bug, not part of the settlement contract.
   */
  async #get({ sid, gmid }) {
    const url = new URL(this.url);
    url.searchParams.set('sid', String(sid ?? ''));
    url.searchParams.set('gmid', String(gmid ?? ''));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }

      return { status: response.status, headers: response.headers, data: body };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Retry envelope shared by all three matchers.
   *
   * `match(markets, data)` returns the chosen market. 404 short-circuits to
   * "not declared"; 429 and 5xx back off (honouring `Retry-After`); anything
   * else gives up immediately, exactly as legacy did.
   */
  async #fetchAndMatch({ eventid, sport_id, match, allow404 = false }) {
    return this.queue.push(async () => {
      for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
        try {
          await this.#rateLimit();

          const res = await this.#get({ sid: sport_id, gmid: eventid });

          if (res.status === 200) {
            const data = typeof res?.data === 'string' ? JSON.parse(res.data) : res.data;
            const markets = Array.isArray(data?.markets) ? data.markets : [];

            const matchedMarket = match(markets, data);
            const declared = matchedMarket?.status === 'SETTLE';

            return {
              declared,
              items: matchedMarket ? [matchedMarket] : [],
              meta: {
                success: data?.success,
                total: data?.total,
                page: data?.page,
                limit: data?.limit,
                pages: data?.pages,
              },
            };
          }

          // 404 => result not published yet. Don't retry; treat as not declared
          // (the cron will re-check next cycle).
          if (allow404 && res.status === 404) {
            this.logger?.debug({ eventid }, '[ResultCron] 404 - result not declared yet');
            return NOT_DECLARED();
          }

          // Retry only on rate-limit or server errors
          if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
            const ra = parseRetryAfter(res.headers?.get?.('retry-after'));
            const wait = ra != null ? ra : jitter(this.retryBaseMs * Math.pow(2, attempt - 1));
            this.logger?.debug({ eventid, attempt, status: res.status, waitMs: wait }, '[ResultCron] retry backoff');
            await sleep(wait);
            continue;
          }

          return NOT_DECLARED();
        } catch (e) {
          const wait = jitter(this.retryBaseMs * Math.pow(2, attempt - 1));
          this.logger?.error({ eventid, attempt, error: e.message, nextWaitMs: wait }, '[ResultCron] fetch error');
          await sleep(wait);
        }
      }

      this.logger?.debug({ eventid }, '[ResultCron] max retries exhausted');
      return NOT_DECLARED();
    });
  }

  /**
   * The SCANNER's matcher.
   *
   * @legacy job.js `fetchResultForEvent`
   *
   * The one place `gameType` and `marketName` still matter: MO/BM pass
   * "Match_Odds"/"BookMaker" as `marketName`, FAN passes the selection name.
   */
  async fetchResultForScan(eventid, eventName, marketId, marketName, sport_id, market_type, gameType) {
    return this.#fetchAndMatch({
      eventid,
      sport_id,
      allow404: true,
      // NOTE the `scan*` normalizers — job.js strips punctuation, settlement.js
      // does not. See settlement.http.js.
      match: (markets) => {
        const inputMarketName = scanNormalizeText(marketName);
        const inputMarketType = scanNormalizeMarketType(market_type);

        if (market_type === 'TIED_MATCH' || market_type === 'Tied Match') {
          return markets.find((m) => scanNormalizeMarketType(m?.mname) === inputMarketType);
        }

        if (gameType === 'FAN' && (Number(sport_id) === 1 || Number(sport_id) === 2)) {
          const inputEventName = scanNormalizeText(eventName);
          const inputMname = scanNormalizeMarketType(market_type);

          // Match on event name (ename) + market type (mname). marketName here
          // is the market description (e.g. "UNDER 0.5 GOALS VS OVER 0.5 GOALS"),
          // NOT the event name, so comparing it to inputEventName never matched.
          return markets.find((m) =>
            scanNormalizeText(m?.ename) === inputEventName &&
            scanNormalizeMarketType(m?.mname) === inputMname
          );
        }

        if (gameType === 'FAN') {
          return markets.find((m) =>
            scanNormalizeText(m?.marketName) === inputMarketName &&
            scanNormalizeMarketType(m?.mname) === inputMarketType
          );
        }

        const inputEventName = scanNormalizeText(eventName);
        const inputMname = scanNormalizeMarketType(market_type);

        return markets.find((m) =>
          scanNormalizeText(m?.ename) === inputEventName &&
          scanNormalizeMarketType(m?.mname) === inputMname
        );
      },
    });
  }

  /**
   * The PAYOUT worker's MO/BM matcher — market type alone.
   *
   * @legacy settlement.js `fetchResultForEvent`
   *
   * `eventName` and `marketName` are accepted and ignored: legacy computes both
   * and then never uses them in the `find`. Kept in the signature so the call
   * site reads the same as the legacy one.
   */
  async fetchResultForEvent(eventid, eventName, marketId, marketName, sport_id, market_type, gameType) {
    return this.#fetchAndMatch({
      eventid,
      sport_id,
      match: (markets) => {
        const inputMname = normalizeMarketType(market_type);
        return markets.find((m) => normalizeMarketType(m?.mname) === inputMname);
      },
    });
  }

  /**
   * The PAYOUT worker's FAN matcher.
   *
   * @legacy settlement.js `fetchResultForEventFancy`
   *
   * Keys on `selection_name` (not the fancy name) for the general case, and on
   * the event name for soccer/tennis (`sid` 1 and 2).
   */
  async fetchResultForEventFancy(eventid, eventName, marketId, selection_name, sport_id, market_type) {
    return this.#fetchAndMatch({
      eventid,
      sport_id,
      match: (markets) => {
        const inputMarketName = normalizeText(selection_name);
        const inputMarketType = normalizeMarketType(market_type);

        if (market_type === 'TIED_MATCH' || market_type === 'Tied Match') {
          return markets.find((m) => normalizeMarketType(m?.mname) === inputMarketType);
        }

        if (Number(sport_id) === 1 || Number(sport_id) === 2) {
          const inputEventName = normalizeText(eventName);
          const inputMname = normalizeMarketType(market_type);

          // Match on event name (ename) + market type (mname). marketName
          // is the market description (e.g. "UNDER 0.5 GOALS VS OVER 0.5 GOALS"),
          // NOT the event name, so comparing it to inputEventName never matched.
          return markets.find((m) =>
            normalizeText(m?.ename) === inputEventName &&
            normalizeMarketType(m?.mname) === inputMname
          );
        }

        return markets.find((m) =>
          normalizeText(m?.marketName) === inputMarketName &&
          normalizeMarketType(m?.mname) === inputMarketType
        );
      },
    });
  }
}

module.exports = { ResultsClient, AsyncQueue };
