'use strict';

const { mssports } = require('../../lib/mssports');

/**
 * Live odds of the match pages over the socket — `sockets/oddsPush.mjs` (TENEXCH odds push).
 *
 *  client → 'subscribeMatch' {gmid, sid} / 'unsubscribeMatch'
 *  server → 'matchOdds' {gmid, sid, status, body, at}   the REST get-match-private-data reply
 *           'matchOdds' {gmid, sid, at}                 heartbeat while the board is unchanged
 *
 * The lobby's sport boards the same way — `sockets/boardPush.mjs` (rainbet):
 *  client → 'subscribeSport' {sid} / 'unsubscribeSport' {sid}
 *  server → 'sportBoard' {sid, status, body, at}       the REST cricket/all-data reply
 */
function setupOddsSocket(io) {
  const { setupOddsPush, matchPrivateDataReply, setupBoardPush, sportBoardReply } = mssports();
  setupOddsPush(io, { read: matchPrivateDataReply });
  setupBoardPush(io, { read: sportBoardReply });
}

module.exports = { setupOddsSocket };
