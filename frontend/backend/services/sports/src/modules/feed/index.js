'use strict';

/**
 * The odds feed — everything read from the upstream sports data provider.
 *
 * In-play scores, fixtures, series, market ids, prices, fancy sessions and
 * results. Nothing here writes; nothing here settles. It is the read side of
 * the book, and `modules/settlement` is what acts on it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE FEED WAS FETCHED OVER PLAIN HTTP FROM A BARE IP ADDRESS
 *
 *     const BASE_URL = 'http://46.202.164.63:6565/api';
 *
 * Repeated in nine controllers. No TLS, so no certificate to validate and
 * nothing authenticating the far end — every odds price, every in-play score
 * and every match RESULT arrived in cleartext over a path anyone between the
 * two hosts can rewrite. On a betting platform that is not a privacy problem,
 * it is the book: an attacker who can change a result in flight decides who
 * won.
 *
 * `SPORTS_FEED_URL` is configuration now and the client refuses a plain
 * `http://` origin unless `SPORTS_FEED_ALLOW_INSECURE` is explicitly set, so
 * moving to https is a config change and staying on http is a decision
 * somebody had to write down.
 *
 * ── THE KEY WAS IN THE SOURCE, AND IN THE QUERY STRING ───────────────────
 *
 *     const API_KEY = process.env.SCORESWIFT_KEY || 'bit_wyusjkwiyu';
 *     axios.get(`${BASE_URL}/inplay?key=${API_KEY}`, {
 *       headers: { 'X-ScoreSwift-Key': API_KEY }
 *     })
 *
 * A hardcoded fallback — so a deployment that forgot the variable still worked,
 * with the committed key — sent BOTH in a header and in the URL. Query strings
 * are written to access logs, proxy logs and error reports as a matter of
 * course. The header alone carries it here, and there is no fallback: a missing
 * key stops the service at boot rather than silently using the public one.
 *
 * ── EVERY READ WENT THROUGH A QUEUE, SYNCHRONOUSLY ───────────────────────
 *
 * `sportsapiroutes.js` wraps almost every route in:
 *
 *     const job = await sportsQueue.add(controllerName, {...});
 *     const { statusCode, data } = await job.waitUntilFinished(queueEvents);
 *
 * A BullMQ queue used as a synchronous RPC. Two Redis round trips and a worker
 * hop added to a plain GET, no timeout on the wait, and if the worker is not
 * running every read hangs rather than failing. The module also called
 * `process.exit(1)` from its top level when Redis was not ready at import —
 * so a Redis blip during boot took down the entire API process, including every
 * route that has nothing to do with sports.
 *
 * These are HTTP reads of an HTTP feed. They are served in-process, with a
 * timeout and a short cache.
 *
 * ── AND THE ONLY MIDDLEWARE WAS NOT AUTHENTICATION ───────────────────────
 *
 * `sportsmiddleware.js` checks whether sports are globally switched on and,
 * if `req.body.gameId` is present, whether that game is enabled. That is a
 * feature flag, not a guard — and since it reads the game id from the BODY,
 * the per-game check never fired on any of the 30-odd GET routes. It is kept
 * as a flag, on the flag's own terms.
 */
module.exports = {
  name: 'feed',
  service: 'sports',
  basePath: '/feed',
  models: ['sports', 'extended'],
  routers: {
    // Odds and fixtures are public by design — a player has to see the board
    // before signing in. `public` is an AUDIENCE here, not a path segment: it
    // mounts at /api/v1/sports/feed exactly like `user` does, without a guard.
    public: require('./routes/public.routes'),
  },

  /**
   * The two pollers, ported from `legacy/sportsmain/cron/`.
   *
   * They run in the SPORTS WORKER, not here — `worker.js` collects `jobs` from
   * every module and the HTTP service ignores them. That separation is the
   * point: the odds job runs every two seconds, and sharing an event loop with
   * request handling would put every bet placement behind a feed poll.
   *
   * `immediate` on the events job because the odds job reads its output — a
   * cold start would otherwise produce no odds for the first sixty seconds.
   */
  jobs: [
    {
      name: 'feed:events',
      intervalMs: 60_000,
      immediate: true,
      run: (container) => require('./feed.jobs').createEventsJob(container)(),
    },
    {
      name: 'feed:odds',
      intervalMs: 2_000,
      run: (container) => require('./feed.jobs').createOddsJob(container)(),
    },
  ],
};
