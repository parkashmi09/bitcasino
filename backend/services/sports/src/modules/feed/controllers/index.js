'use strict';

const { response, asyncHandler } = require('@ibitplay/common');

/**
 * The feed endpoints.
 *
 * Every one is a read that answers from the upstream provider through a cached,
 * timeout-bounded client. In legacy each of these went through a BullMQ queue
 * and blocked on `job.waitUntilFinished()` — a queue used as synchronous RPC,
 * with no timeout on the wait, so a stopped worker turned every read into a
 * hang rather than an error.
 */
function createControllers({ service }) {
  const ok = (fn) => asyncHandler(async (req, res) => response.ok(res, await fn(req)));

  return {
    /** @legacy POST /sports/inplay */
    inplay: ok((req) => service.inplay(req.query)),

    /** @legacy GET /sports/allinplay */
    allInplay: ok(() => service.allInplay()),

    /** @legacy GET /sports/inplayGameId/:gameId */
    inplayByGame: ok((req) => service.inplayByGame(req.params)),

    /** @legacy GET /sports/all-matches */
    allMatches: ok(() => service.allMatches()),

    /** @legacy GET /sports/matches/:gameId */
    matchesByGame: ok((req) => service.matchesByGame(req.params)),

    /** @legacy GET /sports/matches-by-date/:dateType */
    matchesByDate: ok((req) => service.matchesByDate(req.params)),

    /** @legacy GET /sports/matches/:dateType/:gameId */
    matchesByDateAndGame: ok((req) => service.matchesByDateAndGame(req.params)),

    /** @legacy GET /sports/getSeries */
    series: ok((req) => service.series(req.query)),

    /** @legacy GET /sports/getMatchesBySportsID */
    eventsBySport: ok((req) => service.eventsBySport(req.query)),

    /** @legacy GET /sports/getMatchesBySportsIDSeriesID */
    eventsBySeries: ok((req) => service.eventsBySeries(req.query)),

    /** @legacy GET /sports/allSportsID */
    allSportIds: ok(() => service.allSportIds()),

    /** @legacy GET /sports/eventList */
    eventList: ok((req) => service.eventList(req.query)),

    /** @legacy GET /sports/event-details */
    eventDetails: ok((req) => service.eventDetails(req.query)),

    /** @legacy GET /sports/market-ids-v1 */
    marketIdsV1: ok((req) => service.marketIdsV1(req.query)),

    /** @legacy GET /sports/market-ids-v2 */
    marketIdsV2: ok((req) => service.marketIdsV2(req.query)),

    /** @legacy GET /sports/market-odds */
    marketOdds: ok((req) => service.marketOdds(req.query)),

    /** @legacy GET /sports/lineMarket */
    lineMarket: ok((req) => service.lineMarket(req.query)),

    /** @legacy GET /sports/marketDetails */
    marketDetails: ok((req) => service.marketDetails(req.query)),

    /** @legacy GET /sports/bookmakerFancy */
    bookmakerFancy: ok((req) => service.bookmakerFancy(req.query)),

    /**
     * @legacy GET /sports/event-result
     * @legacy GET /event-result
     */
    eventResult: ok((req) => service.eventResult(req.query)),

    /**
     * @legacy GET /sports/event-list-result
     * @legacy GET /event-list-result
     */
    eventListResult: ok((req) => service.eventListResult(req.query)),

    // ── The second provider ───────────────────────────────────────────
    //
    // All five were POSTs in legacy with the parameters in the body, and all
    // five are reads. They are GETs with query parameters here.

    /** @legacy POST /api/sportsmain/get-all-sports-data */
    liveSportsData: ok((req) => service.liveSportsData(req.query)),

    /** @legacy POST /api/sportsmain/get-sports-data-id */
    liveSportsDataById: ok((req) => service.liveSportsDataById(req.query)),

    /** @legacy POST /api/sportsmain/get-result */
    liveResult: ok((req) => service.liveResult(req.query)),

    /** @legacy POST /api/sportsmain/get-live-stream */
    liveStream: ok((req) => service.liveStream(req.query)),

    /** @legacy POST /api/sportsmain/get-scorecard */
    scorecard: ok((req) => service.scorecard(req.query)),
  };
}

module.exports = { createControllers };
