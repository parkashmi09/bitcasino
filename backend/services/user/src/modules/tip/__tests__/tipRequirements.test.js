'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { TipService } = require('../tip.service');

// A tip is money out: it must pass the withdraw requirements (KYC / wagering / cap / daily limit)
// before any money moves, and the cap / daily check runs again under the lock in the transaction.
function service({ requirements }) {
  const calls = { transaction: 0 };
  const svc = new TipService({
    models: {
      Users: { findByPk: async (id) => ({ id, name: `u${id}`, status: 'active', is_locked: false, system_locked: false, withdraw_locked: false }) },
      Userconfig: { findOne: async () => null },
      Tip: { findOne: async () => null, count: async () => 0 },
    },
    db: {
      sequelize: { QueryTypes: { SELECT: 'SELECT' }, query: async () => [{ id: 2, name: 'friend', status: 'active', is_locked: false, system_locked: false }] },
      transaction: async () => {
        calls.transaction += 1;
        throw new Error('stop after the lock-stage checks');
      },
    },
    config: {},
    logger: null,
    tipLimits: { limits: async () => ({ maxPerTipUsd: '0', maxPerDayUsd: '0', minWageredUsd: '0' }) },
    rewardMoney: { toUsd: async (a) => a },
    withdrawRequirements: requirements,
  });
  return { svc, calls };
}

test('a tip refused by the withdraw requirements never opens a transaction', async () => {
  const daily = Object.assign(new Error('Daily withdrawal limit reached'), { code: 'WITHDRAW_DAILY_LIMIT' });
  const { svc, calls } = service({ requirements: { assertMet: async () => { throw daily; }, assertCapInTransaction: async () => {} } });
  await assert.rejects(svc.send({ userId: 1, toUsername: 'friend', currency: 'INR', amount: '500' }), (e) => e.code === 'WITHDRAW_DAILY_LIMIT');
  assert.equal(calls.transaction, 0);
});

test('KYC refusal uses the tip error; a passing tip checks cap/daily again inside the transaction', async () => {
  const kycBlocked = service({ requirements: { assertMet: async (_u, { kycError }) => { throw kycError('Pending'); }, assertCapInTransaction: async () => {} } });
  await assert.rejects(kycBlocked.svc.send({ userId: 1, toUsername: 'friend', currency: 'INR', amount: '500' }), (e) => e.code === 'TIP_KYC_REQUIRED');

  const seen = [];
  const ok = service({ requirements: { assertMet: async (u, a) => (seen.push(['met', u, a.amount, a.currency]), { cap: { enabled: false } }), assertCapInTransaction: async () => {} } });
  await assert.rejects(ok.svc.send({ userId: 1, toUsername: 'friend', currency: 'inr', amount: '500' }), /stop after/);
  assert.deepEqual(seen, [['met', 1, '500.00000000', 'INR']]);
  assert.equal(ok.calls.transaction, 1);
});
