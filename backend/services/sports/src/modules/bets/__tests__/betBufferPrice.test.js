'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('match and match1: a better price is taken, a worse one refused', async () => {
  const { autoBetCheck, deriveBufferFlags } = await import('../buffer/betBufferRules.mjs');
  const flags = (gtype, mname) => deriveBufferFlags({ marketList: [{ mid: 1, gtype, mname }], marketId: 1 });
  const check = (gtype, mname, betType, selectedOdds, currentOdds) => {
    const f = flags(gtype, mname);
    return autoBetCheck({ marketType: f.marketType, priceGuarded: f.priceGuarded, betType, selectedOdds, currentOdds });
  };

  for (const [gtype, mname] of [['match', 'Match Odds'], ['match', 'Over/Under 3.5'], ['match1', 'Bookmaker'], ['match1', 'BM 2nd Set Winner']]) {
    assert.deepEqual(check(gtype, mname, 'back', 2, 2.2), { accept: true, finalOdds: 2.2 }, `${mname} back up`);
    assert.equal(check(gtype, mname, 'back', 2, 1.9).accept, false, `${mname} back down`);
    assert.deepEqual(check(gtype, mname, 'lay', 2, 1.9), { accept: true, finalOdds: 1.9 }, `${mname} lay down`);
    assert.equal(check(gtype, mname, 'lay', 2, 2.2).accept, false, `${mname} lay up`);
    assert.equal(flags(gtype, mname).liveTracked, true);
  }

  assert.equal(flags('fancy', 'Normal').priceGuarded, false);
  assert.equal(flags('fancy', 'Normal').liveTracked, false);
});
