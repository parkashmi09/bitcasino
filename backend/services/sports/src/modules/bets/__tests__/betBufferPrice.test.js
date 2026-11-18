'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('only Match Odds, Bookmaker and Tied Match refuse a moved price', async () => {
  const { autoBetCheck, deriveBufferFlags } = await import('../buffer/betBufferRules.mjs');
  const flags = (gtype, mname) => deriveBufferFlags({ marketList: [{ mid: 1, gtype, mname }], marketId: 1 });
  const check = (gtype, mname, betType, selectedOdds, currentOdds) => {
    const f = flags(gtype, mname);
    return autoBetCheck({ marketType: f.marketType, betType, selectedOdds, currentOdds });
  };

  for (const [gtype, mname] of [['match', 'Match Odds'], ['match1', 'Bookmaker'], ['match', 'Tied Match']]) {
    assert.deepEqual(check(gtype, mname, 'back', 2, 2.2), { accept: true, finalOdds: 2.2 }, `${mname} back up`);
    assert.equal(check(gtype, mname, 'back', 2, 1.9).accept, false, `${mname} back down`);
    assert.deepEqual(check(gtype, mname, 'lay', 2, 1.9), { accept: true, finalOdds: 1.9 }, `${mname} lay down`);
    assert.equal(check(gtype, mname, 'lay', 2, 2.2).accept, false, `${mname} lay up`);
    assert.equal(flags(gtype, mname).liveTracked, true);
  }

  // Another match market books at the live price, better or worse.
  assert.deepEqual(check('match', 'Over/Under 3.5', 'back', 2, 1.8), { accept: true, finalOdds: 1.8 });
  assert.deepEqual(check('match', 'Over/Under 3.5', 'lay', 2, 2.2), { accept: true, finalOdds: 2.2 });
  assert.equal(flags('match', 'Over/Under 3.5').liveTracked, true);

  // match1 is not live-tracked unless the market itself is a Bookmaker.
  assert.equal(flags('match1', 'BM 2nd Set Winner').liveTracked, false);

  assert.equal(flags('fancy', 'Normal').liveTracked, false);
});
