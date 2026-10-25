'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { flagOnIn } = require('../src/entitlements');

test('sports runs one mode: the sportsbook is off unless set, and on it closes the exchange', () => {
  const mode = (flags) => [flagOnIn({ flags }, 'sportsbook'), flagOnIn({ flags }, 'sportsexchange')];
  assert.deepEqual(mode({}), [false, true]); // nothing stored: today's site, the exchange
  assert.deepEqual(mode({ sportsbook: true }), [true, false]);
  assert.deepEqual(mode({ sportsbook: true, sportsexchange: true }), [true, false]);
  assert.deepEqual(mode({ sportsexchange: false }), [false, false]);
  assert.equal(flagOnIn({ flags: {} }, 'casino'), true); // other flags still read on when absent
});
