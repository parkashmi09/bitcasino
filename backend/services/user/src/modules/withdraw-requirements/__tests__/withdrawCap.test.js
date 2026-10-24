'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, errorHandler, requestContext, money, entitlements, withdrawalCap } = require('@ibitplay/common');
const { hashPassword, configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');
const { EVENTS } = require('@ibitplay/socket');

const { FiatWithdrawService } = require('../../fiat-withdraw/fiatWithdraw.service');
const { CryptoWithdrawService } = require('../../crypto-withdraw/cryptoWithdraw.service');
const { PaymentOrdersService } = require('../../payment-orders/paymentOrders.service');
const cryptoSockets = require('../../crypto-withdraw/sockets');
const { createWithdrawRequirements } = require('../withdrawRequirements');

/**
 * The deposit cap — the third switch of `withdrawal_requirements` (the owner document's
 * `withdrawalCap`, read through the entitlements helper exactly as in production).
 *
 *   cap = deposited × multiplier + min(wagered, deposited × wager multiplier), per currency
 *
 * addaplay's worked examples, pending vs rejected withdrawals, the wager bonus off, per-currency
 * separation, failing closed, the combinations with KYC and wagering, every rail (fiat, crypto
 * service + socket, payment-order payouts), two requests at once, the read route and agent
 * players. The figures come from the real test database tables.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const PASSWORD = 'withdraw-cap-pass';
const ON = { enabled: true, depositMultiplier: 3, wagerBonus: true, wagerMultiplier: 5 };

let nextId = 948_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('the rule: addaplay worked examples (pure)', () => {
  const at = (wagered, settings = ON) =>
    withdrawalCap.computeCap({ currency: 'usdt', deposited: '1000', withdrawn: '0', wagered, settings });
  assert.equal(at('1000').cap, '4000.00000000');
  assert.equal(at('1000').unlockedByWager, '1000.00000000');
  assert.equal(at('1000').wagerToRaise, '4000.00000000');
  assert.equal(at('5000').cap, '8000.00000000');
  assert.equal(at('9000').cap, '8000.00000000');
  assert.equal(at('9000').wagerToRaise, '0.00000000');
  assert.equal(at('0').cap, '3000.00000000');
  assert.equal(at('9000', { ...ON, wagerBonus: false }).cap, '3000.00000000');
  assert.equal(at('1000', { ...ON, depositMultiplier: 2.5, wagerMultiplier: 0.5 }).cap, '3000.00000000');
  assert.equal(at('1000').currency, 'USDT');
  // remaining never goes below zero
  assert.equal(withdrawalCap.computeCap({ currency: 'INR', deposited: '10', withdrawn: '500', wagered: '0', settings: ON }).remaining, '0.00000000');
});

test('withdrawal cap on the rails', async (t) => {
  const logger = createLogger({ name: 'withdraw-cap-test', level: 'silent' });
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

  const sql = (query, replacements = {}) => connection.sequelize.query(query, { replacements });

  const created = [];
  t.after(async () => {
    entitlements.resetEntitlements();
    resetAgentPlayers();
    const { models: m } = connection;
    for (const uid of created) {
      await m.FiatWithdrawals.destroy({ where: { uid } });
      await m.Withdrawals.destroy({ where: { uid } });
      await m.FiatDeposits.destroy({ where: { user_id: uid } });
      await m.Userwager.destroy({ where: { uid } });
      await m.UserKyc.destroy({ where: { user_id: String(uid) } });
      await m.CreditsLedger.destroy({ where: { user_id: String(uid) } });
      await m.Credits.destroy({ where: { uid } });
      await sql('DELETE FROM bets WHERE uid = :uid', { uid });
      await sql('DELETE FROM "SportsBet" WHERE user_id = :uid', { uid });
      await sql("DELETE FROM staff_transfers WHERE (to_type = 'user' AND to_id = :uid) OR (from_type = 'user' AND from_id = :uid)", { uid });
      await sql('DELETE FROM apaywithdrawals WHERE user_id = :uid', { uid: String(uid) });
      await sql('DELETE FROM pay_out_transactions WHERE user_id = :uid', { uid });
    }
    await m.Users.destroy({ where: { id: created } });
    await connection.close();
  });

  // The owner's document, through the real entitlements helper.
  let cap = { ...ON };
  entitlements.configureEntitlements({ read: async () => ({ features: {}, flags: {}, version: 2, source: 'owner', withdrawalCap: cap }) });

  // The policy variant (KYC / wagering), as the owner set it.
  let policy = 'none';
  const models = Object.assign(Object.create(null), connection.models, {
    SiteFeature: {
      findByPk: async (key) =>
        key === 'withdrawal_requirements' ? { variant: policy } : connection.models.SiteFeature.findByPk(key, { raw: true }),
    },
  });
  const rewardMoney = {
    currency: async () => 'USDT',
    toUsd: async (amount) => amount,
    fromUsd: async (amount) => ({ currency: 'USDT', amount, usd: amount }),
    toReward: async (amount) => ({ currency: 'USDT', amount }),
    convert: async (amount) => amount,
  };
  const config = { SERVICE_NAME: 'user-service', WITHDRAW_MINIMUM: '1', WITHDRAW_REQUIRE_KYC: true };
  const deps = { models, db: connection, logger, config, rewardMoney, bonusWageringLock: async () => true };

  const fiat = new FiatWithdrawService(deps);
  const crypto = new CryptoWithdrawService(deps);
  const requirements = createWithdrawRequirements(deps);
  const registered = new Map();
  cryptoSockets.register({ on: (event, spec) => registered.set(event, spec), deps });
  const socketWithdraw = registered.get(EVENTS.SUBMIT_NEW_WITHDRAWL).handle;
  const passwordHash = await hashPassword(PASSWORD, 4);

  /** A direct player, 20,000 USDT and INR in the wallet, KYC as given, nothing deposited yet. */
  async function player({ kyc = 'Verified', wagerMultiplier = '0' } = {}) {
    const uid = newId();
    created.push(uid);
    await models.Users.create({ id: uid, name: `wc-${uid}`, password: passwordHash, status: 'active', parent_staff_id: null, wager_multiplier: wagerMultiplier });
    await models.Credits.create({ uid, inr: '20000', usdt: '20000' });
    await models.UserKyc.create({ user_id: String(uid), status: kyc });
    return uid;
  }
  const deposit = (uid, amount, currency = 'USDT', status = 'approved') =>
    models.FiatDeposits.create({ user_id: uid, amount, currency, status });
  const bet = (uid, amount, coin = 'usdt', result = null) =>
    sql('INSERT INTO bets (uid, game, gid, coin, amount, result) VALUES (:uid, :game, 1, :coin, :amount, :result)', {
      uid, game: 'dice', coin, amount, result: result === null ? null : JSON.stringify(result),
    });

  const fiatRequest = (userId, amount, currency = 'USDT', extra = {}) =>
    fiat.create({ userId, details: { amount, currency, accountHolderName: 'WC Test', bankName: 'B', accountNumber: '123', ifscCode: 'ABCD0000001', ...extra } });
  const cryptoRequest = (userId, amount) => crypto.request({ userId, coin: 'USDT', amount, wallet: `T${userId}addr` });
  const balance = async (uid, col = 'usdt') => money.fromStored(String((await models.Credits.findOne({ where: { uid }, raw: true }))[col]));

  const capRefusal = (expect) => (e) => {
    assert.equal(e.code, 'WITHDRAW_CAP_EXCEEDED');
    assert.equal(e.status, 403);
    for (const [k, v] of Object.entries(expect)) assert.equal(e.details[k], v, k);
    return true;
  };

  await t.test('1,000 deposited, 1,000 wagered → cap 4,000; over it refused with the figures, at it accepted', async () => {
    const uid = await player();
    await deposit(uid, '1000');
    await bet(uid, '600');
    await bet(uid, '400');
    // A refunded round and a QA round are not turnover.
    await bet(uid, '5000', 'usdt', 'refunded');
    await bet(uid, '5000', 'usdt', { fake: 'true' });

    const read = await requirements.evaluate(uid, { currency: 'USDT' });
    assert.deepEqual(read.cap, {
      enabled: true, multiplier: 3, wagerBonusEnabled: true, wagerMultiplier: 5, currency: 'USDT',
      deposited: '1000.00000000', withdrawn: '0.00000000', wagered: '1000.00000000', cap: '4000.00000000',
      remaining: '4000.00000000', wagerToRaise: '4000.00000000', unlockedByWager: '1000.00000000',
    });

    await assert.rejects(fiatRequest(uid, '4000.01'), (e) => {
      capRefusal({ cap: '4000.00000000', remaining: '4000.00000000', withdrawn: '0.00000000', deposited: '1000.00000000', wagered: '1000.00000000', unlockedByWager: '1000.00000000', wagerToRaise: '4000.00000000', currency: 'USDT' })(e);
      assert.equal(e.message, 'You can withdraw up to 4,000 USDT more (3× your total deposits + 1,000 USDT unlocked by wagering). Wager 4,000 USDT more or deposit to raise your limit.');
      return true;
    });
    assert.equal(await balance(uid), '20000.00000000', 'nothing held');

    const row = await fiatRequest(uid, '4000');
    assert.ok(row.heldLedgerId);
    const after = await requirements.evaluate(uid, { currency: 'USDT' });
    assert.equal(after.cap.remaining, '0.00000000');
    assert.ok(after.missing.includes('cap'));
    await assert.rejects(cryptoRequest(uid, '1'), capRefusal({ remaining: '0.00000000' }));
  });

  await t.test('5,000 or more wagered → cap 8,000; the bonus is capped at 5× deposits', async () => {
    const uid = await player();
    await deposit(uid, '1000');
    await bet(uid, '7000');
    const c = (await requirements.evaluate(uid, { currency: 'USDT' })).cap;
    assert.equal(c.cap, '8000.00000000');
    assert.equal(c.unlockedByWager, '5000.00000000');
    assert.equal(c.wagerToRaise, '0.00000000');
    await assert.rejects(fiatRequest(uid, '8001'), (e) => {
      assert.match(e.message, /^You can withdraw up to 8,000 USDT more \(3× your total deposits \+ 5,000 USDT unlocked by wagering\)\. Deposit more to raise your limit\.$/);
      return e.code === 'WITHDRAW_CAP_EXCEEDED';
    });
    assert.ok((await fiatRequest(uid, '8000')).heldLedgerId);
  });

  await t.test('pending withdrawals count, rejected ones do not', async () => {
    const uid = await player();
    await deposit(uid, '1000');
    // Rejected (refunded) on both rails, and a refunded A-Pay payout: not counted.
    await models.FiatWithdrawals.create({ uid, amount: '2500', currency: 'USDT', account_holder_name: 'x', status: 'Rejected', date: new Date() });
    await models.Withdrawals.create({ uid, amount: '2500', wallet: 'Tx', status: 'Rejected', coin: 'USDT', date: new Date() });
    await sql(`INSERT INTO apaywithdrawals (order_id, user_id, amount, currency, payment_system, status, refunded) VALUES (:o, :u, 2500, 'USDT', 'x', 'Failed', true)`, { o: `wc-${uid}-a`, u: String(uid) });
    await sql(`INSERT INTO pay_out_transactions (user_id, transaction_id, out_trade_no, currency, amount, status, pay_type) VALUES (:u, :o, :o, 'USDT', 2500, 2, 'x')`, { o: `wc-${uid}-p`, u: uid });
    let c = (await requirements.evaluate(uid, { currency: 'USDT' })).cap;
    assert.equal(c.withdrawn, '0.00000000');
    assert.equal(c.remaining, '3000.00000000');

    // Pending on fiat (In Queue), crypto (Approved) and a pending payout: all held, all counted.
    await fiatRequest(uid, '1000');
    await models.Withdrawals.create({ uid, amount: '500', wallet: 'Tx', status: 'Approved', coin: 'USDT', date: new Date() });
    await sql(`INSERT INTO pay_out_transactions (user_id, transaction_id, out_trade_no, currency, amount, status, pay_type) VALUES (:u, :o, :o, 'USDT', 700, 0, 'x')`, { o: `wc-${uid}-q`, u: uid });
    c = (await requirements.evaluate(uid, { currency: 'USDT' })).cap;
    assert.equal(c.withdrawn, '2200.00000000');
    assert.equal(c.remaining, '800.00000000');
    await assert.rejects(fiatRequest(uid, '800.5'), capRefusal({ remaining: '800.00000000', withdrawn: '2200.00000000' }));
    assert.ok((await cryptoRequest(uid, '800')).heldLedgerId);
  });

  await t.test('the wager bonus off: the cap is deposits × multiplier, wagering ignored', async () => {
    cap = { ...ON, wagerBonus: false };
    try {
      const uid = await player();
      await deposit(uid, '1000');
      await bet(uid, '9000');
      const c = (await requirements.evaluate(uid, { currency: 'USDT' })).cap;
      assert.equal(c.wagerBonusEnabled, false);
      assert.equal(c.cap, '3000.00000000');
      assert.equal(c.wagerToRaise, '0.00000000');
      await assert.rejects(fiatRequest(uid, '3001'), (e) => {
        assert.equal(e.message, 'You can withdraw up to 3,000 USDT more (3× your total deposits). Deposit more to raise your limit.');
        return e.code === 'WITHDRAW_CAP_EXCEEDED';
      });
    } finally {
      cap = { ...ON };
    }
  });

  await t.test('per currency: an INR deposit, INR sports and staff money never raise the USDT cap', async () => {
    const uid = await player();
    await deposit(uid, '100', 'USDT');
    await deposit(uid, '10000', 'INR');
    await bet(uid, '100', 'usdt');
    await bet(uid, '50000', 'inr');
    // A settled lay bet counts at its liability (the money at risk), a void bet not at all.
    await sql(`INSERT INTO "SportsBet" (user_id, stake_amount, liability, bet_type, status, result_status) VALUES (:u, 5000, 300, 'lay', 'closed', 'loss'), (:u, 2000, 2000, 'back', 'closed', 'refund'), (:u, 1000, 1000, 'back', 'open', NULL)`, { u: uid });
    await sql(`INSERT INTO staff_transfers (from_type, from_id, to_type, to_id, amount, direction, transfer_type) VALUES ('staff', 1, 'user', :u, 2000, 'deposit', 'transfer')`, { u: uid });

    const usdt = (await requirements.evaluate(uid, { currency: 'USDT' })).cap;
    assert.equal(usdt.deposited, '100.00000000');
    assert.equal(usdt.wagered, '100.00000000');
    assert.equal(usdt.cap, '400.00000000');

    const inr = (await requirements.evaluate(uid, { currency: 'inr' })).cap;
    assert.equal(inr.currency, 'INR');
    assert.equal(inr.deposited, '12000.00000000');
    assert.equal(inr.wagered, '50300.00000000');
    assert.equal(inr.cap, '86300.00000000'); // 36,000 + 50,300 (under the 60,000 bonus ceiling)

    await assert.rejects(fiatRequest(uid, '401', 'USDT'), capRefusal({ currency: 'USDT', remaining: '400.00000000' }));
    assert.ok((await fiatRequest(uid, '5000', 'INR')).heldLedgerId);

    // No currency: one block per currency the player has used.
    const all = (await requirements.evaluate(uid)).cap;
    assert.equal(all.enabled, true);
    assert.deepEqual(all.currencies.map((b) => b.currency), ['INR', 'USDT']);
    assert.equal(all.currencies[0].withdrawn, '5000.00000000');

    // A currency never deposited has a cap of 0.
    const btc = (await requirements.evaluate(uid, { currency: 'BTC' })).cap;
    assert.equal(btc.cap, '0.00000000');
    assert.ok((await requirements.evaluate(uid, { currency: 'BTC' })).missing.includes('cap'));
  });

  await t.test('fails closed: an unreadable figure or a rail without amount / currency → 503, nothing held', async () => {
    const uid = await player();
    await deposit(uid, '1000');
    const broken = createWithdrawRequirements({ ...deps, capFigures: { figures: async () => { throw new Error('db down'); }, currencies: async () => [] } });
    await assert.rejects(broken.assertMet(uid, { kycError: () => new Error('kyc'), amount: '1', currency: 'USDT' }), (e) =>
      e.code === 'WITHDRAW_CAP_CHECK_FAILED' && e.status === 503);
    await assert.rejects(requirements.assertMet(uid, { kycError: () => new Error('kyc') }), (e) => e.code === 'WITHDRAW_CAP_CHECK_FAILED');
    await assert.rejects(requirements.assertMet(uid, { kycError: () => new Error('kyc'), amount: 'abc', currency: 'USDT' }), (e) => e.code === 'WITHDRAW_CAP_CHECK_FAILED');

    const fiatBroken = new FiatWithdrawService({ ...deps, withdrawRequirements: broken });
    await assert.rejects(fiatBroken.create({ userId: uid, details: { amount: '1', currency: 'USDT', accountHolderName: 'x', bankName: 'B', accountNumber: '1', ifscCode: 'ABCD0000001' } }), (e) => e.code === 'WITHDRAW_CAP_CHECK_FAILED');
    // The cap off: nothing is read, so a broken reader cannot block.
    cap = { ...ON, enabled: false };
    try {
      assert.equal((await broken.assertMet(uid, { kycError: () => new Error('kyc'), amount: '1', currency: 'USDT' })).cap.enabled, false);
    } finally {
      cap = { ...ON };
    }
  });

  await t.test('combinations: KYC, wagering and the cap, in that order; cap off = no limit', async () => {
    const pending = await player({ kyc: 'Pending' });
    await deposit(pending, '100');
    const verified = await player({ kyc: 'Verified' });
    await deposit(verified, '100');
    // Deposit rollover open (2× of 100 USD, nothing wagered in `userwager`).
    const rollover = await player({ kyc: 'Verified', wagerMultiplier: '2' });
    await deposit(rollover, '100');

    const cases = [
      // [policy, cap on, uid, amount, expected]
      ['kyc', true, pending, '1000', 'FIAT_WITHDRAW_KYC_REQUIRED'],
      ['kyc', true, verified, '1000', 'WITHDRAW_CAP_EXCEEDED'],
      ['kyc', true, verified, '300', 'OK'],
      ['kyc', false, verified, '1000', 'OK'],
      ['none', true, pending, '1000', 'WITHDRAW_CAP_EXCEEDED'],
      ['none', false, pending, '5000', 'OK'],
      ['wager', true, rollover, '1000', 'WITHDRAW_WAGER_REQUIRED'],
      ['kyc_and_wager', true, pending, '1000', 'FIAT_WITHDRAW_KYC_REQUIRED'],
      ['kyc_and_wager', true, rollover, '50', 'WITHDRAW_WAGER_REQUIRED'],
    ];
    for (const [p, capOn, uid, amount, expected] of cases) {
      policy = p;
      cap = { ...ON, enabled: capOn };
      const label = `${p} + cap ${capOn ? 'on' : 'off'} → ${expected}`;
      if (expected === 'OK') {
        assert.ok((await fiatRequest(uid, amount)).heldLedgerId, label);
        await models.FiatWithdrawals.destroy({ where: { uid } });
        await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
        await models.Credits.update({ usdt: '20000' }, { where: { uid } });
      } else {
        await assert.rejects(fiatRequest(uid, amount), (e) => e.code === expected, label);
      }
    }
    policy = 'none';
    cap = { ...ON };
  });

  await t.test('the crypto socket answers the cap refusal with its figures', async () => {
    const uid = await player();
    await deposit(uid, '10');
    const answer = await socketWithdraw({ wallet: 'Taddr', amount: '31', coin: 'USDT', password: PASSWORD }, { userId: uid });
    assert.equal(answer.error.code, 'WITHDRAW_CAP_EXCEEDED');
    assert.equal(answer.error.details.remaining, '30.00000000');
    assert.equal(answer.error.details.currency, 'USDT');
    assert.match(answer.status, /^You can withdraw up to 30 USDT more/);
    const ok = await socketWithdraw({ wallet: 'Taddr', amount: '30', coin: 'USDT', password: PASSWORD }, { userId: uid });
    assert.equal(ok.status, true);
  });

  await t.test('payment-order payouts: refused over the cap before anything is held; the pending payout counts', async () => {
    const uid = await player();
    await deposit(uid, '100', 'INR');
    const calls = [];
    const service = new PaymentOrdersService({
      ...deps,
      config: { ...config, AUTO_WITHDRAWALS_ENABLED: true, WITHDRAW_MAXIMUM: '50000', APAY_API_KEY: 'apay-key', APAY_PROJECT_ID: '1234', APAY_BASE_URL: 'https://apay.test' },
      http: { post: async (url, body) => { calls.push(url); return { success: true, order_id: `P-${calls.length}` }; }, get: async () => ({}), form: async () => ({}), raw: async () => ({}) },
    });
    const details = { account_name: 'Test Player', account_number: '123456789', bank_code: 'BKID0000001' };
    await assert.rejects(service.createWithdrawal({ userId: uid, provider: 'apay', currency: 'INR', amount: '301', details }),
      capRefusal({ currency: 'INR', remaining: '300.00000000' }));
    assert.equal(calls.length, 0);
    assert.equal(await balance(uid, 'inr'), '20000.00000000');

    const first = await service.createWithdrawal({ userId: uid, provider: 'apay', currency: 'INR', amount: '200', details });
    assert.equal(first.status, 'pending');
    await assert.rejects(service.createWithdrawal({ userId: uid, provider: 'apay', currency: 'INR', amount: '101', details }),
      capRefusal({ withdrawn: '200.00000000', remaining: '100.00000000' }));
  });

  await t.test('two requests at once cannot both fit under the cap', async () => {
    const uid = await player();
    await deposit(uid, '1000');
    const results = await Promise.allSettled([fiatRequest(uid, '2000'), cryptoRequest(uid, '2000'), fiatRequest(uid, '2000', 'USDT', { accountNumber: '456' })]);
    const okCount = results.filter((r) => r.status === 'fulfilled').length;
    const refused = results.filter((r) => r.status === 'rejected');
    assert.equal(okCount, 1, JSON.stringify(refused.map((r) => r.reason?.code)));
    for (const r of refused) assert.equal(r.reason.code, 'WITHDRAW_CAP_EXCEEDED');
    assert.equal(await balance(uid), '18000.00000000');
  });

  // ── The read route and agent players ────────────────────────────────────
  const agentPlayer = await player();
  await deposit(agentPlayer, '1000');
  configureAgentPlayers({ isAgentPlayer: async (id) => String(id) === String(agentPlayer) });

  const app = express();
  app.use(express.json());
  app.use(requestContext());
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-test-user']) }; next(); });
  app.use('/withdrawals/requirements', require('../routes/user.routes')(deps));
  app.use('/withdrawals/fiat', require('../../fiat-withdraw/routes/user.routes')(deps));
  app.use(errorHandler({ logger }));
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, user, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-test-user': String(user) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json, code: json?.error?.code, details: json?.error?.details, message: json?.error?.message ?? json?.message };
  };

  await t.test('GET /withdrawals/requirements?currency=: the cap block; strict; the HTTP refusal carries the figures', async () => {
    policy = 'kyc';
    const uid = await player();
    await deposit(uid, '50');
    const res = await call('GET', '/withdrawals/requirements?currency=usdt', uid);
    assert.equal(res.status, 200);
    const d = res.body.data;
    // The existing fields are unchanged.
    for (const k of ['policy', 'ok', 'missing', 'kyc', 'wager', 'bonusForfeitRequired']) assert.ok(k in d, k);
    assert.equal(d.policy, 'kyc');
    assert.equal(d.cap.currency, 'USDT');
    assert.equal(d.cap.cap, '150.00000000');
    assert.equal(d.cap.remaining, '150.00000000');

    const all = (await call('GET', '/withdrawals/requirements', uid)).body.data.cap;
    assert.deepEqual(all.currencies.map((b) => b.currency), ['USDT']);

    assert.equal((await call('GET', '/withdrawals/requirements?currency=XYZ', uid)).status, 422);
    assert.equal((await call('GET', '/withdrawals/requirements?currency=USDT&x=1', uid)).status, 422);

    const over = await call('POST', '/withdrawals/fiat', uid, { amount: '151', currency: 'USDT', accountHolderName: 'WC', bankName: 'B', accountNumber: '1', ifscCode: 'ABCD0000001' });
    assert.equal(over.status, 403);
    assert.equal(over.code, 'WITHDRAW_CAP_EXCEEDED');
    assert.equal(over.details.remaining, '150.00000000');
    assert.match(over.message, /^You can withdraw up to 150 USDT more \(3× your total deposits \+ 0 USDT unlocked by wagering\)\. Wager 250 USDT more or deposit to raise your limit\.$/);

    // The cap off: the block says so, with no figures.
    cap = { ...ON, enabled: false };
    const off = (await call('GET', '/withdrawals/requirements?currency=USDT', uid)).body.data.cap;
    assert.equal(off.enabled, false);
    assert.equal(off.remaining, null);
    cap = { ...ON };
  });

  await t.test('agent players keep their refusal with the cap on', async () => {
    assert.equal((await call('GET', '/withdrawals/requirements?currency=USDT', agentPlayer)).code, 'WITHDRAW_NOT_FOR_AGENT_USERS');
    const fiatRes = await call('POST', '/withdrawals/fiat', agentPlayer, { amount: '10', currency: 'USDT', accountHolderName: 'WC', bankName: 'B', accountNumber: '1', ifscCode: 'ABCD0000001' });
    assert.equal(fiatRes.code, 'WITHDRAW_NOT_FOR_AGENT_USERS');
    await assert.rejects(cryptoRequest(agentPlayer, '10'), (e) => e.code === 'WITHDRAW_NOT_FOR_AGENT_USERS');
    const socket = await socketWithdraw({ wallet: 'Taddr', amount: '10', coin: 'USDT', password: PASSWORD }, { userId: agentPlayer });
    assert.equal(socket.error.code, 'WITHDRAW_NOT_FOR_AGENT_USERS');
  });
});
