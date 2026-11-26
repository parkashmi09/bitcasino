'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createWithdrawControls, resolve, isUnderAutoLimit } = require('../withdrawControls');
const v = require('../withdrawControls.validators');

/**
 * A fake connection: answers the settings reads and the usage query from plain objects, and
 * records whether the per-player lock was taken.
 */
function fakeDb({ site = null, player = null, used = { count: 0, total: '0' } } = {}) {
  const calls = [];
  return {
    calls,
    sequelize: {
      async query(sql) {
        calls.push(sql);
        if (sql.includes('pg_advisory_xact_lock')) return [];
        if (sql.includes('FROM withdraw_controls')) return site ? [site] : [];
        if (sql.includes('FROM player_withdraw_limits')) return player ? [player] : [];
        if (sql.includes('AS count')) return [used];
        throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
      },
    },
  };
}

const check = (db, amount, currency = 'USDT') =>
  createWithdrawControls({ db }).assertInTransaction(7, { amount, currency, transaction: {} });

test('withdraw controls', async (t) => {
  await t.test('a player value overrides the site value; null falls back', () => {
    const r = resolve(
      { auto_limit: '500', daily_count: 5, daily_amount: '2000', max_single: '1000' },
      { daily_count: 2, daily_amount: null, max_single: '300', auto_allowed: true }
    );
    assert.deepEqual(r, { autoLimit: '500.00000000', dailyCount: 2, dailyAmount: '2000.00000000', maxSingle: '300.00000000', autoAllowed: true });
  });

  await t.test('a player opted out of auto-send has no auto limit', () => {
    assert.equal(resolve({ auto_limit: '500' }, { auto_allowed: false }).autoLimit, null);
  });

  await t.test('auto-send is strictly below the limit', () => {
    const r = { autoLimit: '500.00000000' };
    assert.equal(isUnderAutoLimit(r, '499.99'), true);
    assert.equal(isUnderAutoLimit(r, '500'), false);
    assert.equal(isUnderAutoLimit(r, '501'), false);
    assert.equal(isUnderAutoLimit({ autoLimit: null }, '1'), false);
  });

  await t.test('no settings: nothing refused, no lock, no usage query', async () => {
    const db = fakeDb();
    await check(db, '999999');
    assert.ok(!db.calls.some((s) => s.includes('pg_advisory_xact_lock')));
    assert.ok(!db.calls.some((s) => s.includes('AS count')));
  });

  await t.test('over the largest single withdrawal → MAX_SINGLE_EXCEEDED', async () => {
    const db = fakeDb({ site: { max_single: '1000' } });
    await assert.rejects(check(db, '1000.01'), (e) => e.code === 'WITHDRAW_MAX_SINGLE_EXCEEDED' && e.status === 403);
    await check(db, '1000');
  });

  await t.test('the daily count is reached → DAILY_COUNT_EXCEEDED, under the player lock', async () => {
    const db = fakeDb({ site: { daily_count: 3 }, used: { count: 3, total: '30' } });
    await assert.rejects(check(db, '1'), (e) => e.code === 'WITHDRAW_DAILY_COUNT_EXCEEDED');
    assert.ok(db.calls.some((s) => s.includes('pg_advisory_xact_lock')));
    await check(fakeDb({ site: { daily_count: 3 }, used: { count: 2, total: '20' } }), '1');
  });

  await t.test('the daily amount → DAILY_AMOUNT_EXCEEDED with what is left', async () => {
    const db = fakeDb({ player: { daily_amount: '1000', auto_allowed: true }, used: { count: 1, total: '800' } });
    await assert.rejects(check(db, '200.01'), (e) => e.code === 'WITHDRAW_DAILY_AMOUNT_EXCEEDED' && e.details.remaining === '200.00000000');
    await check(db, '200');
  });

  await t.test('validators: amounts and counts, blank clears, unknown keys refused', () => {
    const ok = v.site.body.safeParse({ autoLimit: '500', dailyCount: '5', dailyAmount: '', maxSingle: null });
    assert.equal(ok.success, true);
    assert.deepEqual(ok.data, { autoLimit: '500', dailyCount: 5, dailyAmount: null, maxSingle: null });
    assert.equal(v.site.body.safeParse({ autoLimit: '-1' }).success, false);
    assert.equal(v.site.body.safeParse({ autoLimit: '0' }).success, false);
    assert.equal(v.site.body.safeParse({ dailyCount: '1.5' }).success, false);
    assert.equal(v.site.body.safeParse({ other: 1 }).success, false);
    assert.equal(v.player.body.safeParse({ autoAllowed: false, note: 'VIP' }).success, true);
    assert.equal(v.player.params.safeParse({ userId: '12', currency: 'usdt' }).data.currency, 'USDT');
  });
});
