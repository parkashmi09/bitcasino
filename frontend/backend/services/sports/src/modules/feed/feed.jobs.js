'use strict';

/**
 * The two feed pollers, ported from `legacy/sportsmain/cron/`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE ARCHITECTURE THESE IMPLEMENT
 *
 * `legacy/sportsmain/API/service.js` NEVER CALLS THE PROVIDER. Both of its
 * functions are cache reads:
 *
 *     getAllSportsData(sid)   → getCommonData(`alleventsData:${sid}`)
 *     getSportsDataById(gmid) → getCommonData(`oddsData:${gmid}`)
 *
 * These two jobs are the only things upstream, and the API serves whatever they
 * last wrote. That is not an optimisation — it is the only shape that works at
 * this cadence. Odds refresh every TWO SECONDS across every live match; fetching
 * per request would mean one upstream call per player per market per refresh,
 * against a provider that rate-limits.
 *
 * ── AND THE SECOND JOB DEPENDS ON THE FIRST ──────────────────────────────
 *
 * `odds.js` does not know which matches exist. It reads the gmids back out of
 * `alleventsData:` and polls those. So a cold cache produces nothing from the
 * odds job until the events job has run once — which is why `feed:events` runs
 * immediately on boot rather than waiting out its first interval.
 * ═════════════════════════════════════════════════════════════════════════
 */

const { FeedClient } = require('./feedClient');
const { boardRows } = require('./dialects');

/** Legacy's key names, kept verbatim — the read side is keyed on these. */
const EVENTS_KEY = (sportId) => `alleventsData:${sportId}`;
const ODDS_KEY = (gmid) => `oddsData:${gmid}`;

/**
 * TTLs, from the legacy crons.
 *
 * The events list outlives its refresh by a wide margin (3h vs 60s) so a
 * provider outage degrades to stale fixtures rather than an empty board. Odds
 * expire in 5s against a 2s poll — barely more than one cycle, because a stale
 * PRICE is worse than no price: it is what a bet would be matched against.
 */
const EVENTS_TTL_SECONDS = 60 * 60 * 3;
const ODDS_TTL_SECONDS = 5;

/** Legacy paced its sport loop to avoid hammering the provider. */
const DELAY_BETWEEN_SPORTS_MS = 1000;

/**
 * Split a board into the tiers the read side expects.
 *
 * Legacy's `normalizeEvents` handles two upstream shapes: the provider's own
 * `{t1, t2}`, and a flat array it splits on status. Both are kept — the second
 * is what a differently-configured provider returns, and dropping it would make
 * this job silently produce empty tiers there.
 *
 * `t3` is written because legacy writes it. The API only ever reads `t1` and
 * `t2` (`controller.js` copies exactly those two), so it is dead weight — but
 * it is dead weight some other reader may depend on, and this port is not the
 * place to decide that.
 */
function normaliseEvents(data) {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return {
      t1: Array.isArray(data.t1) ? data.t1 : [],
      t2: Array.isArray(data.t2) ? data.t2 : [],
      t3: Array.isArray(data.t3) ? data.t3 : [],
    };
  }

  if (Array.isArray(data)) {
    const open = (e) => e?.status === 'OPEN' && e?.gscode === 1;
    const closed = (e) => e?.status === 'SUSPENDED' || e?.gscode === 0;
    return { t1: data.filter(open), t2: data.filter(closed), t3: data.filter(closed) };
  }

  return { t1: [], t2: [], t3: [] };
}

