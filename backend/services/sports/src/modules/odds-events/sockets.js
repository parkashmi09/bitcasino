'use strict';

const { mssports } = require('../../lib/mssports');

/**
 * Live odds of the match pages over the socket — `sockets/oddsPush.mjs` (TENEXCH odds push).
 *
 *  client → 'subscribeMatch' {gmid, sid} / 'unsubscribeMatch'
 *  server → 'matchOdds' {gmid, sid, status, body, at}   the REST get-match-private-data reply
 *           'matchOdds' {gmid, sid, at}                 heartbeat while the board is unchanged
 */
function setupOddsSocket(io) {
  const { setupOddsPush, matchPrivateDataReply } = mssports();
  setupOddsPush(io, { read: matchPrivateDataReply });
}

module.exports = { setupOddsSocket };
