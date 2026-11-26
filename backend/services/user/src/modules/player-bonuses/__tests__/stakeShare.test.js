'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Op } = require('sequelize');
const { money } = require('@ibitplay/common');

const { PlayerBonusService } = require('../playerBonus.service');

/**
 * Stake share and "waits for the next deposit" (user, 2026-11-24 — the loss bonus), without a
 * database: an in-memory player_bonuses / player_bonus_wagers / cash wallet. Walks the plan's
 * balance table (docs/plans/2026-11-24-deposit-and-loss-bonus-rules.md): 30 bonus at 10% per bet,
 * waiting for a deposit, then 100 / 100 / 200 bets, a refunded bet, and withdrawals.
 */

const n = (v) => Number(money.fromStored(String(v)));

function matches(row, where = {}) {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond === null) return v === null || v === undefined;
    if (Array.isArray(cond)) return cond.map(String).includes(String(v));
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if (Op.ne in cond) return cond[Op.ne] === null ? v !== null && v !== undefined : String(v) !== String(cond[Op.ne]);
      if (Op.lte in cond) return v != null && new Date(v) <= new Date(cond[Op.lte]);
      return false;
    }
    return String(v) === String(cond);
  });
}

function table() {
  const rows = [];
  let seq = 0;
  return {
    rows,
    insert(row) {
      seq += 1;
      const r = { id: seq, claimed_amount: '0', ...row };
      rows.push(r);
      return r;
    },
    model: {
      findOne: async ({ where }) => {
        const r = rows.find((x) => matches(x, where));
        return r ? { ...r } : null;
      },
      findAll: async ({ where } = {}) => rows.filter((x) => matches(x, where)).sort((a, b) => a.id - b.id).map((r) => ({ ...r })),
      findByPk: async (id) => {
        const r = rows.find((x) => String(x.id) === String(id));
        return r ? { ...r } : null;
      },
      create: async (values) => ({ ...table.last, ...values }),
      update: async (values, { where }) => {
        const hit = rows.filter((x) => matches(x, where));
        for (const r of hit) Object.assign(r, values);
        return [hit.length];
      },
    },
  };
}

function harness({ cash = '0', lock = true } = {}) {
  const bonuses = table();
  const allocs = table();
  allocs.model.create = async (values) => allocs.insert({ reversed_at: null, reversed_amount: '0', ...values });
  const wallet = {
    cash: n(cash),
    keys: new Set(),
    credits: [],
    debits: [],
    async credit({ amount, idempotencyKey }) {
      if (this.keys.has(idempotencyKey)) return { replayed: true };
      this.keys.add(idempotencyKey);
      this.cash += n(amount);
      this.credits.push({ amount: n(amount), key: idempotencyKey });
      return { ledgerId: this.credits.length };
    },
    async debit({ amount, idempotencyKey }) {
      if (this.keys.has(idempotencyKey)) return { replayed: true };
      if (this.cash < n(amount)) {
        const error = new Error('insufficient');
        error.code = 'WALLET_INSUFFICIENT_FUNDS';
        throw error;
      }
      this.keys.add(idempotencyKey);
      this.cash -= n(amount);
      this.debits.push({ amount: n(amount), key: idempotencyKey });
      return { ledgerId: -this.debits.length };
    },
  };
  const t = { LOCK: { UPDATE: 'UPDATE' } };
  const svc = new PlayerBonusService({
    models: { PlayerBonus: bonuses.model, PlayerBonusWager: allocs.model, CreditsLedger: { findOne: async () => null } },
    db: {
      transaction: async (fn) => fn(t),
      sequelize: {
        transaction: async (_opts, fn) => fn(t),
        query: async (_sql, { replacements }) => [{ id: bonuses.insert({ ...replacements }).id }],
        QueryTypes: { SELECT: 'SELECT' },
      },
    },
    logger: null,
    walletService: wallet,
    rewardMoney: { currency: async () => 'USDT', convert: async (a) => a },
    bonusWageringLock: async () => lock,
    // The game ratio off, so a stake counts in full (the ratio is covered by the gradual tests).
    operatorSettings: { read: async (key, fallback) => (key === 'bonus_contribution_all' ? false : fallback) },
  });
  svc.expireDue = async () => 0;
  return { svc, wallet, bonuses, allocs };
}

const LOSS = { userId: 5, source: 'loss_bonus', grantKey: 'loss-bonus:5:2026-11-24:1d', currency: 'USDT', amount: '30', unlockMode: 'stake_share', unlockRate: '0.1' };
const bet = (svc, ref, amount) => svc.onStake({ userId: 5, amount, currency: 'USDT', source: 'casino', ref });

