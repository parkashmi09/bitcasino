'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Security (S3): market_type / game_type are the feed market's, never the client's.
test('feedBetLabels derives market_type / game_type from the feed market as the player site does', async () => {
  const { feedBetLabels } = await import('../buffer/betBufferRules.mjs');
  const labels = (gtype, mname) => feedBetLabels({ marketList: [{ mid: 1, gtype, mname }], marketId: '1' });
  assert.deepEqual(labels('match', 'MATCH_ODDS'), { marketType: 'MATCH_ODDS', gameType: 'MATCH', mname: 'MATCH_ODDS', gtype: 'match' });
  assert.equal(labels('match1', 'Bookmaker').gameType, 'BOOKMAKER');
  assert.equal(labels('match1', 'Bookmaker 2').marketType, 'Bookmaker 2');
  assert.deepEqual([labels('match1', 'Tied_Match').marketType, labels('match1', 'Tied_Match').gameType], ['Tied Match', 'FANCY']);
  assert.equal(labels('fancy', 'Normal').gameType, 'FANCY');
  assert.equal(labels('oddeven', 'oddeven').gameType, 'FANCY');
  assert.equal(labels('fancy3', 'Total Runs').gameType, 'MATCH');
  assert.equal(feedBetLabels({ marketList: [], marketId: 1 }), null);
});

test('checkBetLive refuses a Bookmaker bet labelled MATCH_ODDS and stores the feed labels on an honest one', async (t) => {
  // betBuffer loads the controller, which opens the Redis client and the DB pool; close them so the file exits.
  t.after(async () => {
    const { redisClient_default } = await import('../../../lib/config/redisClient.mjs');
    const { db_default } = await import('../../../lib/config/db.mjs');
    redisClient_default?.disconnect();
    await db_default?.close?.();
  });
  const { liveOdds_default } = await import('../buffer/liveOdds.mjs');
  const { checkBetLive } = await import('../buffer/betBuffer.mjs');
  const market = {
    mid: 'M1', gtype: 'match1', mname: 'Bookmaker', status: 'OPEN',
    section: [
      { sid: 11, nat: 'Team A', gstatus: 'ACTIVE', odds: [{ otype: 'back', oname: 'back1', tno: 0, odds: 30, size: 100 }, { otype: 'lay', oname: 'lay1', tno: 0, odds: 32, size: 100 }] },
      { sid: 22, nat: 'Team B', gstatus: 'ACTIVE', odds: [{ otype: 'back', oname: 'back1', tno: 0, odds: 300, size: 100 }, { otype: 'lay', oname: 'lay1', tno: 0, odds: 320, size: 100 }] },
    ],
  };
  liveOdds_default.acquire = async () => {};
  liveOdds_default.release = () => {};
  liveOdds_default.snapshot = () => ({ list: [market], ageMs: 0 });
  const bet = (extra) => ({
    eventid: 'G1', sid: '4', match_id: 'M1', selection_id: 11, selection_name: 'Team A',
    bet_type: 'back', odds: 30, stake_amount: 100, ...extra,
  });

  assert.equal((await checkBetLive(bet({ market_type: 'MATCH_ODDS', game_type: 'MATCH' }))).code, 'MARKET_TYPE_MISMATCH');
  assert.equal((await checkBetLive(bet({ market_type: 'Bookmaker', game_type: 'MATCH' }))).code, 'GAME_TYPE_MISMATCH');
  assert.equal((await checkBetLive(bet({ market_type: 'Bookmaker', game_type: 'FANCY' }))).code, 'GAME_TYPE_MISMATCH');

  const honest = bet({ market_type: 'BOOKMAKER', game_type: 'BM', mname: 'x', gtype: 'match' });
  const d = await checkBetLive(honest);
  assert.equal(d.accept, true);
  assert.deepEqual(
    [honest.market_type, honest.game_type, honest.mname, honest.gtype],
    ['Bookmaker', 'BOOKMAKER', 'Bookmaker', 'match1'],
  );
});
