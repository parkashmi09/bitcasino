'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { LossBonusService, lastPeriod, bonusFor } = require('../lossBonus.service');

/**
 * Loss bonus without a database: the period window, the formula (percent, minimum, cap), the net
 * loss across currencies and casino + sports, the claim (off, nothing to claim, paid once), and
 * hash.game's Welcome Shield (the hours after the first deposit, claim expiry, max bet per bet).
 */

const SETTINGS = {
  loss_bonus_enabled: true,
  loss_bonus_welcome: false,
  loss_bonus_claim_hours: 0,
  loss_bonus_percent: '10',
  loss_bonus_period_days: 7,
  loss_bonus_min_loss: '100',
  loss_bonus_max: '500',
  loss_bonus_wager_multiplier: '1',
};

function service({ settings = SETTINGS, rows = [], over = [], firstDeposit = null, now = '2026-10-28T10:00:00Z', granted = [], claimedKeys = new Set(), candidates = [] } = {}) {
  return new LossBonusService({
    models: {
      PlayerBonus: {
        findOne: async ({ where }) => (claimedKeys.has(where.grant_key) ? { id: 1, status: 'active', activated_at: null } : null),
        findAll: async ({ where }) => where.grant_key.filter((k) => claimedKeys.has(k)).map((k) => ({ grant_key: k })),
      },
    },
    db: {
      sequelize: {
        query: async (sql) =>
          sql.includes('DISTINCT user_id') || sql.includes('HAVING MIN')
            ? candidates.map((u) => ({ user_id: String(u) }))
            : sql.includes("reason = 'DEPOSIT'") ? [{ at: firstDeposit }] : sql.includes('jsonb_each_text') ? over : rows,
        QueryTypes: { SELECT: 'SELECT' },
      },
    },
    logger: null,
    operatorSettings: { read: async (key, fallback) => (key in settings ? settings[key] : fallback) },
    // INR is the reward currency; 1 USDT = 88 INR.
    rewardMoney: {
      currency: async () => 'INR',
      convert: async (amount, from, to = 'INR') =>
        from === to ? amount : from === 'USDT' ? String(Number(amount) * 88) : to === 'USDT' ? String(Number(amount) / 88) : null,
    },
    playerBonuses: {
      grant: async (input) => {
        if (claimedKeys.has(input.grantKey)) return { paid: false, reason: 'ALREADY_PAID' };
        claimedKeys.add(input.grantKey);
        granted.push(input);
        return { paid: true, locked: true, activated: input.activated !== false, bonusId: '9', amount: input.amount, currency: input.currency };
      },
    },
    now: () => new Date(now), // 2026-10-28 is a Wednesday
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

const SHIELD = { ...SETTINGS, loss_bonus_welcome: true, loss_bonus_protection_hours: 24, loss_bonus_claim_hours: 48, loss_bonus_min_loss: '0', loss_bonus_max: '0' };

test('Welcome Shield: no deposit, then active for 24 hours, then claimable, then expired', async () => {
  const at = '2026-10-27T12:00:00Z';
  assert.equal((await service({ settings: SHIELD }).summary(1)).state, 'no_deposit');
  const active = service({ settings: SHIELD, firstDeposit: at, now: '2026-10-28T11:00:00Z', rows: [{ currency: 'INR', pnl: '-1000' }] });
  const s = await active.summary(1);
  assert.equal(s.state, 'active');
  assert.equal(s.bonus, '100.00000000'); // 10% of the 1,000 lost so far
  assert.equal(s.period.to, '2026-10-28T12:00:00.000Z');
  assert.equal((await refused(active.claim(1))).code, 'LOSS_BONUS_NOT_SETTLED');

  const due = service({ settings: SHIELD, firstDeposit: at, now: '2026-10-29T12:00:00Z', rows: [{ currency: 'INR', pnl: '-1000' }] });
  const d = await due.summary(1);
  assert.equal(d.state, 'claimable');
  assert.equal(d.claimExpiresAt, '2026-10-30T12:00:00.000Z');
  const granted = [];
  const paid = service({ settings: SHIELD, firstDeposit: at, now: '2026-10-29T12:00:00Z', rows: [{ currency: 'INR', pnl: '-1000' }], granted });
  await paid.claim(1);
  assert.equal(granted[0].grantKey, 'loss-bonus:1:welcome');
  assert.equal((await refused(paid.claim(1))).code, 'LOSS_BONUS_ALREADY_CLAIMED');

  const late = service({ settings: SHIELD, firstDeposit: at, now: '2026-10-30T12:00:01Z', rows: [{ currency: 'INR', pnl: '-1000' }] });
  assert.equal((await late.summary(1)).state, 'expired');
  assert.equal((await refused(late.claim(1))).code, 'LOSS_BONUS_EXPIRED');
});

test('max bet per bet: an over-limit stake is taken out of the loss', async () => {
  // Lost 1,500 INR in all, 1,000 of it on one bet over the 500 limit -> 500 counts.
  const s = service({ settings: { ...SHIELD, loss_bonus_max_bet: '500' }, firstDeposit: '2026-10-27T12:00:00Z', rows: [{ currency: 'INR', pnl: '-1500' }], over: [{ currency: 'INR', pnl: '-1000' }] });
  assert.equal((await s.summary(1)).netLoss, '500.00000000');
});

// ── 2026-11-24: auto credit, requires a new deposit, stake share (Limits and policy → Loss bonus) ──

const DAILY_3 = { ...SETTINGS, loss_bonus_percent: '3', loss_bonus_period_days: 1, loss_bonus_min_loss: '0', loss_bonus_max: '0' };

test('new switches default off: a claim grants as before (rollover, usable at once)', async () => {
  const granted = [];
  const svc = service({ settings: DAILY_3, rows: [{ currency: 'INR', pnl: '-1000' }], granted });
  const terms = await svc.terms();
  assert.equal(terms.autoCredit, false);
  assert.equal(terms.requiresDeposit, false);
  assert.equal(terms.stakeSharePercent, 0);
  const out = await svc.claim(1);
  assert.equal(out.amount, '30.00000000');
  assert.equal(granted[0].activated, true);
  assert.equal(granted[0].unlockMode, undefined);
  assert.equal(out.waitingForDeposit, false);
});

test('stake share 10% + requires deposit: the grant waits and pays 10% of each bet', async () => {
  const granted = [];
  const settings = { ...DAILY_3, loss_bonus_stake_share_percent: '10', loss_bonus_requires_deposit: true };
  const svc = service({ settings, rows: [{ currency: 'INR', pnl: '-1000' }], granted });
  const out = await svc.claim(1);
  assert.equal(granted[0].unlockMode, 'stake_share');
  assert.equal(granted[0].unlockRate, '0.1');
  assert.equal(granted[0].activated, false);
  assert.match(granted[0].description, /10% of each bet, usable after your next deposit/);
  assert.equal(out.waitingForDeposit, true);
  const summary = await svc.summary(1);
  assert.equal(summary.state, 'claimed');
  assert.equal(summary.waitingForDeposit, true);
});

test('auto credit off: the job grants nothing', async () => {
  const granted = [];
  const svc = service({ settings: DAILY_3, rows: [{ currency: 'INR', pnl: '-1000' }], granted, candidates: [1, 2] });
  assert.deepEqual(await svc.autoGrantDue(), { checked: 0, granted: 0 });
  assert.equal(granted.length, 0);
});

test('auto credit on: yesterday\'s losers are granted once; winners and already-granted are skipped', async () => {
  const granted = [];
  const claimedKeys = new Set(['loss-bonus:3:2026-10-27:1d']);
  const settings = { ...DAILY_3, loss_bonus_auto_credit: true };
  const svc = service({ settings, rows: [{ currency: 'INR', pnl: '-1000' }], granted, claimedKeys, candidates: [1, 3] });
  assert.deepEqual(await svc.autoGrantDue(), { checked: 1, granted: 1 });
  assert.equal(granted[0].grantKey, 'loss-bonus:1:2026-10-27:1d');
  assert.deepEqual(await svc.autoGrantDue(), { checked: 0, granted: 0 }, 'second run: nothing left');

  const winners = service({ settings, rows: [{ currency: 'INR', pnl: '500' }], granted: [], candidates: [7] });
  assert.deepEqual(await winners.autoGrantDue(), { checked: 1, granted: 0 });
});

test('auto credit, Welcome Shield: granted after the protection hours end', async () => {
  const granted = [];
  const settings = { ...DAILY_3, loss_bonus_welcome: true, loss_bonus_protection_hours: 24, loss_bonus_auto_credit: true };
  const svc = service({ settings, rows: [{ currency: 'INR', pnl: '-1000' }], granted, candidates: [4], firstDeposit: '2026-10-27T08:00:00Z' });
  assert.deepEqual(await svc.autoGrantDue(), { checked: 1, granted: 1 });
  assert.equal(granted[0].grantKey, 'loss-bonus:4:welcome');
});
