'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { LossBonusService, lastPeriod, bonusFor } = require('../lossBonus.service');

/**
 * Loss bonus without a database: the period window, the formula (percent, minimum, cap), the net
 * loss across currencies and casino + sports, and the claim (off, nothing to claim, paid once).
 */

const SETTINGS = {
  loss_bonus_enabled: true,
  loss_bonus_percent: '10',
  loss_bonus_period_days: 7,
  loss_bonus_min_loss: '100',
  loss_bonus_max: '500',
  loss_bonus_wager_multiplier: '1',
};

function service({ settings = SETTINGS, rows = [], granted = [], claimedKeys = new Set() } = {}) {
  return new LossBonusService({
    models: { PlayerBonus: { findOne: async ({ where }) => (claimedKeys.has(where.grant_key) ? { id: 1 } : null) } },
    db: { sequelize: { query: async () => rows, QueryTypes: { SELECT: 'SELECT' } } },
    logger: null,
    operatorSettings: { read: async (key, fallback) => (key in settings ? settings[key] : fallback) },
    // INR is the reward currency; 1 USDT = 88 INR.
    rewardMoney: {
      currency: async () => 'INR',
      convert: async (amount, from) => (from === 'USDT' ? String(Number(amount) * 88) : from === 'INR' ? amount : null),
    },
    playerBonuses: {
      grant: async (input) => {
        if (claimedKeys.has(input.grantKey)) return { paid: false, reason: 'ALREADY_PAID' };
        claimedKeys.add(input.grantKey);
        granted.push(input);
        return { paid: true, locked: true, bonusId: '9', amount: input.amount, currency: input.currency };
      },
    },
    now: () => new Date('2026-10-28T10:00:00Z'), // a Wednesday
  });
}

const refused = (p) => p.then(() => null, (e) => e);

test('last period: Monday to Monday for 7 days, yesterday for 1 day', () => {
  const now = new Date('2026-10-28T10:00:00Z');
  const week = lastPeriod(now, 7);
  assert.equal(week.from.toISOString(), '2026-10-19T00:00:00.000Z');
  assert.equal(week.to.toISOString(), '2026-10-26T00:00:00.000Z');
  const day = lastPeriod(now, 1);
  assert.equal(day.from.toISOString(), '2026-10-27T00:00:00.000Z');
  assert.equal(day.to.toISOString(), '2026-10-28T00:00:00.000Z');
});

test('formula: percent of the loss, nothing below the minimum, capped at the maximum', () => {
  const terms = { percent: '10.00000000', minLoss: '100.00000000', maxBonus: '500.00000000' };
  assert.equal(bonusFor('2000.00000000', terms), '200.00000000');
  assert.equal(bonusFor('99.00000000', terms), '0.00000000');
  assert.equal(bonusFor('9000.00000000', terms), '500.00000000');
  assert.equal(bonusFor('2000.00000000', { ...terms, maxBonus: '0.00000000' }), '200.00000000');
});

test('net loss adds casino and sports and converts USDT; a net win is no loss', async () => {
  const lost = service({ rows: [{ currency: 'INR', pnl: '-1500' }, { currency: 'USDT', pnl: '-10' }, { currency: 'INR', pnl: '300' }] });
  assert.deepEqual(await lost.netLoss(1, new Date(0), new Date()), { currency: 'INR', netLoss: '2080.00000000' });
  const won = service({ rows: [{ currency: 'INR', pnl: '500' }] });
  assert.equal((await won.netLoss(1, new Date(0), new Date())).netLoss, '0.00000000');
});

test('summary shows the bonus and whether it is claimable', async () => {
  const s = await service({ rows: [{ currency: 'INR', pnl: '-2000' }] }).summary(1);
  assert.equal(s.enabled, true);
  assert.equal(s.netLoss, '2000.00000000');
  assert.equal(s.bonus, '200.00000000');
  assert.equal(s.claimable, true);
  assert.equal(s.period.from, '2026-10-19T00:00:00.000Z');
});

test('claim: paid once with the admin multiplier; a second claim is refused', async () => {
  const granted = [];
  const svc = service({ rows: [{ currency: 'INR', pnl: '-2000' }], granted });
  const paid = await svc.claim(1);
  assert.equal(paid.paid, true);
  assert.equal(granted[0].amount, '200.00000000');
  assert.equal(granted[0].source, 'loss_bonus');
  assert.equal(granted[0].wagerMultiplier, 1);
  assert.equal(granted[0].grantKey, 'loss-bonus:1:2026-10-19:7d');
  assert.equal((await refused(svc.claim(1))).code, 'LOSS_BONUS_ALREADY_CLAIMED');
  assert.equal((await svc.summary(1)).claimed, true);
});

test('claim refused when the switch is off or there is nothing to claim', async () => {
  const off = service({ settings: { ...SETTINGS, loss_bonus_enabled: false } });
  assert.equal((await refused(off.claim(1))).code, 'LOSS_BONUS_DISABLED');
  const small = service({ rows: [{ currency: 'INR', pnl: '-50' }] });
  assert.equal((await refused(small.claim(1))).code, 'LOSS_BONUS_NOTHING_TO_CLAIM');
});
