'use strict';

/**
 * Placing a sports bet, and a player's view of their own.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THREE IMPLEMENTATIONS, TWO OF THEM WRITING TO A TABLE THAT DOES NOT EXIST
 *
 *   legacy/sportsmain/API/controller.js        → INSERT INTO "SportsBet"
 *   legacy/sportsbet/sportbetscontroller.js    → INSERT INTO sports_bets
 *   legacy/sportsapi/bettingsports/…           → INSERT INTO sports_bets
 *
 * The table is `"SportsBet"` — quoted, PascalCase. There is no `sports_bets`
 * in the schema and no migration has ever created one, so `POST
 * /sportsbetting/place` and `POST /bets` have never placed a bet: the insert
 * throws "relation does not exist", the handler rolls back and answers 400.
 *
 * `legacy/sportsbet/betresult/settlementWorker.js` reads and updates
 * `sports_bets` as well, so that whole settlement worker has been operating on
 * nothing since it was written.
 *
 * The three are one service here, so a fix cannot land in one copy and miss two.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `bets.service.js` IS THE ONE THAT WORKS, PORTED VERBATIM
 *
 * `POST /api/sportsmain/place-bet` — controller.js:117-2107 — is copied step
 * for step: the market tables, the branch chain, the float arithmetic, the
 * liability rules, the columns on the insert and the response body. The raw
 * `pg.query` calls are the equivalent Sequelize model calls and nothing else
 * moved. See the banner on `bets.service.js` for the four deliberate
 * departures and the legacy quirks that were kept on purpose.
 *
 * WHAT THE PORT FIXES, AND WHY THOSE FOUR AND NOT MORE
 *
 * THE PLAYER WAS NAMED IN THE BODY. `const { ..., user_id } = req.body`, on an
 * unauthenticated route, and that id is whose wallet gets debited. Not merely
 * impersonation — you can drain an account by placing losing bets on its
 * behalf. The route authenticates and the controller overwrites `user_id` with
 * `req.user.id`; the field still parses, so the board's payload is unchanged.
 *
 * `BEGIN` WAS ISSUED ON ONE SHARED CLIENT. `pg` is a single shared `pg.Client`
 * — `General/Model` constructs one Client for the whole process and exports
 * it. So `BEGIN` did not open a transaction for THAT request; it opened one on
 * the only connection there is, and every concurrent request in the process
 * then ran inside it. A `ROLLBACK` from one request discarded another
 * request's writes. `db.transaction` is per request.
 *
 * THE BALANCE CHECK WAS READ-THEN-WRITE ACROSS A GAP. `SELECT * FROM credits
 * ... FOR UPDATE` did lock the row, but the exposure rows it also locked FOR
 * UPDATE only exist after the first bet — so the first two bets on a match
 * raced, each read an empty position, and each blocked liability as though it
 * were the only bet. An advisory lock on (player, match) has no such gap.
 *
 * WHAT IS STILL TRUE, BECAUSE IT IS THE LEGACY BEHAVIOUR
 *
 * THE ODDS COME FROM THE BODY. `verifyBetAgainstLiveOdds` compares them to the
 * cached book and that is the entire defence — a cold `oddsData:<gmid>` is a
 * refusal, and `BET_GUARD_ALLOW_ON_MISS=true` turns the check off outright.
 *
 * SO DOES EVERYTHING ELSE ON THE ROW — `team_one`, `team_two`, `match_title`,
 * `selection_name`, `category`, `eventid`, `runners`. The runner list in
 * particular decides the whole exposure map on the match-odds branch.
 * ═════════════════════════════════════════════════════════════════════════
 */
module.exports = {
  name: 'bets',
  service: 'sports',
  basePath: '/bets',
  models: ['sports', 'core', 'extended'],
  routers: {
    user: require('./routes/user.routes'),
  },
};
