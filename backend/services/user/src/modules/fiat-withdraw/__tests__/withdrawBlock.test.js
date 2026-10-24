'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, entitlements, money } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');
const { EVENTS } = require('@ibitplay/socket');

const { FiatWithdrawService } = require('../fiatWithdraw.service');
const { CryptoWithdrawService } = require('../../crypto-withdraw/cryptoWithdraw.service');
const cryptoSockets = require('../../crypto-withdraw/sockets');
const { PaymentOrdersService } = require('../../payment-orders/paymentOrders.service');
const { P2pService } = require('../../p2p/p2p.service');
const { TipService } = require('../../tip/tip.service');
const { AuthService } = require('../../auth/auth.service');
const { WalletService } = require('../../wallet/wallet.service');
const { REASON } = require('../../wallet/wallet.constants');
// The lock route's own service (admin-service), so the block is set exactly as an operator sets it.
const { LocksService } = require('../../../../../admin/src/modules/locks/locks.service');

/**
 * The withdrawal block (migration 091): `POST /admin/locks` with `withdraw: true`.
 *
 * Every player payout path refuses a blocked account with WITHDRAW_BLOCKED (403)
 * BEFORE any money moves — no withdrawal row, no ledger hold, the balance
 * untouched — and lets it through again once the block is lifted. Locking an
 * agent blocks its whole subtree; unlocking it lifts only what it imposed.
 *
 *     root ── agent ── player, ownLocked
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const PASSWORD = 'withdraw-block-test-pass';

let nextId = 931_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

const connectAs = (service, logger) =>
  db.connect({
    config: {
      DB_HOST: process.env.DB_HOST || '127.0.0.1',
      DB_PORT: Number(process.env.DB_PORT || 5432),
      DB_NAME: TEST_DB,
      DB_USER: process.env.DB_USER || 'postgres',
      DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
      DB_SCHEMA: 'public',
    },
    logger,
    service,
  });

test('the withdrawal block', async (t) => {
  const logger = createLogger({ name: 'withdraw-block-test', level: 'silent' });

  /**
   * ONE connection: `db.connect` hands back a process-wide singleton, so a second
   * call cannot give admin-service its own model set. admin-service loads every
   * domain user-service does (core, payments, extended) plus Staff and Roles,
   * which the lock route needs.
   */
  let userDb;
  try {
    userDb = await connectAs('admin-service', logger);
    await userDb.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }
  const adminDb = userDb;
  // Registered first, so a failure in the setup below cannot leave the pool open and hang the file.
  // After hooks run in registration order, so the rows are removed here, before the close.
  let cleanup = async () => {};
  t.after(async () => {
    await cleanup();
    await userDb.close();
  });

  const { models } = userDb;
  const config = {
    SERVICE_NAME: 'user-service',
    WITHDRAW_MINIMUM: '1',
    WITHDRAW_REQUIRE_KYC: false,
    AUTO_WITHDRAWALS_ENABLED: false,
    // `AuthService` builds a TokenService, which throws without these.
    JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
    JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-00000',
    JWT_ADMIN_SECRET: 'test-admin-secret-that-is-long-enough-000000',
  };
  const deps = { models, db: userDb, logger, config };

  const fiat = new FiatWithdrawService(deps);
  const crypto = new CryptoWithdrawService(deps);
  const payments = new PaymentOrdersService(deps);
  const p2p = new P2pService(deps);
  const tips = new TipService(deps);
  const auth = new AuthService(deps);
  const wallet = new WalletService(deps);
  const locks = new LocksService({ models: adminDb.models, db: adminDb, logger, config: {} });

  const registered = new Map();
  cryptoSockets.register({ on: (event, spec) => registered.set(event, spec), deps });
  const socketWithdraw = registered.get(EVENTS.SUBMIT_NEW_WITHDRAWL).handle;

  const roleId = (await adminDb.models.Roles.findOne({ where: { level: 6 }, raw: true }))?.id;
  assert.ok(roleId, 'the test database needs a level-6 (agent) role');

  const root = newId();
  const agent = newId();
  const player = newId();
  const ownLocked = newId();
  const friend = newId();
  const players = [player, ownLocked, friend];
  const actor = { id: root, permissions: ['*'] };
  const passwordHash = await hashPassword(PASSWORD, 4);

  const cleanPlayers = async () => {
    for (const uid of players) {
      await models.FiatWithdrawals.destroy({ where: { uid } });
      await models.Withdrawals.destroy({ where: { uid } });
      await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
      await models.Credits.destroy({ where: { uid } });
    }
    await models.Users.destroy({ where: { id: players } });
  };

  const reset = async () => {
    await cleanPlayers();
    await adminDb.models.Staff.destroy({ where: { id: [agent, root] } });
    await adminDb.models.Staff.bulkCreate([
      { id: root, name: `wbr-${root}`, email: `wbr${root}@t.test`, password: 'x', role_id: roleId, parent_id: null },
      { id: agent, name: `wba-${agent}`, email: `wba${agent}@t.test`, password: 'x', role_id: roleId, parent_id: root },
    ]);
    for (const uid of players) {
      await models.Users.create({
        id: uid, name: `wb-${uid}`, password: passwordHash, status: 'active',
        parent_staff_id: uid === friend ? null : agent,
      });
      await models.Credits.create({ uid, inr: '0', usdt: '0' });
      await wallet.credit(
        { userId: uid, currency: 'INR', amount: '1000', reason: REASON.DEPOSIT, idempotencyKey: `wb-seed-inr:${uid}` },
        { sourceService: 'test' }
      );
      await wallet.credit(
        { userId: uid, currency: 'USDT', amount: '100', reason: REASON.DEPOSIT, idempotencyKey: `wb-seed-usdt:${uid}` },
        { sourceService: 'test' }
      );
    }
  };

  cleanup = async () => {
    await cleanPlayers();
    await adminDb.models.Staff.destroy({ where: { id: [agent, root] } });
  };

  const fiatWithdraw = (uid) =>
    fiat.create({ userId: uid, details: { amount: '400', currency: 'INR', accountHolderName: 'A Player', upiId: 'p@bank' } });
  const cryptoWithdraw = (uid) =>
    crypto.request({ userId: uid, coin: 'USDT', amount: '40', wallet: `TQn9Y2khEsLJW1ChVWFMSMeRDow5oREq${uid}`, chain: 'TRC20' });
  const socket = (uid) =>
    socketWithdraw(
      { wallet: `TQn9Y2khEsLJW1ChVWFMSMeRDow5oREq${uid}`, amount: '30', coin: 'USDT', chain: 'TRC20', password: PASSWORD },
      { userId: uid }
    );

  const blocked = (reason = 'withdraw') => (error) => {
    assert.equal(error.code, 'WITHDRAW_BLOCKED', `${error.code}: ${error.message}`);
    assert.equal(error.statusCode ?? error.status, 403);
    assert.equal(error.details?.reason, reason);
    return true;
  };

  /** Nothing moved: no withdrawal row on either rail, no WITHDRAWAL hold, balances as seeded. */
  const assertNothingMoved = async (uid) => {
    assert.equal(await models.FiatWithdrawals.count({ where: { uid } }), 0, 'no fiat withdrawal row');
    assert.equal(await models.Withdrawals.count({ where: { uid } }), 0, 'no crypto withdrawal row');
    assert.equal(
      await models.CreditsLedger.count({ where: { user_id: String(uid), reason: REASON.WITHDRAWAL } }),
      0,
      'no ledger hold'
    );
    const row = await models.Credits.findOne({ where: { uid }, raw: true });
    assert.equal(money.toDecimalString(money.toMinor(row.inr)), '1000.00000000');
    assert.equal(money.toDecimalString(money.toMinor(row.usdt)), '100.00000000');
  };

  await t.test('a blocked player is refused on every rail and nothing moves', async () => {
    await reset();
    const result = await locks.updateLocks({ actor, userId: player, locks: { withdraw: true } });
    assert.deepEqual(result.applied, { withdraw_locked: true });

    await assert.rejects(fiatWithdraw(player), blocked());
    await assert.rejects(cryptoWithdraw(player), blocked());

    const viaSocket = await socket(player);
    assert.notEqual(viaSocket.status, true, JSON.stringify(viaSocket));
    assert.equal(viaSocket.error?.code, 'WITHDRAW_BLOCKED');

    // The gateway payout refuses before its kill switch (WITHDRAWALS_DISABLED) is even read.
    await assert.rejects(
      payments.createWithdrawal({ userId: player, provider: 'any', currency: 'INR', amount: '100', details: {} }),
      blocked()
    );
    // A P2P sell order is refused before the offer is looked up.
    await assert.rejects(
      p2p.createSellOrder({ userId: player, offerId: 1, cryptoAmount: '10', paymentTypeId: 1, accountName: 'x' }),
      blocked()
    );
    // A tip would hand the balance to someone who can withdraw it.
    await assert.rejects(
      tips.send({ userId: player, toUsername: `wb-${friend}`, currency: 'INR', amount: '100' }),
      blocked()
    );

    await assertNothingMoved(player);
  });

  await t.test('the player profile shows the flag', async () => {
    await reset();
    assert.equal((await auth.me(player)).withdraw_locked, false);
    await locks.updateLocks({ actor, userId: player, locks: { withdraw: true } });
    assert.equal((await auth.me(player)).withdraw_locked, true);
  });

  await t.test('capabilities.withdraw is false while blocked or system-locked', async () => {
    await reset();
    const open = await auth.me(player);
    assert.equal(open.capabilities.withdraw, true);
    assert.equal(open.system_locked, undefined, 'the system lock is not sent');

    await locks.updateLocks({ actor, userId: player, locks: { withdraw: true } });
    const blockedMe = await auth.me(player);
    assert.equal(blockedMe.capabilities.withdraw, false);
    assert.equal(blockedMe.withdraw_locked, true, 'the separate flag stays, so the site can say why');
    // Only withdraw goes: the rest of the account is untouched.
    assert.equal(blockedMe.capabilities.deposit, true);

    await locks.updateLocks({ actor, userId: player, locks: { withdraw: false } });
    assert.equal((await auth.me(player)).capabilities.withdraw, true);

    await models.Users.update({ system_locked: true }, { where: { id: player } });
    const locked = await auth.me(player);
    assert.equal(locked.capabilities.withdraw, false);
    assert.equal(locked.withdraw_locked, false);
  });

  await t.test('the socket answers a block before it checks the password', async () => {
    await reset();
    const wrongPassword = (uid) =>
      socketWithdraw(
        { wallet: `TQn9Y2khEsLJW1ChVWFMSMeRDow5oREq${uid}`, amount: '30', coin: 'USDT', chain: 'TRC20', password: 'wrong' },
        { userId: uid }
      );

    // Unblocked, a wrong password is still the answer.
    assert.equal((await wrongPassword(player)).error?.code, 'CRYPTO_WITHDRAW_PASSWORD_INCORRECT');

    await locks.updateLocks({ actor, userId: player, locks: { withdraw: true } });
    assert.equal((await wrongPassword(player)).error?.code, 'WITHDRAW_BLOCKED');

    await locks.updateLocks({ actor, userId: player, locks: { withdraw: false } });
    await models.Users.update({ system_locked: true }, { where: { id: player } });
    assert.equal((await wrongPassword(player)).error?.code, 'CRYPTO_WITHDRAW_ACCOUNT_LOCKED');
    await assertNothingMoved(player);
  });

  await t.test('unblocking lets the withdrawals through again', async () => {
    await reset();
    await locks.updateLocks({ actor, userId: player, locks: { withdraw: true } });
    await assert.rejects(fiatWithdraw(player), blocked());

    await locks.updateLocks({ actor, userId: player, locks: { withdraw: false } });
    assert.equal((await auth.me(player)).withdraw_locked, false);

    const f = await fiatWithdraw(player);
    assert.ok(f.withdrawalId);
    const c = await cryptoWithdraw(player);
    assert.ok(c.id);
    const s = await socket(player);
    assert.equal(s.status, true, JSON.stringify(s));
    assert.equal(await models.Withdrawals.count({ where: { uid: player } }), 2);
  });

  await t.test('an agent block covers its players; lifting it keeps a direct block', async () => {
    await reset();
    await locks.updateLocks({ actor, userId: ownLocked, locks: { withdraw: true } });
    const cascade = await locks.updateLocks({ actor, staffId: agent, locks: { withdraw: true } });
    assert.ok(cascade.playersAffected >= 2);

    await assert.rejects(fiatWithdraw(player), blocked());
    await assert.rejects(cryptoWithdraw(ownLocked), blocked());
    const agentRow = await adminDb.models.Staff.findByPk(agent, { raw: true });
    assert.equal(agentRow.withdraw_locked, true);

    await locks.updateLocks({ actor, staffId: agent, locks: { withdraw: false } });

    const f = await fiatWithdraw(player);
    assert.ok(f.withdrawalId, 'the inherited block is lifted');
    await assert.rejects(fiatWithdraw(ownLocked), blocked(), 'the direct block stays');
    await assertNothingMoved(ownLocked);
  });

  await t.test('only the withdraw column cascades', async () => {
    await reset();
    await locks.updateLocks({ actor, staffId: agent, locks: { withdraw: true } });
    const row = await models.Users.findByPk(player, { raw: true });
    assert.equal(row.withdraw_locked, true);
    assert.equal(Boolean(row.casino_locked), false);
    assert.equal(Boolean(row.sports_betlocked), false);
    assert.equal(Boolean(row.system_locked), false);
    assert.deepEqual(row.lock_sources.withdraw_locked, { own: false, by: [String(agent)] });
  });

  await t.test("the owner's Withdrawals switch OFF refuses every rail and /me says withdraw false; ON / absent lets them through", async () => {
    await reset();
    let doc = { withdrawalsEnabled: false };
    entitlements.configureEntitlements({ read: () => doc });
    try {
      const disabled = (error) => {
        assert.equal(error.code, 'WITHDRAW_DISABLED', `${error.code}: ${error.message}`);
        assert.equal(error.statusCode ?? error.status, 403);
        return true;
      };
      await assert.rejects(fiatWithdraw(player), disabled);
      await assert.rejects(cryptoWithdraw(player), disabled);
      await assert.rejects(
        payments.createWithdrawal({ userId: player, provider: 'any', currency: 'INR', amount: '100', details: {} }),
        disabled
      );
      await assert.rejects(
        p2p.createSellOrder({ userId: player, offerId: 1, cryptoAmount: '10', paymentTypeId: 1, accountName: 'x' }),
        disabled
      );
      assert.equal((await auth.me(player)).capabilities.withdraw, false);
      await assertNothingMoved(player);

      doc = { withdrawalsEnabled: true };
      assert.equal((await auth.me(player)).capabilities.withdraw, true);
      assert.ok((await fiatWithdraw(player)).withdrawalId);

      doc = {};
      assert.equal((await auth.me(player)).capabilities.withdraw, true);
      assert.ok((await cryptoWithdraw(player)).id);
    } finally {
      entitlements.resetEntitlements();
    }
  });

  await t.test('a system lock refuses a withdrawal too', async () => {
    await reset();
    await models.Users.update({ system_locked: true }, { where: { id: player } });
    await assert.rejects(fiatWithdraw(player), blocked('system'));
    await assert.rejects(
      payments.createWithdrawal({ userId: player, provider: 'any', currency: 'INR', amount: '100', details: {} }),
      blocked('system')
    );
    // The crypto rail keeps its own refusal for a locked account.
    await assert.rejects(cryptoWithdraw(player), (error) => error.code === 'CRYPTO_WITHDRAW_ACCOUNT_LOCKED');
    await assertNothingMoved(player);
  });
});