test('the plan table: 30 bonus at 10%, waits for a deposit, then 100 / 100 / 200 bets', async () => {
  const { svc, wallet, bonuses } = harness();
  const g = await svc.grant({ ...LOSS, activated: false });
  assert.equal(g.paid, true);
  assert.equal(g.locked, true);
  assert.equal(g.unlockMode, 'stake_share');
  assert.equal(g.activated, false);
  assert.equal(bonuses.rows[0].activated_at, null);
  assert.equal(wallet.cash, 0, 'nothing to cash at grant');

  // Played before depositing (cash from elsewhere): the waiting bonus is not touched.
  wallet.cash = 100;
  wallet.cash -= 100;
  assert.deepEqual((await bet(svc, 'b0', '100')).applied, []);
  assert.equal(wallet.cash, 0);

  // Deposit 500, credited after the grant → usable.
  const later = new Date(Date.now() + 1000);
  wallet.cash += 500;
  assert.deepEqual(await svc.activateOnDeposit(5, later), [String(g.bonusId)]);

  wallet.cash -= 100;
  await bet(svc, 'b1', '100');
  assert.equal(wallet.cash, 410);
  wallet.cash -= 100;
  await bet(svc, 'b2', '100');
  assert.equal(wallet.cash, 320);
  wallet.cash -= 200;
  const last = await bet(svc, 'b3', '200');
  assert.equal(wallet.cash, 130, '10% of 200 = 20, capped at the 10 left');
  assert.equal(n(last.applied[0].amount), 10);
  assert.equal(bonuses.rows[0].status, 'completed');
  assert.equal(n(bonuses.rows[0].claimed_amount), 30);
  assert.deepEqual(wallet.credits.map((c) => c.amount), [10, 10, 10], 'three bet shares, no extra release credit');

  const more = await bet(svc, 'b4', '100');
  assert.deepEqual(more.applied, []);
});

test('the same stake twice pays its share once', async () => {
  const { svc, wallet } = harness();
  await svc.grant(LOSS);
  await bet(svc, 'x', '100');
  await bet(svc, 'x', '100');
  assert.equal(wallet.cash, 10);
});

test('a deposit made BEFORE the grant does not activate it', async () => {
  const { svc, bonuses } = harness();
  await svc.grant({ ...LOSS, activated: false });
  assert.deepEqual(await svc.activateOnDeposit(5, new Date(Date.now() - 60_000)), []);
  assert.equal(bonuses.rows[0].activated_at, null);
});

test('a refunded bet takes its share back from cash and returns it to the bonus', async () => {
  const { svc, wallet, bonuses } = harness();
  await svc.grant(LOSS);
  await bet(svc, 'r1', '100');
  assert.equal(wallet.cash, 10);
  const out = await svc.onReverse({ userId: 5, source: 'casino', ref: 'r1', full: true });
  assert.equal(out.reversed.length, 1);
  assert.equal(wallet.cash, 0);
  assert.equal(n(bonuses.rows[0].claimed_amount), 0);
  assert.equal(n(bonuses.rows[0].wagered), 0);
  // A retry takes nothing twice.
  await svc.onReverse({ userId: 5, source: 'casino', ref: 'r1', full: true });
  assert.equal(wallet.cash, 0);
  assert.equal(wallet.debits.length, 1);
});

test('a refund of the bet that used the bonus up makes it active again', async () => {
  const { svc, wallet, bonuses } = harness();
  await svc.grant({ ...LOSS, amount: '10' });
  await bet(svc, 'u1', '100');
  assert.equal(bonuses.rows[0].status, 'completed');
  await svc.onReverse({ userId: 5, source: 'casino', ref: 'u1', full: true });
  assert.equal(bonuses.rows[0].status, 'active');
  assert.equal(bonuses.rows[0].end_reason, null);
  assert.equal(wallet.cash, 0);
});

test('refund when the share was already spent: refund not failed, bonus left as used', async () => {
  const { svc, wallet, bonuses } = harness();
  await svc.grant(LOSS);
  await bet(svc, 's1', '100');
  wallet.cash = 0; // spent
  const out = await svc.onReverse({ userId: 5, source: 'casino', ref: 's1', full: true });
  assert.deepEqual(out.reversed, []);
  assert.equal(n(bonuses.rows[0].claimed_amount), 10);
});

test('partial refund: half the stake back → half the share back', async () => {
  const { svc, wallet } = harness();
  await svc.grant(LOSS);
  await bet(svc, 'p1', '100');
  await svc.onReverse({ userId: 5, source: 'casino', ref: 'p1', reversedAmount: '50', stake: '100' });
  assert.equal(wallet.cash, 5);
});

test('withdrawals: a stake-share bonus does not block, nor is it forfeited', async () => {
  const { svc, bonuses } = harness();
  await svc.grant(LOSS);
  assert.deepEqual(await svc.beforeWithdrawal(5, {}), { forfeited: [] });
  assert.deepEqual(await svc.openWagering(5), []);
  assert.equal(bonuses.rows[0].status, 'active');
});

test('a waiting rollover bonus with no wagering goes to cash on the deposit', async () => {
  const { svc, wallet, bonuses } = harness();
  const g = await svc.grant({ ...LOSS, unlockMode: 'rollover', unlockRate: null, wagerMultiplier: 0, activated: false });
  assert.equal(g.locked, true);
  assert.equal(wallet.cash, 0);
  await svc.activateOnDeposit(5, new Date(Date.now() + 1000));
  assert.equal(wallet.cash, 30);
  assert.equal(bonuses.rows[0].status, 'completed');
});

test('owner lock OFF: straight to cash as before, even for stake share', async () => {
  const { svc, wallet } = harness({ lock: false });
  const g = await svc.grant(LOSS);
  assert.equal(g.locked, false);
  assert.equal(wallet.cash, 30);
});
