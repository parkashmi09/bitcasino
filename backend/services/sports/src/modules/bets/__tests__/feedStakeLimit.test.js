'use strict';

const test = require('node:test');
const assert = require('node:assert');

test('feedMaxStake: TENEXCH rule — in-play maxb (else max), pre-match umaxbof, other markets their max', async () => {
  const { feedMaxStake } = await import('../../../lib/helper/feedStakeLimit.mjs');
  const mo = { gtype: 'match', max: 2000, maxb: 1, umaxbof: 1 };
  assert.strictEqual(feedMaxStake({ ...mo, iplay: false }), 1); // pre-match cricket MO: not open yet
  assert.strictEqual(feedMaxStake({ ...mo, maxb: 10000, iplay: true }), 10000);
  const race = { gtype: 'match', max: 2000, maxb: 1, umaxbof: 10000 };
  assert.strictEqual(feedMaxStake({ ...race, iplay: false }), 10000);
  assert.strictEqual(feedMaxStake({ ...race, iplay: true }), 1);
  assert.strictEqual(feedMaxStake({ gtype: 'match', max: 0, maxb: 100000, umaxbof: 1, iplay: true }), 100000);
  assert.strictEqual(feedMaxStake({ gtype: 'match1', max: 100000, maxb: 0, umaxbof: 0 }), 100000);
  assert.strictEqual(feedMaxStake({ gtype: 'fancy2', max: 0, maxb: 1, umaxbof: 1 }), 0);
  assert.strictEqual(feedMaxStake({ gtype: 'match', max: '50000' }), 50000); // no umaxbof → its max
  assert.strictEqual(feedMaxStake(null), 0);
});
