'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { FirstDepositBonusService } = require('../firstDepositBonus.service');

/**
 * Deposit bonus 24h rule (user, 2026-11-24 — Limits and policy → Deposit bonus), without a
 * database: deposit → bonus → (withdraw) → deposit again within the hours gets nothing; after them
 * it does; "count from the first deposit" pays only deposits within the hours of the first one.
 * Every deposit also activates bonuses waiting for one.
 */

const HOUR = 3_600_000;
const ROW = { percent: '100', minDeposit: '10', maxBonus: '0' };

function service({ settings = {}, mode = 'monthly', grants = [], firstDepositAt = null, now }) {
  const activations = [];
  const paid = [];
  const svc = new FirstDepositBonusService({
    models: {
      PlayerBonus: {
        count: async () => grants.length,
        findOne: async ({ order }) => (order ? [...grants].sort((a, b) => b.granted_at - a.granted_at)[0] ?? null : null),
      },
      CreditsLedger: {
        findOne: async ({ where }) => (where.id === 77 ? { created_at: new Date(now.getTime() - 1000) } : null),
        min: async () => firstDepositAt,
      },
    },
    logger: null,
    walletService: {},
    affiliate: { onRefereeDeposit: async () => {} },
    spinWheelBonus: { quote: async () => ({ ok: false, reason: 'NONE' }) },
    playerBonuses: {
      lockOn: async () => true,
      grant: async (input) => {
        paid.push(input);
        grants.push({ granted_at: now });
        return { paid: true, locked: true, bonusId: String(paid.length) };
      },
      activateOnDeposit: async (userId, at) => {
        activations.push({ userId, at });
        return [];
      },
    },
    welcomeBonusSettings: {
      firstDeposit: async () => ({
        enabled: true,
        tiers: [ROW],
        wagerMultiplier: 1,
        expiryDays: 30,
        program: { mode, unlockMode: 'rollover', unlockRate: '0.01', schedule: [ROW, ROW, ROW, ROW] },
      }),
    },
    rewardMoney: {
      currency: async () => 'USDT',
      toReward: async (amount) => ({ currency: 'USDT', amount }),
      toUsd: async (amount) => amount,
    },
    operatorSettings: { read: async (key, fallback) => (key in settings ? settings[key] : fallback) },
    now: () => now,
  });
  return { svc, paid, activations };
}

const deposit = { userId: 9, currency: 'USDT', amount: '50', ledgerId: 77, source: 'CRYPTO_DEPOSIT', refId: 'd' };
const T0 = new Date('2026-11-24T10:00:00Z');

test('off (default): a second deposit straight after the first bonus gets the next one', async () => {
  const grants = [{ granted_at: T0 }];
  const { svc, paid } = service({ grants, now: new Date(T0.getTime() + HOUR) });
  const out = await svc.onDepositCredited(deposit);
  assert.equal(out.paid, true);
  assert.equal(paid.length, 1);
});

test('24h from the last bonus: deposit → bonus → withdraw → deposit within 24h gets nothing', async () => {
  const grants = [{ granted_at: T0 }];
  const { svc, paid } = service({ settings: { deposit_bonus_cooldown_hours: 24 }, grants, now: new Date(T0.getTime() + 5 * HOUR) });
  const out = await svc.onDepositCredited(deposit);
  assert.equal(out.paid, false);
  assert.equal(out.reason, 'COOLDOWN');
  assert.equal(out.until, '2026-11-25T10:00:00.000Z');
  assert.equal(paid.length, 0);

  const overview = await svc.overview({ userId: 9 });
  assert.equal(overview.eligible, false);
  assert.equal(overview.cooldown.reason, 'COOLDOWN');
});

test('24h from the last bonus: after 24h the next deposit gets its bonus', async () => {
  const grants = [{ granted_at: T0 }];
  const { svc } = service({ settings: { deposit_bonus_cooldown_hours: 24 }, grants, now: new Date(T0.getTime() + 25 * HOUR) });
  assert.equal((await svc.onDepositCredited(deposit)).paid, true);
});

test('first deposit ever is never blocked by the 24h rule', async () => {
  const { svc } = service({ settings: { deposit_bonus_cooldown_hours: 24 }, mode: 'first', now: T0 });
  svc.models.CreditsLedger.findOne = async () => null; // no earlier deposit, nothing paid yet
  svc.models.FiatDeposits = { findOne: async () => null };
  svc.models.PlayerBonus.findOne = async () => null;
  const out = await svc.onDepositCredited(deposit);
  assert.equal(out.paid, true);
});

test('count from the first deposit: within the hours paid, after them WINDOW_CLOSED', async () => {
  const settings = { deposit_bonus_cooldown_hours: 24, deposit_bonus_cooldown_from_first: true };
  const inside = service({ settings, grants: [{ granted_at: T0 }], firstDepositAt: T0, now: new Date(T0.getTime() + 2 * HOUR) });
  assert.equal((await inside.svc.onDepositCredited(deposit)).paid, true);

  const after = service({ settings, grants: [{ granted_at: T0 }], firstDepositAt: T0, now: new Date(T0.getTime() + 30 * HOUR) });
  const out = await after.svc.onDepositCredited(deposit);
  assert.equal(out.paid, false);
  assert.equal(out.reason, 'WINDOW_CLOSED');
});

test('every deposit activates waiting bonuses, at the deposit\'s ledger time — even with the bonus blocked', async () => {
  const now = new Date(T0.getTime() + HOUR);
  const { svc, activations } = service({ settings: { deposit_bonus_cooldown_hours: 24 }, grants: [{ granted_at: T0 }], now });
  await svc.onDepositCredited(deposit);
  assert.equal(activations.length, 1);
  assert.equal(activations[0].at.getTime(), now.getTime() - 1000);
});
