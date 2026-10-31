'use strict';

const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');

const { WalletService } = require('../../wallet/wallet.service');
const { WagerActivityService } = require('../../wager/wagerActivity.service');
const { PlayerBonusService } = require('../../player-bonuses/playerBonus.service');
const { ProfileTurnoverService, progressOf } = require('../profileTurnover.service');

/**
 * `GET /user/profile/turnover`: total wager (counted, un-reversed stakes), total deposit
 * (ledger DEPOSIT rows + pre-ledger approved fiat), and the requirement the platform really
 * enforces — active bonuses' required wager, with what has been counted toward them — all in
 * one display currency. Real tables on the test database; rates stubbed (1 USDT = 88 INR).
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const INR_PER_USDT = '88';

let nextUid = 975_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('progressOf: floored to two places, null with nothing required', () => {
  assert.equal(progressOf('0', '0'), null);
  assert.equal(progressOf('10', '0.00000000'), null);
  assert.equal(progressOf('0', '60'), 0);
  assert.equal(progressOf('20', '60'), 33.33);
  assert.equal(progressOf('59.9999', '60'), 99.99);
  assert.equal(progressOf('80', '60'), 100);
});

test('profile turnover', async (t) => {
  const logger = createLogger({ name: 'profile-turnover-test', level: 'silent' });

  let connection;
  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: TEST_DB,
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
        DB_SCHEMA: 'public',
      },
      logger,
      service: 'user-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models } = connection;
  if (!models.PlayerBonus || !models.WagerActivity) {
    t.skip('PlayerBonus / WagerActivity models not loaded');
    await connection.close();
    return;
  }
  configureAgentPlayers({ loadOwnerStaffId: async () => null, loadStaff: async () => null });

  const created = [];
  const cleanup = async (uid) => {
    await models.PlayerBonusWager?.destroy({ where: { user_id: uid } }).catch(() => {});
    await models.PlayerBonus.destroy({ where: { user_id: uid } });
    await models.WagerActivity.destroy({ where: { user_id: uid } });
    await models.UserwagerHistory?.destroy({ where: { uid } }).catch(() => {});
    await models.Userwager.destroy({ where: { uid } });
    await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
    await models.WalletHistory?.destroy({ where: { uid } }).catch(() => {});
    await models.FiatDeposits.destroy({ where: { user_id: uid } });
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
  };
  t.after(async () => {
    for (const uid of created) await cleanup(uid).catch(() => {});
    resetAgentPlayers();
    await connection.close();
  });

  const seed = async () => {
    const uid = newUid();
    await cleanup(uid);
    await models.Users.create({ id: uid, name: `pt-${uid}`, password: 'x', status: 'active', referalcode: `PT${uid}` });
    await models.Credits.create({ uid });
    created.push(uid);
    return uid;
  };

  /** USDT/USD 1:1, INR at 88 per USDT; PKR has no rate. */
  const usdOf = (amount, code) => {
    if (code === 'INR') return money.toDecimalString(money.divide(amount, INR_PER_USDT));
    if (code === 'USDT' || code === 'USD') return money.toDecimalString(money.toMinor(amount));
    return null;
  };
  const rewardMoney = {
    currency: async () => 'USDT',
    toUsd: async (amount, from) => usdOf(amount, String(from).toUpperCase()),
    toReward: async (amount, from) => ({ currency: 'USDT', amount: usdOf(amount, String(from).toUpperCase()) }),
    fromUsd: async (amount) => ({ currency: 'USDT', amount, usd: amount }),
    convert: async (amount, from, to) => {
      const f = String(from).toUpperCase();
      const tc = String(to).toUpperCase();
      if (f === tc) return money.fromStored(String(amount));
      const usd = usdOf(amount, f);
      if (usd == null) return null;
      if (tc === 'INR') return money.toDecimalString(money.multiply(usd, INR_PER_USDT));
      if (tc === 'USDT' || tc === 'USD') return usd;
      return null;
    },
  };

  const deps = {
    models, db: connection, logger, rewardMoney,
    config: { SERVICE_NAME: 'user-service' },
    bonusWageringLock: async () => true,
  };
  const bonuses = new PlayerBonusService(deps);
  deps.playerBonuses = bonuses;
  const wager = new WagerActivityService({
    ...deps,
    rates: { convert: async ({ from, amount }) => ({ usdValue: usdOf(amount, String(from).toUpperCase()) }) },
    vip: { onWager: async () => {} },
    affiliate: { onWager: async () => {} },
    rakeback: { accrue: async () => {} },
  });
  const turnover = new ProfileTurnoverService(deps);

  const deposit = (uid, amount, currency, tag = crypto.randomBytes(4).toString('hex')) =>
    new WalletService(deps).credit(
      { userId: uid, currency, amount, reason: 'DEPOSIT', idempotencyKey: `pt-dep:${uid}:${tag}`, refType: 'CRYPTO_DEPOSIT', refId: tag },
      { sourceService: 'user-service' }
    );
  const stake = (uid, amount, currency, ref = crypto.randomBytes(6).toString('hex')) =>
    wager.record({ userId: uid, amount, currency, source: 'test', ref }).then(() => ref);

  await t.test('a new player: zeros, no requirement, progress null', async () => {
    const uid = await seed();
    const r = await turnover.forPlayer(uid, { currency: 'INR' });
    assert.equal(r.currency, 'INR');
    assert.equal(r.totalWager, '0.00000000');
    assert.equal(r.totalDeposit, '0.00000000');
    assert.equal(r.required, '0.00000000');
    assert.equal(r.remaining, '0.00000000');
    assert.equal(r.progress, null);
    assert.equal(r.activeBonuses, 0);
    assert.equal(r.bets, 0);
    assert.equal(r.deposits, 0);
  });

  await t.test('deposits and stakes summed per currency, converted once into the display currency', async () => {
    const uid = await seed();
    await deposit(uid, '1000', 'INR');
    await deposit(uid, '500', 'INR');
    await deposit(uid, '10', 'USDT');
    await stake(uid, '300', 'INR');
    await stake(uid, '2', 'USDT');

    const inr = await turnover.forPlayer(uid, { currency: 'INR' });
    assert.equal(inr.totalDeposit, '2380.00000000', '1500 INR + 10 USDT × 88');
    assert.equal(inr.deposits, 3);
    assert.equal(inr.totalWager, '476.00000000', '300 INR + 2 USDT × 88');
    assert.equal(inr.bets, 2);
    assert.deepEqual(inr.byCurrency.deposit, [
      { currency: 'INR', amount: '1500.00000000', count: 2 },
      { currency: 'USDT', amount: '10.00000000', count: 1 },
    ]);
    assert.deepEqual(inr.unrated, []);

    // No currency asked: the reward currency.
    const usdt = await turnover.forPlayer(uid);
    assert.equal(usdt.currency, 'USDT');
    assert.equal(usdt.totalWager, money.toDecimalString(money.add(money.divide('300', INR_PER_USDT), money.toMinor('2'))));
  });

  await t.test('a reversed stake leaves the total; an unknown display currency falls back', async () => {
    const uid = await seed();
    const ref = await stake(uid, '880', 'INR');
    await stake(uid, '120', 'INR');
    await wager.reverse({ userId: uid, source: 'test', ref });

    const r = await turnover.forPlayer(uid, { currency: 'XYZ' });
    assert.equal(r.currency, 'USDT', 'no rate for XYZ → the reward currency');
    assert.equal(r.bets, 1);
    assert.equal(r.totalWager, money.toDecimalString(money.divide('120', INR_PER_USDT)));
  });

  await t.test('a currency with no rate is named, not counted', async () => {
    const uid = await seed();
    await deposit(uid, '1000', 'PKR');
    await deposit(uid, '100', 'INR');
    const r = await turnover.forPlayer(uid, { currency: 'INR' });
    assert.equal(r.totalDeposit, '100.00000000');
    assert.deepEqual(r.unrated, ['PKR']);
    assert.equal(r.byCurrency.deposit.find((d) => d.currency === 'PKR').amount, '1000.00000000');
  });

  await t.test('a pre-ledger approved fiat deposit counts once; a credited one is not double-counted', async () => {
    const uid = await seed();
    const legacy = await models.FiatDeposits.create({ user_id: uid, amount: '700', currency: 'INR', status: 'approved', transaction_id: `pt-${uid}-a` });
    const credited = await models.FiatDeposits.create({ user_id: uid, amount: '300', currency: 'INR', status: 'approved', transaction_id: `pt-${uid}-b` });
    await models.FiatDeposits.create({ user_id: uid, amount: '999', currency: 'INR', status: 'pending', transaction_id: `pt-${uid}-c` });
    await new WalletService(deps).credit(
      { userId: uid, currency: 'INR', amount: '300', reason: 'DEPOSIT', idempotencyKey: `fiat-deposit:${credited.deposit_id}`, refType: 'FIAT_DEPOSIT', refId: String(credited.deposit_id) },
      { sourceService: 'user-service' }
    );
    assert.ok(legacy.deposit_id);

    const r = await turnover.forPlayer(uid, { currency: 'INR' });
    assert.equal(r.totalDeposit, '1000.00000000', '700 (legacy) + 300 (ledger), the pending one excluded');
    assert.equal(r.deposits, 2);
  });

  await t.test('required = active bonuses only, in the display currency, with progress from their own wagering', async () => {
    const uid = await seed();
    await stake(uid, '5', 'USDT'); // before any bonus: total wager, but not toward it
    const grant = (amount, tag) =>
      bonuses.grant({ userId: uid, source: 'spin_wheel', grantKey: `pt:${uid}:${tag}`, ref: tag, amount, currency: 'USDT', wagerMultiplier: 5, expiryDays: 30 });
    await grant('12', 'a'); // requires 60 USDT
    await stake(uid, '20', 'USDT');

    const r = await turnover.forPlayer(uid, { currency: 'USDT' });
    assert.equal(r.activeBonuses, 1);
    assert.equal(r.required, '60.00000000');
    assert.equal(r.wagered, '20.00000000', 'the earlier 5 did not count toward it');
    assert.equal(r.remaining, '40.00000000');
    assert.equal(r.progress, 33.33);
    assert.equal(r.totalWager, '25.00000000');

    const inr = await turnover.forPlayer(uid, { currency: 'INR' });
    assert.equal(inr.required, '5280.00000000', '60 USDT × 88');
    assert.equal(inr.remaining, '3520.00000000');
    assert.equal(inr.progress, 33.33);

    // Met: released to cash, no longer a requirement.
    await stake(uid, '40', 'USDT');
    const done = await turnover.forPlayer(uid, { currency: 'USDT' });
    assert.equal(done.activeBonuses, 0);
    assert.equal(done.required, '0.00000000');
    assert.equal(done.progress, null);
    assert.equal(done.totalWager, '65.00000000');
  });
});
