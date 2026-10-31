'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');
const { EVENTS } = require('@ibitplay/socket');

const sockets = require('../sockets');
const { CryptoWithdrawService } = require('../cryptoWithdraw.service');
const { STATUS } = require('../cryptoWithdraw.constants');
const { WalletService } = require('../../wallet/wallet.service');
const { REASON } = require('../../wallet/wallet.constants');

/**
 * The socket withdrawal (`C.SUBMIT_NEW_WITHDRAWL`) and the queue that decides it.
 *
 * The socket used to debit `credits` with a raw UPDATE — no ledger row, so
 * `reconcile` drifted for every player who withdrew — and insert the row as
 * `'pending'`, a status the state machine does not know, so staff could never
 * approve or reject it. It now goes through `CryptoWithdrawService.request`,
 * the same guarded `WalletService.debit` hold the fiat rail uses.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const PASSWORD = 'socket-withdraw-test-pass';

let nextUid = 906_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('crypto withdrawals through the socket', async (t) => {
  const logger = createLogger({ name: 'crypto-withdraw-socket-test', level: 'silent' });

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
  t.after(async () => connection.close());

  const { models } = connection;
  const config = { SERVICE_NAME: 'user-service', WITHDRAW_MINIMUM: '1', WITHDRAW_REQUIRE_KYC: false };
  const deps = { models, db: connection, logger, config };

  const handlerFor = (handlerDeps) => {
    const registered = new Map();
    sockets.register({ on: (event, spec) => registered.set(event, spec), deps: handlerDeps });
    return registered.get(EVENTS.SUBMIT_NEW_WITHDRAWL).handle;
  };
  const withdraw = handlerFor(deps);

  const service = new CryptoWithdrawService(deps);
  const wallet = new WalletService(deps);
  const staff = { id: 77 };
  const passwordHash = await hashPassword(PASSWORD, 4);

  /** A player funded through the wallet, so the ledger explains the balance. */
  const seedPlayer = async (uid, { usdt = '100' } = {}) => {
    await models.Withdrawals.destroy({ where: { uid } });
    await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });

    await models.Users.create({ id: uid, name: `cws-${uid}`, password: passwordHash, status: 'active' });
    await models.Credits.create({ uid, usdt: '0' });
    if (money.gt(usdt, '0')) {
      await wallet.credit(
        { userId: uid, currency: 'USDT', amount: usdt, reason: REASON.DEPOSIT, idempotencyKey: `cws-seed:${uid}` },
        { sourceService: 'test' }
      );
    }
  };

  const request = (uid, overrides = {}) =>
    withdraw(
      {
        wallet: `TQn9Y2khEsLJW1ChVWFMSMeRDow5oREq${uid}`,
        amount: '40',
        coin: 'USDT',
        chain: 'TRC20',
        password: PASSWORD,
        ...overrides,
      },
      { userId: uid }
    );

  const balanceOf = async (uid) => {
    const row = await models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.usdt ?? '0'));
  };

  await t.test('the socket debit writes a WITHDRAWAL ledger hold and the wallet reconciles', async () => {
    const uid = newUid();
    await seedPlayer(uid);

    const result = await request(uid);
    assert.equal(result.status, true, JSON.stringify(result));
    assert.ok(result.id);

    assert.equal(await balanceOf(uid), '60.00000000');

    const holds = await models.CreditsLedger.findAll({
      where: { user_id: String(uid), reason: REASON.WITHDRAWAL },
      raw: true,
    });
    assert.equal(holds.length, 1, 'the debit must be on the ledger');
    assert.equal(holds[0].currency, 'USDT');
    assert.equal(money.toDecimalString(money.toMinor(holds[0].amount)), '-40.00000000');

    const rec = await wallet.reconcile({ userId: uid, currency: 'USDT' });
    assert.equal(rec.balanced, true, `drift ${rec.drift}`);
  });

  await t.test('the row is created In Queue with an upper-case coin', async () => {
    const uid = newUid();
    await seedPlayer(uid);

    const result = await request(uid, { coin: 'usdt' });
    assert.equal(result.status, true, JSON.stringify(result));

    const row = await models.Withdrawals.findByPk(result.id, { raw: true });
    assert.equal(row.status, STATUS.IN_QUEUE);
    assert.equal(row.coin, 'USDT');
  });

  await t.test('a socket withdrawal can be approved and then sent', async () => {
    const uid = newUid();
    await seedPlayer(uid);
    const { id } = await request(uid);

    await service.decide({ withdrawalId: id, status: STATUS.APPROVED }, staff);
    const sent = await service.decide(
      { withdrawalId: id, status: STATUS.SENT, txid: String(uid).padStart(64, '7') },
      staff
    );
    assert.equal(sent.status, STATUS.SENT);
    assert.equal(sent.refunded, false);
    assert.equal(await balanceOf(uid), '60.00000000');
    assert.equal((await wallet.reconcile({ userId: uid, currency: 'USDT' })).balanced, true);
  });

  await t.test('a socket withdrawal can be rejected and the hold comes back', async () => {
    const uid = newUid();
    await seedPlayer(uid);
    const { id } = await request(uid);

    const result = await service.decide({ withdrawalId: id, status: STATUS.REJECTED }, staff);
    assert.equal(result.refunded, true);
    assert.equal(await balanceOf(uid), '100.00000000');
    assert.equal((await wallet.reconcile({ userId: uid, currency: 'USDT' })).balanced, true);
  });

  await t.test('a lower-case coin row is refunded under the upper-case currency', async () => {
    // Rows the old socket path wrote carry `coin = 'usdt'`.
    const uid = newUid();
    await seedPlayer(uid);
    await wallet.debit(
      { userId: uid, currency: 'USDT', amount: '30', reason: REASON.WITHDRAWAL, idempotencyKey: `cws-legacy-hold:${uid}` },
      { sourceService: 'test' }
    );
    const row = await models.Withdrawals.create({
      uid, amount: '30', coin: 'usdt', chain: 'TRC20', wallet: `T-legacy-${uid}`, status: STATUS.IN_QUEUE, date: new Date(),
    });

    await service.decide({ withdrawalId: row.id, status: STATUS.REJECTED }, staff);

    const refund = await models.CreditsLedger.findOne({
      where: { user_id: String(uid), reason: REASON.WITHDRAWAL_REVERSAL },
      raw: true,
    });
    assert.equal(refund.currency, 'USDT');
    const rec = await wallet.reconcile({ userId: uid, currency: 'USDT' });
    assert.equal(rec.balanced, true, `drift ${rec.drift}`);
  });

  await t.test('a double-submitted request holds once and makes one row', async () => {
    const uid = newUid();
    await seedPlayer(uid);

    const first = await request(uid);
    const second = await request(uid);
    assert.equal(first.status, true);
    assert.equal(second.status, true);
    assert.equal(String(second.id), String(first.id));

    assert.equal(await models.Withdrawals.count({ where: { uid } }), 1);
    assert.equal(await balanceOf(uid), '60.00000000');
    assert.equal((await wallet.reconcile({ userId: uid, currency: 'USDT' })).balanced, true);
  });

  await t.test('two submits at the same moment hold once and answer with one row', async () => {
    const uid = newUid();
    await seedPlayer(uid);

    const [a, b] = await Promise.all([request(uid), request(uid)]);
    assert.equal(a.status, true, JSON.stringify(a));
    assert.equal(b.status, true, JSON.stringify(b));
    assert.equal(String(a.id), String(b.id));

    assert.equal(await models.Withdrawals.count({ where: { uid } }), 1);
    assert.equal(await balanceOf(uid), '60.00000000');
    assert.equal((await wallet.reconcile({ userId: uid, currency: 'USDT' })).balanced, true);
  });

  await t.test('not enough balance is refused with no row and no ledger hold', async () => {
    const uid = newUid();
    await seedPlayer(uid, { usdt: '10' });

    const result = await request(uid, { amount: '40' });
    assert.equal(result.error?.code, 'CRYPTO_WITHDRAW_INSUFFICIENT_BALANCE');
    assert.equal(await models.Withdrawals.count({ where: { uid } }), 0);
    assert.equal(await models.CreditsLedger.count({ where: { user_id: String(uid), reason: REASON.WITHDRAWAL } }), 0);
    assert.equal(await balanceOf(uid), '10.00000000');
  });

  await t.test('below the withdrawal minimum is refused', async () => {
    const uid = newUid();
    await seedPlayer(uid);

    const result = await request(uid, { amount: '0.5' });
    assert.equal(result.error?.code, 'CRYPTO_WITHDRAW_BELOW_MINIMUM');
    assert.equal(await balanceOf(uid), '100.00000000');
  });

  await t.test('an unverified player is refused when KYC is required, as on the fiat rail', async () => {
    const uid = newUid();
    await seedPlayer(uid);
    await models.UserKyc.destroy({ where: { user_id: String(uid) } });

    const strict = handlerFor({ ...deps, config: { ...config, WITHDRAW_REQUIRE_KYC: true } });
    const result = await strict(
      { wallet: `T-kyc-${uid}`, amount: '40', coin: 'USDT', password: PASSWORD },
      { userId: uid }
    );
    assert.equal(result.error?.code, 'CRYPTO_WITHDRAW_KYC_REQUIRED');
    assert.equal(await balanceOf(uid), '100.00000000');
  });

  await t.test('a wrong password still moves nothing', async () => {
    const uid = newUid();
    await seedPlayer(uid);

    const result = await request(uid, { password: 'wrong' });
    assert.equal(result.error?.code, 'CRYPTO_WITHDRAW_PASSWORD_INCORRECT');
    assert.equal(await balanceOf(uid), '100.00000000');
  });

  await t.test('a closed site policy is answered before the password is checked', async () => {
    const uid = newUid();
    await seedPlayer(uid);

    // The site pays out through the gateway only: the socket's manual route is closed.
    // Stubbed on a copy of the models, so the shared site_features row is never touched.
    const gatewayOnly = Object.create(models, {
      SiteFeature: { value: { findByPk: async () => ({ variant: 'automatic' }) } },
    });
    const closed = handlerFor({ ...deps, models: gatewayOnly });

    const result = await closed(
      { wallet: `T-policy-${uid}`, amount: '40', coin: 'USDT', chain: 'TRC20', password: 'wrong' },
      { userId: uid }
    );
    assert.equal(result.error?.code, 'SITE_POLICY_CHANNEL_CLOSED', JSON.stringify(result));
    assert.equal(await models.Withdrawals.count({ where: { uid } }), 0);
    assert.equal(await balanceOf(uid), '100.00000000');
  });
});
