'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { entitlements } = require('@ibitplay/common');
const { createWithdrawRequirements } = require('../withdrawRequirements');

/**
 * The owner's daily withdrawal limit (the document's `withdrawalDailyLimit`) in the one place every
 * rail checks it — `assertMet` before any forfeit, `assertCapInTransaction` under the player lock,
 * `assertDailyInTransaction` for P2P sells. No database: the usage reader and the lock are stubs.
 */

function harness({ daily, cap = { enabled: false }, used = '0' }) {
  entitlements.configureEntitlements({
    read: async () => ({ features: {}, flags: {}, version: 3, source: 'owner', withdrawalCap: cap, withdrawalDailyLimit: daily }),
  });
  const queries = [];
  const usage = { value: used, calls: [] };
  const deps = {
    models: { SiteFeature: { findByPk: async () => ({ variant: 'none' }) }, UserKyc: { findOne: async () => ({ status: 'Verified' }) } },
    db: { sequelize: { query: async (sql) => (queries.push(sql), []) } },
    config: { WITHDRAW_REQUIRE_KYC: true },
    logger: null,
    wagerService: { getTasks: async () => ({ tasks: [], multiplier: null }) },
    playerBonuses: { openWagering: async () => [] },
    rewardMoney: { toUsd: async (a) => a },
    capFigures: { figures: async () => ({ deposited: '0', withdrawn: '0', wagered: '0' }), currencies: async () => [] },
    dailyFigures: {
      used: async (userId, currency, opts) => (usage.calls.push({ userId, currency, transaction: opts?.transaction }), usage.value),
    },
  };
  return { requirements: createWithdrawRequirements(deps), queries, usage };
}

const refusal = (expect) => (e) => {
  assert.equal(e.code, 'WITHDRAW_DAILY_LIMIT');
  assert.equal(e.status, 403);
  for (const [k, v] of Object.entries(expect)) assert.equal(e.details[k], v, k);
  return true;
};

test.afterEach(() => entitlements.resetEntitlements());

test('under the limit passes; over it is refused with the figures and a readable message', async () => {
  const { requirements } = harness({ daily: { enabled: true, limits: { INR: '50000' } }, used: '38000' });
  const applied = await requirements.assertMet(1, { amount: '12000', currency: 'INR', kycError: () => new Error('kyc') });
  assert.equal(applied.daily.enabled, true);

  await assert.rejects(
    requirements.assertMet(1, { amount: '12000.01', currency: 'inr', kycError: () => new Error('kyc') }),
    (e) => {
      refusal({ currency: 'INR', limit: '50000.00000000', usedToday: '38000.00000000', remaining: '12000.00000000', attempted: '12000.01000000' })(e);
      assert.equal(e.message, 'Daily withdrawal limit is 50,000 INR; 12,000 INR left today.');
      return true;
    }
  );
});

test('limit reached: the message says so', async () => {
  const { requirements } = harness({ daily: { enabled: true, limits: { INR: '1000' } }, used: '1000' });
  await assert.rejects(requirements.assertMet(1, { amount: '1', currency: 'INR', kycError: () => null }), (e) => {
    assert.equal(e.message, 'Daily withdrawal limit of 1,000 INR reached. Try again in 24 hours.');
    return e.code === 'WITHDRAW_DAILY_LIMIT';
  });
});

test('off, or a currency without a row: no check, no usage read', async () => {
  const off = harness({ daily: { enabled: false, limits: { INR: '1' } }, used: '999999' });
  await off.requirements.assertMet(1, { amount: '500', currency: 'INR', kycError: () => null });
  assert.equal(off.usage.calls.length, 0);

  const other = harness({ daily: { enabled: true, limits: { INR: '1' } }, used: '999999' });
  await other.requirements.assertMet(1, { amount: '500', currency: 'USDT', kycError: () => null });
  assert.equal(other.usage.calls.length, 0);
});

test('in the rail\'s transaction: takes the player lock, then reads the usage on that transaction', async () => {
  const { requirements, queries, usage } = harness({ daily: { enabled: true, limits: { USDT: '100' } }, used: '60' });
  const applied = await requirements.assertMet(9, { amount: '40', currency: 'USDT', kycError: () => null });
  const transaction = { id: 'tx' };
  usage.value = '61'; // a request that committed in between
  await assert.rejects(requirements.assertCapInTransaction(9, { amount: '40', currency: 'USDT', transaction, applied }), refusal({ remaining: '39.00000000' }));
  assert.ok(queries.some((q) => q.includes('pg_advisory_xact_lock')));
  assert.equal(usage.calls.at(-1).transaction, transaction);
});

test('P2P sell: assertDailyInTransaction reads the owner settings itself', async () => {
  const { requirements, queries } = harness({ daily: { enabled: true, limits: { USDT: '100' } }, used: '90' });
  await requirements.assertDailyInTransaction(5, { amount: '10', currency: 'USDT', transaction: {} });
  await assert.rejects(requirements.assertDailyInTransaction(5, { amount: '10.5', currency: 'USDT', transaction: {} }), refusal({ attempted: '10.50000000' }));
  assert.ok(queries.some((q) => q.includes('pg_advisory_xact_lock')));
});

test('fails closed: an unreadable usage is 503, not a pass', async () => {
  const { requirements, usage } = harness({ daily: { enabled: true, limits: { INR: '100' } } });
  usage.value = Promise.reject(new Error('db down'));
  usage.value.catch(() => {});
  await assert.rejects(requirements.assertMet(1, { amount: '1', currency: 'INR', kycError: () => null }), (e) => e.code === 'WITHDRAW_CAP_CHECK_FAILED' && e.status === 503);
});

test('evaluate: one block for ?currency=, one per limited currency otherwise', async () => {
  const { requirements } = harness({ daily: { enabled: true, limits: { INR: '1000', USDT: '50' } }, used: '1000' });
  const one = await requirements.evaluate(1, { currency: 'INR' });
  assert.deepEqual(one.dailyLimit, { enabled: true, currency: 'INR', limit: '1000.00000000', used: '1000.00000000', remaining: '0.00000000' });
  assert.ok(one.missing.includes('daily'));
  const all = await requirements.evaluate(1);
  assert.deepEqual(all.dailyLimit.currencies.map((c) => c.currency), ['INR', 'USDT']);
});
