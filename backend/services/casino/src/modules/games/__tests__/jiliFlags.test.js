'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { isRowEntitledIn, flagsFor } = require('../gameEntitlement');

// `jili` and `jilli` are one provider under two keys: switching EITHER off must close JILI
// (lists filter on any flag off, launch asserts every flag).
test('either JILI key switched off closes JILI games; both on leaves them open', () => {
  const row = { vendor: 'JILI', game_type: 'slot' };
  assert.equal(isRowEntitledIn({ flags: { jili: false } }, row), false);
  assert.equal(isRowEntitledIn({ flags: { jilli: false } }, row), false);
  assert.equal(isRowEntitledIn({ flags: { jili: true, jilli: true } }, row), true);
  assert.deepEqual(flagsFor({ provider: 'jili', type: 'slot' }, new Set()).filter((f) => f.startsWith('jil')).sort(), ['jili', 'jilli']);
});
