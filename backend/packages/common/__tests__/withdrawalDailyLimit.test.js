'use strict';

const test = require('node:test');
const assert = require('node:assert');

const daily = require('../src/withdrawalDailyLimit');

/**
 * The owner's daily withdrawal limit per currency (withdrawalDailyLimit.js): the reader every
 * service uses, the strict saver the owner panel mirrors, and the rolling-24h usage query.
 */

test('an older document (no block) reads as off, with no currency', () => {
  assert.deepEqual(daily.cleanWithdrawalDailyLimit(undefined), { enabled: false, limits: {} });
  assert.equal(daily.limitFor(undefined, 'INR'), null);
});

test('reader: currency upper-cased, amounts normalised, bad rows dropped', () => {
  const b = daily.cleanWithdrawalDailyLimit({ enabled: true, limits: { inr: '50000', USDT: 0.5, BTC: '0', X: '5', ETH: '1.123456789' }, extra: 1 });
  assert.deepEqual(b, { enabled: true, limits: { INR: '50000.00000000', USDT: '0.50000000' } });
});

test('limitFor: only while on, and only for a listed currency', () => {
  const on = { enabled: true, limits: { INR: '1000' } };
  assert.equal(daily.limitFor(on, 'inr'), '1000.00000000');
  assert.equal(daily.limitFor(on, 'USDT'), null);
  assert.equal(daily.limitFor({ ...on, enabled: false }, 'INR'), null);
});

test('saver: strict fields, codes and amounts; on needs a currency', () => {
  assert.equal(daily.withdrawalDailyLimitProblem({ enabled: true, limits: { INR: '50000' } }), null);
  assert.equal(daily.withdrawalDailyLimitProblem({ enabled: false, limits: {} }), null);
  assert.match(daily.withdrawalDailyLimitProblem({ enabled: true, limits: {} }), /add at least one currency/);
  assert.match(daily.withdrawalDailyLimitProblem({ enabled: true, limits: { inr: '1' } }), /not a currency code/);
  assert.match(daily.withdrawalDailyLimitProblem({ enabled: true, limits: { INR: '0' } }), /above 0/);
  assert.match(daily.withdrawalDailyLimitProblem({ enabled: true, limits: { INR: '1.123456789' } }), /8 decimals/);
  assert.match(daily.withdrawalDailyLimitProblem({ enabled: true, limits: { INR: '1000000000000.01' } }), /at most/);
  assert.match(daily.withdrawalDailyLimitProblem({ enabled: true, limits: { INR: '1' }, extra: 1 }), /not a field/);
  assert.match(daily.withdrawalDailyLimitProblem({ enabled: 'yes', limits: {} }), /true or false/);
});

test('computeDaily: remaining = limit − used, floored at zero', () => {
  assert.deepEqual(daily.computeDaily({ limit: '1000', used: '400' }), { limit: '1000.00000000', used: '400.00000000', remaining: '600.00000000' });
  assert.equal(daily.computeDaily({ limit: '1000', used: '1200' }).remaining, '0.00000000');
});

test('usage: the rolling 24 hours, every rail, the cap\'s withdrawn rule plus P2P sells', async () => {
  let seen;
  const figures = daily.createDailyFigures({
    db: { sequelize: { query: async (sql, opts) => ((seen = { sql, opts }), [{ total: '1234.5' }]) } },
  });
  assert.equal(await figures.used(7, 'inr'), '1234.50000000');
  assert.deepEqual(seen.opts.replacements, { uid: '7', uidText: '7', cur: 'INR' });
  for (const table of ['fiat_withdrawals', 'withdrawals', 'apaywithdrawals', 'pay_out_transactions', 'f2paywithdrawals', 'p2p_orders_sell', 'tips']) {
    assert.ok(seen.sql.includes(table), table);
  }
  assert.equal((seen.sql.match(/interval '24 hours'/g) ?? []).length, 7, 'every rail is windowed');
  assert.ok(!seen.sql.includes('staff_transfers'), 'an agent collection is not a player withdrawal');
});

test('the 24h usage counts tips sent (money out, like a withdrawal)', () => {
  const { USED_SQL } = require('../src/withdrawalDailyLimit');
  assert.match(USED_SQL, /FROM tips\s+WHERE from_user_id = :uid AND upper\(currency\) = :cur/);
});