/** The sports to poll — `SPORTS_ACTIVE_EIDS`, which mirrors legacy's `sidArray`. */
function activeSportIds(config) {
  const raw = config?.SPORTS_ACTIVE_EIDS;
  const list = (Array.isArray(raw) ? raw : String(raw || '').split(','))
    .map((v) => Number(String(v).trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return list.length ? list : [4, 1, 2];
}

/**
 * @legacy sportsmain/cron/allevent.js
 *
 * Every active sport's board → `alleventsData:<sportId>`.
 */
function createEventsJob({ config, logger, cache }) {
  const feed = new FeedClient({ config, logger });

  return async function pollEvents() {
    const sports = activeSportIds(config);
    let written = 0;

    for (const sportId of sports) {
      try {
        // `/getEventsBySportsID` is the dialect's name for one sport's board.
        const board = await feed.get('/getEventsBySportsID', { sportid: sportId });
        const tiers = normaliseEvents(
          Array.isArray(board) ? board : boardRows(board)
        );

        await cache.set(EVENTS_KEY(sportId), JSON.stringify(tiers), EVENTS_TTL_SECONDS);
        written += 1;

        logger?.debug(
          { sportId, t1: tiers.t1.length, t2: tiers.t2.length, t3: tiers.t3.length },
          'Events cached'
        );
      } catch (error) {
        // One sport failing must not stop the others — a provider hiccup on
        // tennis should not take cricket off the board.
        logger?.warn({ sportId, err: error.message }, 'Events poll failed for one sport');
      }

      // Legacy's pacing. Skipped after the last sport — a delay there only
      // makes the job appear to take a second longer than it did.
      if (sportId !== sports[sports.length - 1]) {
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_SPORTS_MS));
      }
    }

    return { sports: sports.length, written };
  };
}

/**
 * @legacy sportsmain/cron/odds.js
 *
 * Every live match's full book → `oddsData:<gmid>`.
 *
 * The match list comes from what the events job wrote, not from the provider —
 * see the note at the top of this file.
 */
function createOddsJob({ config, logger, cache }) {
  const feed = new FeedClient({ config, logger });

  return async function pollOdds() {
    const started = Date.now();
    const sports = activeSportIds(config);

    // ── which matches, from the events cache ────────────────────────────
    const targets = [];
    for (const sportId of sports) {
      try {
        const cached = await cache.get(EVENTS_KEY(sportId));
        if (!cached) continue;

        const parsed = JSON.parse(cached);
        const rows = [
          ...(Array.isArray(parsed?.t1) ? parsed.t1 : []),
          ...(Array.isArray(parsed?.t2) ? parsed.t2 : []),
        ];

        // A match appears once per market on the board; the book is per match.
        for (const gmid of new Set(rows.filter((r) => r?.gmid).map((r) => r.gmid))) {
          targets.push({ sportId, gmid });
        }
      } catch (error) {
        logger?.warn({ sportId, err: error.message }, 'Could not read the events cache');
      }
    }

    if (!targets.length) return { matches: 0, withOdds: 0, failed: 0, ms: Date.now() - started };

    /**
     * All matches concurrently.
     *
     * `allSettled`, so one match's failure costs only that match — with
     * hundreds live and a 2-second budget, a single rejection must not abort
     * the batch.
     */
    const results = await Promise.allSettled(
      targets.map(async ({ sportId, gmid }) => {
        const book = await feed.get('/GetLineMarket', { eventid: gmid, etid: sportId });
        const markets = Array.isArray(book) ? book : boardRows(book);

        // Legacy only writes when there is something to write, so a match that
        // momentarily returns nothing keeps its last good book until the TTL.
        if (!markets.length) return false;

        await cache.set(ODDS_KEY(gmid), JSON.stringify(markets), ODDS_TTL_SECONDS);
        return true;
      })
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    const withOdds = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    const ms = Date.now() - started;

    /**
     * A cycle that outruns its own interval.
     *
     * At that point each run is starting before the last finished, the odds in
     * the cache are older than their TTL suggests, and the only fix is fewer
     * matches or a longer interval. The worker skips overlapping runs, so this
     * degrades into a lower refresh rate rather than a pile-up — but silently,
     * which is why it is logged.
     */
    if (ms > 2500) {
      logger?.warn({ ms, matches: targets.length }, 'Odds cycle is slower than its interval');
    }

    return { matches: targets.length, withOdds, failed, ms };
  };
}

module.exports = {
  createEventsJob,
  createOddsJob,
  normaliseEvents,
  activeSportIds,
  EVENTS_KEY,
  ODDS_KEY,
  EVENTS_TTL_SECONDS,
  ODDS_TTL_SECONDS,
};
