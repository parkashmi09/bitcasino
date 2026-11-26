'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { describeBalances } = require('../sockets');

// A credits row carries `user_type` (migration 099); read as an amount it failed USER_INFO for every player.
test('describeBalances lists coin balances only', () => {
  const out = describeBalances({ uid: '1', user_type: 'USER', usdt: '12.5', inr: null });
  assert.deepStrictEqual(Object.keys(out).sort(), ['inr', 'usdt']);
  assert.strictEqual(out.inr, '0.00000000');
});
