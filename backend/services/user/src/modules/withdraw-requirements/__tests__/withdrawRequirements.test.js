'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, errorHandler, requestContext, money } = require('@ibitplay/common');
const { hashPassword, configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');
const { EVENTS } = require('@ibitplay/socket');

const { FiatWithdrawService } = require('../../fiat-withdraw/fiatWithdraw.service');
const { CryptoWithdrawService } = require('../../crypto-withdraw/cryptoWithdraw.service');
const cryptoSockets = require('../../crypto-withdraw/sockets');
const { createWithdrawRequirements } = require('../withdrawRequirements');

/**
 * The owner's `withdrawal_requirements` policy on the withdrawal rails.
 *
 *   policy {none, kyc, wager, kyc_and_wager} × KYC {Verified, Pending} × wagering {complete, open}
 *   on fiat (`FiatWithdrawService.create`) and crypto (`CryptoWithdrawService.request`), plus the
 *   `SUBMIT_NEW_WITHDRAWL` socket, the bonus forfeit, agent players and the read route.
 *
 * The policy is served by a SiteFeature stand-in (the rest is the real test database), so a
 * parallel suite never sees a policy it did not set. The owner → site_features leg is
 * admin-service's `entitlements/__tests__/withdrawalRequirements.test.js`.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const PASSWORD = 'withdraw-requirements-pass';
const POLICIES = ['none', 'kyc', 'wager', 'kyc_and_wager'];

let nextId = 947_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('withdrawal requirements', async (t) => {
  const logger = createLogger({ name: 'withdraw-requirements-test', level: 'silent' });
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

  const created = [];
  const cleanup = async () => {
    const { models: m } = connection;
    for (const uid of created) {
      await m.FiatWithdrawals.destroy({ where: { uid } });
      await m.Withdrawals.destroy({ where: { uid } });
      await m.PlayerBonus.destroy({ where: { user_id: uid } });
      await m.FiatDeposits.destroy({ where: { user_id: uid } });
      await m.Userwager.destroy({ where: { uid } });
      await m.UserKyc.destroy({ where: { user_id: String(uid) } });
      await m.CreditsLedger.destroy({ where: { user_id: String(uid) } });
      await m.Credits.destroy({ where: { uid } });
    }
    await m.Users.destroy({ where: { id: created } });
  };
  t.after(async () => {
    resetAgentPlayers();
    await cleanup();
    await connection.close();
  });

  // The policy, as the owner set it — read through sitePolicy.readPolicy like the real row.
  let policy = 'kyc';
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

  /**
   * A direct player with 1000 USDT, KYC Verified or Pending, one approved 100 USDT deposit at
   * a 2x rollover (target 200 USD) and 250 (complete) or 50 (150 left) wagered.
   */
  async function player({ kyc, wagered, bonus = null }) {
    const uid = newId();
    created.push(uid);
    await models.Users.create({ id: uid, name: `wr-${uid}`, password: passwordHash, status: 'active', parent_staff_id: null, wager_multiplier: '2' });
    await models.Credits.create({ uid, inr: '0', usdt: '1000' });
    await models.UserKyc.create({ user_id: String(uid), status: kyc });
    await models.FiatDeposits.create({ user_id: uid, amount: '100', currency: 'USDT', status: 'approved' });
    await models.Userwager.create({ uid, wager: String(wagered) });
    if (bonus) {
      await models.PlayerBonus.create({
        user_id: uid, source: 'first_deposit', grant_key: `wr-test:${uid}`, amount: '50', currency: 'USDT',
        wager_multiplier: '10', required_wager: '500', wagered: bonus.wagered ?? '0', status: 'active',
      });
    }
    return uid;
  }

  const fiatRequest = (userId, extra = {}) =>
    fiat.create({ userId, details: { amount: '10', currency: 'USDT', accountHolderName: 'WR Test', bankName: 'B', accountNumber: '123', ifscCode: 'ABCD0000001', ...extra } });
  const cryptoRequest = (userId, extra = {}) =>
    crypto.request({ userId, coin: 'USDT', amount: '10', wallet: `T${userId}addr`, ...extra });

  const balance = async (uid) => money.fromStored(String((await models.Credits.findOne({ where: { uid }, raw: true })).usdt));

  await t.test('the matrix: every policy × KYC × wagering, on fiat and crypto', async () => {
    const players = {};
    for (const kyc of ['Verified', 'Pending']) {
      for (const done of [true, false]) players[`${kyc}:${done}`] = await player({ kyc, wagered: done ? '250' : '50' });
    }
    const results = [];

    for (const p of POLICIES) {
      policy = p;
      const needKyc = p === 'kyc' || p === 'kyc_and_wager';
      // The deposit rollover is required under every policy (2026-10-21).
      const needWager = true;

      for (const kyc of ['Verified', 'Pending']) {
        for (const done of [true, false]) {
          const uid = players[`${kyc}:${done}`];
          const expected = needKyc && kyc !== 'Verified' ? 'KYC' : needWager && !done ? 'WAGER' : 'OK';

          // The read agrees with the rails.
          const read = await requirements.evaluate(uid);
          assert.equal(read.policy, p);
          assert.equal(read.kyc.required, needKyc);
          assert.equal(read.wager.required, needWager);
          assert.equal(read.wager.done, done);
          assert.equal(read.wager.remaining, done ? '0.00000000' : '150.00000000');
          assert.deepEqual(read.missing, [...(needKyc && kyc !== 'Verified' ? ['kyc'] : []), ...(needWager && !done ? ['wager'] : [])]);
          assert.equal(read.ok, read.missing.length === 0);

          for (const [rail, call, kycCode] of [
            ['fiat', fiatRequest, 'FIAT_WITHDRAW_KYC_REQUIRED'],
            ['crypto', cryptoRequest, 'CRYPTO_WITHDRAW_KYC_REQUIRED'],
          ]) {
            const before = await balance(uid);
            const label = `${p} / KYC ${kyc} / wager ${done ? 'complete' : 'open'} / ${rail}`;
            if (expected === 'OK') {
              const row = await call(uid);
              assert.ok(row.heldLedgerId, label);
              // Undo, so the next case starts from the same balance.
              await models.FiatWithdrawals.destroy({ where: { uid } });
              await models.Withdrawals.destroy({ where: { uid } });
              await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
              await models.Credits.update({ usdt: '1000' }, { where: { uid } });
            } else {
              await assert.rejects(call(uid), (e) => {
                if (expected === 'KYC') return e.code === kycCode && e.status === 403;
                return e.code === 'WITHDRAW_WAGER_REQUIRED' && e.status === 403 &&
                  e.details.remaining === '150.00000000' && e.details.currency === 'USD' &&
                  e.message.endsWith('50.00 of 200.00 USD wagered');
              }, label);
              assert.equal(await balance(uid), before, `${label}: nothing held`);
            }
            results.push(`${label}: ${expected}`);
          }
        }
      }
    }
    assert.equal(results.length, 32);
    t.diagnostic(`matrix: ${results.filter((r) => r.endsWith('OK')).length} accepted, ${results.filter((r) => !r.endsWith('OK')).length} refused`);
  });

  await t.test('the socket answers the wager refusal with its details, and accepts once complete', async () => {
    policy = 'wager';
    const open = await player({ kyc: 'Pending', wagered: '50' });
    const answer = await socketWithdraw({ wallet: 'Taddr', amount: '10', coin: 'USDT', password: PASSWORD }, { userId: open });
    assert.equal(answer.error.code, 'WITHDRAW_WAGER_REQUIRED');
    assert.equal(answer.error.details.remaining, '150.00000000');
    assert.equal(answer.error.details.currency, 'USD');

    policy = 'kyc_and_wager';
    const kycOnly = await socketWithdraw({ wallet: 'Taddr', amount: '10', coin: 'USDT', password: PASSWORD }, { userId: open });
    assert.equal(kycOnly.error.code, 'CRYPTO_WITHDRAW_KYC_REQUIRED');

    // `none` no longer waives the rollover; completing it does.
    policy = 'none';
    const still = await socketWithdraw({ wallet: 'Taddr', amount: '10', coin: 'USDT', password: PASSWORD }, { userId: open });
    assert.equal(still.error.code, 'WITHDRAW_WAGER_REQUIRED');
    await models.Userwager.update({ wager: '250' }, { where: { uid: open } });
    const ok = await socketWithdraw({ wallet: 'Taddr', amount: '10', coin: 'USDT', password: PASSWORD }, { userId: open });
    assert.equal(ok.status, true);
    assert.equal(await balance(open), '990.00000000');
  });

  await t.test('an operator multiplier of 0 clears the rollover', async () => {
    policy = 'none';
    const uid = await player({ kyc: 'Pending', wagered: '0' });
    await assert.rejects(fiatRequest(uid), (e) => e.code === 'WITHDRAW_WAGER_REQUIRED');
    await models.Users.update({ wager_multiplier: 0 }, { where: { id: uid } });
    assert.ok((await fiatRequest(uid)).heldLedgerId);
  });

  await t.test('forfeiting a bonus clears the bonus part of the wager requirement', async () => {
    policy = 'wager';
    // Deposit rollover complete, a 50 USDT bonus with 500 still to wager.
    const uid = await player({ kyc: 'Pending', wagered: '250', bonus: {} });
    const read = await requirements.evaluate(uid);
    assert.deepEqual(read.missing, ['wager']);
    assert.equal(read.wager.remaining, '500.00000000');
    assert.equal(read.wager.remainingAfterForfeit, '0.00000000');
    assert.equal(read.bonusForfeitRequired, true);
    assert.equal(read.wager.bonus.bonuses.length, 1);

    // Not confirmed: the existing forfeit prompt, nothing held.
    await assert.rejects(fiatRequest(uid), (e) => e.code === 'BONUS_FORFEIT_REQUIRED' && e.status === 409);
    await assert.rejects(cryptoRequest(uid), (e) => e.code === 'BONUS_FORFEIT_REQUIRED');
    assert.equal(await balance(uid), '1000.00000000');

    // Confirmed: forfeited in the withdrawal's transaction, and the request goes through.
    const row = await fiatRequest(uid, { forfeitBonus: true });
    assert.ok(row.heldLedgerId);
    assert.equal((await models.PlayerBonus.findOne({ where: { user_id: uid }, raw: true })).status, 'forfeited');
    const after = await requirements.evaluate(uid);
    assert.equal(after.ok, true);
    assert.deepEqual(after.missing, []);
  });

  await t.test('an open deposit rollover is not cleared by a forfeit; remaining counts the bonus unless forfeited', async () => {
    policy = 'wager';
    const uid = await player({ kyc: 'Verified', wagered: '50', bonus: { wagered: '100' } });
    const read = await requirements.evaluate(uid);
    assert.equal(read.wager.remaining, '550.00000000');
    assert.equal(read.wager.remainingAfterForfeit, '150.00000000');

    await assert.rejects(fiatRequest(uid), (e) =>
      e.code === 'WITHDRAW_WAGER_REQUIRED' && e.details.remaining === '550.00000000' && e.details.forfeitable === true);
    await assert.rejects(cryptoRequest(uid, { forfeitBonus: true }), (e) =>
      e.code === 'WITHDRAW_WAGER_REQUIRED' && e.details.remaining === '150.00000000' && e.details.forfeitable === false);
    // The refusal came before the transaction: the bonus is still active, nothing held.
    assert.equal((await models.PlayerBonus.findOne({ where: { user_id: uid }, raw: true })).status, 'active');
    assert.equal(await balance(uid), '1000.00000000');
  });

  await t.test('kyc stays off when the deployment switch WITHDRAW_REQUIRE_KYC is off', async () => {
    policy = 'kyc_and_wager';
    const uid = await player({ kyc: 'Pending', wagered: '250' });
    const off = createWithdrawRequirements({ ...deps, config: { ...config, WITHDRAW_REQUIRE_KYC: false } });
    const read = await off.evaluate(uid);
    assert.equal(read.kyc.required, false);
    assert.equal(read.ok, true);
  });

  // ── The read route, and agent players ───────────────────────────────────
  const agentPlayer = await player({ kyc: 'Verified', wagered: '250' });
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
    return { status: res.status, body: json, code: json?.error?.code };
  };

  await t.test('GET /withdrawals/requirements: the policy, what is missing, the remaining wager; strict', async () => {
    policy = 'kyc_and_wager';
    const uid = await player({ kyc: 'Pending', wagered: '50' });
    const res = await call('GET', '/withdrawals/requirements', uid);
    assert.equal(res.status, 200);
    const d = res.body.data;
    assert.equal(d.policy, 'kyc_and_wager');
    assert.deepEqual(d.missing, ['kyc', 'wager']);
    assert.equal(d.ok, false);
    assert.deepEqual(d.kyc, { required: true, status: 'Pending', verified: false });
    assert.equal(d.wager.remaining, '150.00000000');
    assert.equal(d.wager.currency, 'USD');
    assert.equal(d.wager.deposit.target, '200.00000000');

    assert.equal((await call('GET', '/withdrawals/requirements?x=1', uid)).status, 422);
  });

  await t.test('agent players keep their refusals, whatever the policy', async () => {
    for (const p of POLICIES) {
      policy = p;
      assert.equal((await call('GET', '/withdrawals/requirements', agentPlayer)).code, 'WITHDRAW_NOT_FOR_AGENT_USERS');
      const fiatRes = await call('POST', '/withdrawals/fiat', agentPlayer, {
        amount: '10', currency: 'USDT', accountHolderName: 'WR Test', bankName: 'B', accountNumber: '123', ifscCode: 'ABCD0000001',
      });
      assert.equal(fiatRes.code, 'WITHDRAW_NOT_FOR_AGENT_USERS', `fiat under ${p}`);
      await assert.rejects(cryptoRequest(agentPlayer), (e) => e.code === 'WITHDRAW_NOT_FOR_AGENT_USERS', `crypto under ${p}`);
      const socket = await socketWithdraw({ wallet: 'Taddr', amount: '10', coin: 'USDT', password: PASSWORD }, { userId: agentPlayer });
      assert.equal(socket.error.code, 'WITHDRAW_NOT_FOR_AGENT_USERS', `socket under ${p}`);
    }
    assert.equal(await balance(agentPlayer), '1000.00000000');
  });
});
