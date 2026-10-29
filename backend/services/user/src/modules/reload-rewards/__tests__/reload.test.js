'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { windowFor } = require('../reload.service');

test('the daily reload measures yesterday (UTC) and is keyed by today', () => {
  const w = windowFor('DAILY_RELOAD', new Date('2026-10-29T13:00:00Z'));
  assert.equal(w.since.toISOString(), '2026-10-28T00:00:00.000Z');
  assert.equal(w.until.toISOString(), '2026-10-29T00:00:00.000Z');
  assert.equal(w.periodKey, '2026-10-29');
  assert.equal(w.open, true);
});

test('the pre-monthly measures the 1st to the 14th and opens on the 15th', () => {
  const before = windowFor('PRE_MONTHLY', new Date('2026-10-14T23:59:00Z'));
  assert.equal(before.open, false);
  assert.equal(before.since.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(before.until.toISOString(), '2026-10-15T00:00:00.000Z');
  const after = windowFor('PRE_MONTHLY', new Date('2026-10-29T13:00:00Z'));
  assert.equal(after.open, true);
  assert.equal(after.periodKey, '2026-10');
});

const { ReloadService } = require('../reload.service');

/** The service over in-memory rows; every coin is worth its own amount in USD. */
function service({ wagered = '1000', level = 5, minVipLevel = 0, failCredit = false } = {}) {
  const claims = [];
  const svc = new ReloadService({
    models: {
      ReloadProgram: {
        findAll: async () => [
          { key: 'DAILY_RELOAD', enabled: true, percent: '0.100', min_vip_level: minVipLevel, updated_at: new Date() },
          { key: 'PRE_MONTHLY', enabled: true, percent: '0.200', min_vip_level: minVipLevel, updated_at: new Date() },
        ],
      },
      ReloadClaim: {
        count: async ({ where }) => claims.filter((c) => c.program === where.program && c.period_key === where.period_key).length,
        create: async (row) => {
          if (claims.some((c) => c.program === row.program && c.period_key === row.period_key)) {
            throw Object.assign(new Error('dup'), { name: 'SequelizeUniqueConstraintError' });
          }
          const saved = { ...row, id: claims.length + 1 };
          claims.push(saved);
          return saved;
        },
        destroy: async ({ where }) => claims.splice(claims.findIndex((c) => c.id === where.id), 1),
        update: async () => {},
      },
    },
    db: { sequelize: { QueryTypes: { SELECT: 'SELECT' }, query: async () => [{ currency: 'USDT', reason: 'BET_STAKE', amount: `-${wagered}` }] } },
    logger: null,
    rewardMoney: { toUsd: async (a) => a, fromUsd: async (a) => ({ currency: 'USDT', amount: a }) },
    wallet: {
      credit: async () => {
        if (failCredit) throw new Error('wallet down');
        return { ledgerId: 9, newBalance: '1' };
      },
    },
    vip: { standing: async () => ({ level }) },
  });
  return { svc, claims };
}

test('a daily reload pays the rate on yesterday’s wager, once', async () => {
  const { svc } = service({ wagered: '1000' });
  const paid = await svc.claim(1, 'DAILY_RELOAD');
  assert.equal(paid.amount, '1.00000000'); // 0.1% of 1,000
  await assert.rejects(svc.claim(1, 'DAILY_RELOAD'), (e) => e.code === 'RELOAD_ALREADY_CLAIMED');
});

test('below the VIP gate the reward is refused', async () => {
  const { svc } = service({ level: 1, minVipLevel: 3 });
  await assert.rejects(svc.claim(1, 'DAILY_RELOAD'), (e) => e.code === 'RELOAD_VIP_REQUIRED');
});

test('nothing wagered, nothing to claim', async () => {
  const { svc } = service({ wagered: '0' });
  await assert.rejects(svc.claim(1, 'DAILY_RELOAD'), (e) => e.code === 'RELOAD_NOTHING_TO_CLAIM');
});

test('a failed credit frees the period so the player can claim again', async () => {
  const { svc, claims } = service({ failCredit: true });
  await assert.rejects(svc.claim(1, 'DAILY_RELOAD'), /wallet down/);
  assert.equal(claims.length, 0);
});
