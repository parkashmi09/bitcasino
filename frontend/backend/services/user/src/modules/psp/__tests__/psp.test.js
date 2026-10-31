'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { PspService } = require('../psp.service');
const { canonicalQuery } = require('../providers');

/**
 * Payment callbacks — what they refuse.
 *
 * These are the highest-stakes tests in the port. The callback endpoint is the
 * only public surface that can increase a balance, and the legacy UPI handler
 * had no authentication on it whatsoever: it credited `req.body.amount` on the
 * strength of `req.body.status`.
 *
 * The forgery cases below are written as an attacker would send them.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const UPI_SECRET = 'upi-shared-secret-for-tests';

let connection;
let psp;

let nextUid = 990_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);
let seq = 0;
const newRef = () => `PSPREF-${process.pid}-${(seq += 1)}`;

/** Sign a UPI body the way a genuine callback would be signed. */
const signUpi = (body) =>
  crypto.createHmac('sha256', UPI_SECRET).update(canonicalQuery(body, { exclude: ['sign', 'signature', 'hash'] })).digest('hex');

test('payment provider callbacks', async (t) => {
  const logger = createLogger({ name: 'psp-test', level: 'silent' });

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

  t.after(async () => {
    if (connection) await connection.close();
  });

  psp = new PspService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service', UPI_WEBHOOK_SECRET: UPI_SECRET },
  });

  const seed = async (uid, inr) => {
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({ id: uid, name: `psp-${uid}`, password: 'x', status: 'active' });
    await connection.models.Credits.create({ uid, inr });
  };

  const balanceOf = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };

  /** A pending UPI deposit awaiting its callback. */
  const pendingDeposit = async (uid, amount) => {
    const reference = newRef();
    await connection.models.Upideposit.create({
      uid, amount, transactioniduser: reference, status: 'pending',
    });
    return reference;
  };

  const callback = (body) => psp.handleCallback({ provider: 'upi', body, ip: '203.0.113.9' });

  // ══════════════════════════════════════════════════════════════════════
  //  The attack the legacy handler was open to
  // ══════════════════════════════════════════════════════════════════════

  await t.test('an UNSIGNED callback is refused — legacy credited it', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const reference = await pendingDeposit(uid, '100');

    // Exactly what legacy accepted: no signature at all.
    await assert.rejects(
      () => callback({ client_txn_id: reference, status: 'success', amount: '1000000' }),
      (err) => err.code === 'PSP_INVALID_SIGNATURE' && err.status === 401
    );

    assert.equal(await balanceOf(uid), '0.00000000', 'no money may move without a valid signature');
  });

  await t.test('a callback with a WRONG signature is refused', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const reference = await pendingDeposit(uid, '100');

    await assert.rejects(
      () => callback({ client_txn_id: reference, status: 'success', amount: '100', sign: 'f'.repeat(64) }),
      (err) => err.code === 'PSP_INVALID_SIGNATURE'
    );

    assert.equal(await balanceOf(uid), '0.00000000');
  });

  await t.test('a signature over DIFFERENT values does not transfer', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const reference = await pendingDeposit(uid, '100');

    // Sign a legitimate 100, then swap the amount to 999999 before sending.
    const honest = { client_txn_id: reference, status: 'success', amount: '100' };
    const sign = signUpi(honest);

    await assert.rejects(
      () => callback({ ...honest, amount: '999999', sign }),
      (err) => err.code === 'PSP_INVALID_SIGNATURE'
    );

    assert.equal(await balanceOf(uid), '0.00000000');
  });

  await t.test('a VALID signature over an inflated amount still fails the amount check', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const reference = await pendingDeposit(uid, '100');

    // The provider itself (or someone holding its key) reporting the wrong
    // figure. We credit OUR record, so a mismatch is refused outright.
    const body = { client_txn_id: reference, status: 'success', amount: '999999' };
    body.sign = signUpi(body);

    await assert.rejects(
      () => callback(body),
      (err) => err.code === 'PSP_AMOUNT_MISMATCH' && err.status === 409
    );

    assert.equal(await balanceOf(uid), '0.00000000');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The happy path, and its guarantees
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a correctly signed callback credits exactly the recorded amount', async () => {
    const uid = newUid();
    await seed(uid, '50');
    const reference = await pendingDeposit(uid, '100');

    const body = { client_txn_id: reference, status: 'success', amount: '100' };
    body.sign = signUpi(body);

    const result = await callback(body);

    assert.equal(result.settled, true);
    assert.equal(await balanceOf(uid), '150.00000000');

    const row = await connection.models.Upideposit.findOne({
      where: { transactioniduser: reference }, raw: true,
    });
    assert.equal(row.status, 'success');
  });

  await t.test('a replayed callback credits once — providers retry for hours', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const reference = await pendingDeposit(uid, '250');

    const body = { client_txn_id: reference, status: 'success', amount: '250' };
    body.sign = signUpi(body);

    const first = await callback(body);
    const second = await callback(body);
    const third = await callback(body);

    assert.equal(first.settled, true);
    assert.equal(second.duplicate, true, 'a repeat must report success so the provider stops retrying');
    assert.equal(third.duplicate, true);

    assert.equal(await balanceOf(uid), '250.00000000', 'the deposit must land exactly once');

    const ledger = await connection.models.CreditsLedger.count({
      where: { user_id: String(uid), reason: 'DEPOSIT' },
    });
    assert.equal(ledger, 1);
  });

  await t.test('concurrent duplicate callbacks credit once', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const reference = await pendingDeposit(uid, '75');

    const body = { client_txn_id: reference, status: 'success', amount: '75' };
    body.sign = signUpi(body);

    await Promise.all(Array.from({ length: 5 }, () => callback(body).catch(() => null)));

    assert.equal(await balanceOf(uid), '75.00000000');
    const ledger = await connection.models.CreditsLedger.count({
      where: { user_id: String(uid), reason: 'DEPOSIT' },
    });
    assert.equal(ledger, 1, 'five simultaneous callbacks must produce one ledger row');
  });

  await t.test('a failure callback records the failure and credits nothing', async () => {
    const uid = newUid();
    await seed(uid, '10');
    const reference = await pendingDeposit(uid, '100');

    const body = { client_txn_id: reference, status: 'failed', amount: '100' };
    body.sign = signUpi(body);

    const result = await callback(body);

    assert.equal(result.settled, false);
    assert.equal(await balanceOf(uid), '10.00000000');
  });

  await t.test('a callback for an unknown transaction is refused', async () => {
    const body = { client_txn_id: 'NOT-A-REAL-REFERENCE', status: 'success', amount: '100' };
    body.sign = signUpi(body);

    await assert.rejects(callback(body), (err) => err.code === 'PSP_TRANSACTION_NOT_FOUND');
  });

  await t.test('an unknown provider is refused', async () => {
    await assert.rejects(
      () => psp.handleCallback({ provider: 'not-a-provider', body: {}, ip: '203.0.113.9' }),
      (err) => err.code === 'PSP_UNKNOWN_PROVIDER'
    );
  });

  await t.test('a provider with no configured secret refuses callbacks rather than opening up', async () => {
    const unconfigured = new PspService({
      models: connection.models,
      db: connection,
      logger,
      config: { SERVICE_NAME: 'user-service' }, // no UPI_WEBHOOK_SECRET
    });

    await assert.rejects(
      () => unconfigured.handleCallback({ provider: 'upi', body: { client_txn_id: 'x' }, ip: '1.2.3.4' }),
      (err) => err.code === 'PSP_PROVIDER_DISABLED' && err.status === 503
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Every provider, against its REAL table
  //
  //  The first version of this module passed all the tests above while being
  //  unable to settle a CricPay or A-Pay payment at all: the CricPay lookup
  //  named a column that does not exist, and both read the settled flag with a
  //  lower-case compare against tables that store 'Successful' and 'Success'.
  //  Testing one provider and assuming the other three follow is what let that
  //  through, so each now settles a real row.
  // ══════════════════════════════════════════════════════════════════════

  const cricpaySecret = {
    CRICPAY_SECRET_KEY: crypto.randomBytes(32).toString('hex'),
    CRICPAY_SECRET_IV: crypto.randomBytes(16).toString('hex'),
    CRICPAY_MERCHANT_CODE: 'CP-TEST',
    CRICPAY_BASE_URL: 'https://cricpay.test',
  };

  /**
   * CricPay's callback proves a payment happened but not WHICH one, so the
   * service confirms the outcome with the provider before crediting. `http`
   * stands in for that call.
   *
   * By default it confirms whatever was asked about, for ₹100 — the tests that
   * care override it.
   */
  const cricpayService = (confirmations = {}) =>
    new PspService({
      models: connection.models,
      db: connection,
      logger,
      config: { SERVICE_NAME: 'user-service', ...cricpaySecret },
      http: {
        async post(_url, body) {
          const answer = confirmations[body.transaction_code];
          if (answer === null) throw new Error('provider unreachable');
          return answer ?? { statusCode: 'Success', trn_status: 'Successful', trn_amount: '100' };
        },
        async get() { return null; },
      },
    });

  /** Build a CricPay callback the way the gateway does: AES-256-CBC, hex. */
  const cricpayBody = (transactionCode, { status = 1, amount = '100' } = {}) => {
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(cricpaySecret.CRICPAY_SECRET_KEY, 'hex'),
      Buffer.from(cricpaySecret.CRICPAY_SECRET_IV, 'hex')
    );
    const plain = new URLSearchParams({
      transaction_status: String(status),
      transaction_amount: String(amount),
      transaction_fee: '0',
      remark: 'test',
    }).toString();
    let data = cipher.update(plain, 'utf8', 'hex');
    data += cipher.final('hex');
    return { transaction_code: transactionCode, data };
  };

  await t.test('cricpay settles a real row — the lookup column had to be right', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const code = newRef();
    await connection.models.Cricpaytransactions.create({
      uid, transaction_code: code, amount: '100', payment_method: 'UPI', status: 'Pending',
    });

    const service = cricpayService();

    const result = await service.handleCallback({
      provider: 'cricpay', body: cricpayBody(code), ip: '203.0.113.9',
    });

    assert.equal(result.settled, true);
    assert.equal(await balanceOf(uid), '100.00000000');

    const row = await connection.models.Cricpaytransactions.findOne({
      where: { transaction_code: code }, raw: true,
    });
    // 'Successful' — the spelling the legacy admin screens filter on. Writing
    // 'success' here would make the row invisible to them.
    assert.equal(row.status, 'Successful');
  });

  await t.test('a settled cricpay row is recognised as settled — "Successful", not "success"', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const code = newRef();
    await connection.models.Cricpaytransactions.create({
      uid, transaction_code: code, amount: '100', payment_method: 'UPI', status: 'Successful',
    });

    const service = cricpayService();

    const result = await service.handleCallback({
      provider: 'cricpay', body: cricpayBody(code), ip: '203.0.113.9',
    });

    assert.equal(result.duplicate, true, 'an already-settled row must not settle again');
    assert.equal(await balanceOf(uid), '0.00000000', 'a case mismatch here is a second credit');
  });

  await t.test('a cricpay status of 0 is a failure — the status is numeric', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const code = newRef();
    await connection.models.Cricpaytransactions.create({
      uid, transaction_code: code, amount: '100', payment_method: 'UPI', status: 'Pending',
    });

    // The provider agrees it failed.
    const service = cricpayService({ [code]: { statusCode: 'Success', trn_status: 'Failed' } });

    const result = await service.handleCallback({
      provider: 'cricpay', body: cricpayBody(code, { status: 0 }), ip: '203.0.113.9',
    });

    assert.equal(result.settled, false);
    assert.equal(await balanceOf(uid), '0.00000000');
  });

  await t.test('a CAPTURED cricpay payload cannot settle a transaction the provider has not paid', async () => {
    // The attack this provider is exposed to. CricPay's encrypted blob names an
    // amount and a status but NOT which transaction — the transaction is named
    // by the plaintext field beside it. So a player who keeps one valid blob can
    // point it at any later deposit and the signature still verifies.
    //
    // A payload-digest guard cannot catch this: the encryption is deterministic,
    // so two honest ₹100 deposits produce byte-identical blobs and the guard
    // would reject real payments. What catches it is asking CricPay.
    const uid = newUid();
    await seed(uid, '0');

    const first = newRef();
    const second = newRef();
    for (const code of [first, second]) {
      await connection.models.Cricpaytransactions.create({
        uid, transaction_code: code, amount: '100', payment_method: 'UPI', status: 'Pending',
      });
    }

    // CricPay has been paid for `first` only. `second` is still outstanding.
    const service = cricpayService({
      [first]: { statusCode: 'Success', trn_status: 'Successful', trn_amount: '100' },
      [second]: { statusCode: 'Success', trn_status: 'Pending' },
    });

    const captured = cricpayBody(first);
    await service.handleCallback({ provider: 'cricpay', body: captured, ip: '203.0.113.9' });
    assert.equal(await balanceOf(uid), '100.00000000');

    // Same blob, repointed at the unpaid transaction.
    const result = await service.handleCallback({
      provider: 'cricpay',
      body: { transaction_code: second, data: captured.data },
      ip: '203.0.113.9',
    });

    assert.equal(result.settled, false, 'the provider does not confirm it, so it does not settle');
    assert.equal(await balanceOf(uid), '100.00000000', 'the replay must not credit a second time');
  });

  await t.test('two honest cricpay deposits of the SAME amount both settle', async () => {
    // The other half of the same problem, and the reason the digest guard is
    // not applied to this provider: identical plaintext encrypts to identical
    // bytes, so a "seen this payload before" rule would refuse the second real
    // payment of the same amount.
    const uid = newUid();
    await seed(uid, '0');

    const first = newRef();
    const second = newRef();
    for (const code of [first, second]) {
      await connection.models.Cricpaytransactions.create({
        uid, transaction_code: code, amount: '100', payment_method: 'UPI', status: 'Pending',
      });
    }

    const service = cricpayService();

    // Byte-identical blobs — deterministic AES with a fixed IV.
    assert.equal(cricpayBody(first).data, cricpayBody(second).data);

    await service.handleCallback({ provider: 'cricpay', body: cricpayBody(first), ip: '203.0.113.9' });
    await service.handleCallback({ provider: 'cricpay', body: cricpayBody(second), ip: '203.0.113.9' });

    assert.equal(await balanceOf(uid), '200.00000000', 'both genuine deposits must land');
  });

  await t.test('an unreachable provider does not settle — and does not lose the payment', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const code = newRef();
    await connection.models.Cricpaytransactions.create({
      uid, transaction_code: code, amount: '100', payment_method: 'UPI', status: 'Pending',
    });

    const service = cricpayService({ [code]: null }); // throws inside confirm()

    await assert.rejects(
      () => service.handleCallback({ provider: 'cricpay', body: cricpayBody(code), ip: '203.0.113.9' }),
      // 5xx on purpose: gateways retry 5xx and give up on 4xx, and giving up is
      // the wrong outcome for a payment that may well be real.
      (err) => err.code === 'PSP_CONFIRMATION_FAILED' && err.status === 503
    );

    assert.equal(await balanceOf(uid), '0.00000000');

    const row = await connection.models.Cricpaytransactions.findOne({
      where: { transaction_code: code }, raw: true,
    });
    assert.equal(row.status, 'Pending', 'the transaction stays open for the retry');
  });

  await t.test('apay settles a real row and writes the spelling that table uses', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const reference = newRef();

    await connection.models.Apaydeposits.create({
      order_id: `ORD-${reference}`, user_id: uid, amount: '250', currency: 'INR',
      payment_system: 'phonepe', custom_transaction_id: reference, status: 'Pending',
    });

    const accessKey = 'apay-access-key';
    const privateKey = 'apay-private-key';
    const transactions = [{
      order_id: `ORD-${reference}`, status: 'success', amount: '250',
      custom_user_id: String(uid), currency: 'INR', custom_transaction_id: reference,
    }];
    const transactionsJson = JSON.stringify(transactions);
    const signature = crypto
      .createHash('sha1')
      .update(`${accessKey}${privateKey}${crypto.createHash('md5').update(transactionsJson).digest('hex')}`)
      .digest('hex');

    const service = new PspService({
      models: connection.models, db: connection, logger,
      config: {
        SERVICE_NAME: 'user-service',
        APAY_WEBHOOK_ACCESS_KEY: accessKey,
        APAY_WEBHOOK_PRIVATE_KEY: privateKey,
      },
    });

    const result = await service.handleCallback({
      provider: 'apay',
      body: { access_key: accessKey, signature, transactions: transactionsJson },
      ip: '203.0.113.9',
    });

    assert.equal(result.settled, true);
    assert.equal(await balanceOf(uid), '250.00000000');

    const row = await connection.models.Apaydeposits.findOne({
      where: { custom_transaction_id: reference }, raw: true,
    });
    assert.equal(row.status, 'Success');
  });

  await t.test('a settled apay row is recognised as settled — "Success", not "success"', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const reference = newRef();

    await connection.models.Apaydeposits.create({
      order_id: `ORD-${reference}`, user_id: uid, amount: '250', currency: 'INR',
      payment_system: 'phonepe', custom_transaction_id: reference, status: 'Success',
    });

    const accessKey = 'apay-access-key';
    const privateKey = 'apay-private-key';
    const transactions = [{
      order_id: `ORD-${reference}`, status: 'success', amount: '250',
      custom_user_id: String(uid), currency: 'INR', custom_transaction_id: reference,
    }];
    const transactionsJson = JSON.stringify(transactions);
    const signature = crypto
      .createHash('sha1')
      .update(`${accessKey}${privateKey}${crypto.createHash('md5').update(transactionsJson).digest('hex')}`)
      .digest('hex');

    const service = new PspService({
      models: connection.models, db: connection, logger,
      config: {
        SERVICE_NAME: 'user-service',
        APAY_WEBHOOK_ACCESS_KEY: accessKey,
        APAY_WEBHOOK_PRIVATE_KEY: privateKey,
      },
    });

    const result = await service.handleCallback({
      provider: 'apay',
      body: { access_key: accessKey, signature, transactions: transactionsJson },
      ip: '203.0.113.9',
    });

    assert.equal(result.duplicate, true);
    assert.equal(await balanceOf(uid), '0.00000000');
  });

  await t.test('waypay settles a real row and writes the numeric status', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const reference = newRef();
    const merchantKey = 'waypay-merchant-key';

    await connection.models.PayInTransactions.create({
      user_id: uid, transaction_id: `TX-${reference}`, out_trade_no: reference,
      currency: 'INR', amount: '500', status: 0, pay_type: 'UPI',
    });

    const body = { out_trade_no: reference, status: '1', money: '500', mchId: '2591' };
    body.sign = crypto
      .createHash('md5')
      .update(`${canonicalQuery(body)}&key=${merchantKey}`)
      .digest('hex');

    const service = new PspService({
      models: connection.models, db: connection, logger,
      config: { SERVICE_NAME: 'user-service', WAYPAY_MERCHANT_KEY: merchantKey },
    });

    const result = await service.handleCallback({ provider: 'waypay', body, ip: '203.0.113.9' });

    assert.equal(result.settled, true);
    assert.equal(await balanceOf(uid), '500.00000000');

    const row = await connection.models.PayInTransactions.findOne({
      where: { out_trade_no: reference }, raw: true,
    });
    assert.equal(Number(row.status), 1, 'this table stores a number, not a word');
  });

  await t.test('a refused callback is recorded but does not burn its digest', async () => {
    // A failure notice and the success that follows it share a body shape.
    // If a rejection reserved the digest, the genuine retry would be refused
    // as a replay — so only accepted callbacks may claim one.
    const uid = newUid();
    await seed(uid, '0');
    const reference = await pendingDeposit(uid, '100');

    await assert.rejects(
      () => callback({ client_txn_id: reference, status: 'success', amount: '100', sign: 'f'.repeat(64) }),
      (err) => err.code === 'PSP_INVALID_SIGNATURE'
    );

    const refused = await connection.models.PspCallbackLog.findOne({
      where: { reference: null, provider: 'upi', accepted: false, rejection_code: 'INVALID_SIGNATURE' },
      order: [['id', 'DESC']],
      raw: true,
    });
    assert.ok(refused, 'a refused callback must leave evidence');

    // The genuine one still lands.
    const body = { client_txn_id: reference, status: 'success', amount: '100' };
    body.sign = signUpi(body);
    const result = await callback(body);
    assert.equal(result.settled, true);
    assert.equal(await balanceOf(uid), '100.00000000');
  });

  await t.test('the stored audit row does not keep the provider access key', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const reference = await pendingDeposit(uid, '30');

    const body = { client_txn_id: reference, status: 'success', amount: '30', access_key: 'super-secret' };
    body.sign = signUpi(body);
    await callback(body);

    const row = await connection.models.PspCallbackLog.findOne({
      where: { reference, accepted: true }, raw: true,
    });
    assert.ok(row, 'an accepted callback is recorded');
    assert.equal(row.payload.access_key, undefined, 'the access key must not be stored');
    assert.ok(row.payload.sign, 'the signature is evidence and stays');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Payout callbacks — where doing nothing is the bug
  // ══════════════════════════════════════════════════════════════════════

  const apayKeys = { APAY_WEBHOOK_ACCESS_KEY: 'apay-access-key', APAY_WEBHOOK_PRIVATE_KEY: 'apay-private-key' };

  const apayBody = (transactions) => {
    const json = JSON.stringify(transactions);
    return {
      access_key: apayKeys.APAY_WEBHOOK_ACCESS_KEY,
      signature: crypto
        .createHash('sha1')
        .update(
          `${apayKeys.APAY_WEBHOOK_ACCESS_KEY}${apayKeys.APAY_WEBHOOK_PRIVATE_KEY}` +
            crypto.createHash('md5').update(json).digest('hex')
        )
        .digest('hex'),
      transactions: json,
    };
  };

  const apayService = () =>
    new PspService({
      models: connection.models, db: connection, logger,
      config: { SERVICE_NAME: 'user-service', ...apayKeys },
    });

  const pendingPayout = async (uid, amount) => {
    const reference = newRef();
    await connection.models.Apaywithdrawals.create({
      order_id: reference, user_id: String(uid), amount, currency: 'INR',
      payment_system: 'imps', custom_transaction_id: reference, status: 'Pending', refunded: false,
    });
    return reference;
  };

  await t.test('a FAILED payout refunds the held balance', async () => {
    // The balance was debited when the payout was requested. If this callback
    // is ignored the player is simply out of pocket with nothing to show for
    // it — no error, no record, no way for them to notice except the number.
    const uid = newUid();
    await seed(uid, '0');
    const reference = await pendingPayout(uid, '500');

    const result = await apayService().handlePayoutCallback({
      provider: 'apay',
      body: apayBody([{ order_id: reference, custom_transaction_id: reference, status: 'Failed', amount: '500' }]),
      ip: '203.0.113.9',
    });

    assert.equal(result.refunded, true);
    assert.equal(await balanceOf(uid), '500.00000000');

    const row = await connection.models.Apaywithdrawals.findOne({
      where: { custom_transaction_id: reference }, raw: true,
    });
    assert.equal(row.refunded, true);
  });

  await t.test('a SUCCESSFUL payout refunds nothing — the money already left', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const reference = await pendingPayout(uid, '500');

    const result = await apayService().handlePayoutCallback({
      provider: 'apay',
      body: apayBody([{ order_id: reference, custom_transaction_id: reference, status: 'success', amount: '500' }]),
      ip: '203.0.113.9',
    });

    assert.equal(result.settled, true);
    assert.equal(await balanceOf(uid), '0.00000000', 'crediting here would pay the player twice');
  });

  await t.test('repeated failure callbacks refund exactly once', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const reference = await pendingPayout(uid, '250');

    const body = apayBody([
      { order_id: reference, custom_transaction_id: reference, status: 'Failed', amount: '250' },
    ]);
    const service = apayService();

    await service.handlePayoutCallback({ provider: 'apay', body, ip: '203.0.113.9' });
    await service.handlePayoutCallback({ provider: 'apay', body, ip: '203.0.113.9' });
    await service.handlePayoutCallback({ provider: 'apay', body, ip: '203.0.113.9' });

    assert.equal(await balanceOf(uid), '250.00000000', 'a provider retrying must not multiply the refund');
  });

  await t.test('the refund is OUR recorded amount, not the callback’s', async () => {
    // Reversed polarity from a deposit: here an inflated figure OVERPAYS.
    const uid = newUid();
    await seed(uid, '0');
    const reference = await pendingPayout(uid, '100');

    await apayService().handlePayoutCallback({
      provider: 'apay',
      body: apayBody([
        { order_id: reference, custom_transaction_id: reference, status: 'Failed', amount: '999999' },
      ]),
      ip: '203.0.113.9',
    });

    assert.equal(await balanceOf(uid), '100.00000000');
  });

  await t.test('an unsigned payout callback refunds nothing', async () => {
    const uid = newUid();
    await seed(uid, '0');
    const reference = await pendingPayout(uid, '100');

    await assert.rejects(
      () => apayService().handlePayoutCallback({
        provider: 'apay',
        body: { transactions: JSON.stringify([{ custom_transaction_id: reference, status: 'Failed' }]) },
        ip: '203.0.113.9',
      }),
      (err) => err.code === 'PSP_INVALID_SIGNATURE'
    );

    assert.equal(await balanceOf(uid), '0.00000000');
  });

  await t.test('a player cannot read another player transaction status', async () => {
    const owner = newUid();
    const attacker = newUid();
    await seed(owner, '0');
    await seed(attacker, '0');
    const reference = await pendingDeposit(owner, '100');

    await assert.rejects(
      () => psp.getStatus({ provider: 'upi', reference, userId: attacker }),
      (err) => err.code === 'PSP_TRANSACTION_NOT_FOUND'
    );

    const own = await psp.getStatus({ provider: 'upi', reference, userId: owner });
    assert.equal(own.reference, reference);
  });
});
