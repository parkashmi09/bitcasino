'use strict';

const test = require('node:test');
const assert = require('node:assert');
const nodeCrypto = require('node:crypto');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { CryptoService } = require('../crypto.service');
const v = require('../crypto.validators');

/**
 * Crypto deposits arriving.
 *
 * The one thing this file exists to prove: the coin symbol from a webhook body
 * can no longer choose a SQL identifier. Legacy built
 * `SET ${coinSymbol.toLowerCase()} = ...` from it.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 800_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

let seq = 0;
const newOrderId = () => `cc-${process.pid}-${(seq += 1)}`;

const APP_ID = 'test-app-id';
const APP_SECRET = 'test-app-secret';

test('crypto deposits', async (t) => {
  const logger = createLogger({ name: 'crypto-test', level: 'silent' });

  // ══════════════════════════════════════════════════════════════════════
  //  The schema — no database needed
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a coin symbol is enumerated, not pattern-matched', async () => {
    /**
     * The webhook path picks a `credits` column from this same set. A regex
     * would still be a value from outside choosing an identifier.
     */
    const parse = (symbol) => v.coinDetails.query.safeParse({ symbol });
    assert.equal(parse('USDT').success, true);
    assert.equal(parse('usdt = 999999, x').success, false);
    assert.equal(parse('NOTACOIN').success, false);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Against a real database
  // ══════════════════════════════════════════════════════════════════════

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

  const service = new CryptoService({
    models: connection.models,
    db: connection,
    logger,
    config: {
      SERVICE_NAME: 'user-service',
      CCPAYMENT_APP_ID: APP_ID,
      CCPAYMENT_APP_SECRET: APP_SECRET,
      CCPAYMENT_BASE_URL: 'https://ccpayment.test',
    },
    http: { raw: async () => ({ code: 10000, data: { coins: [] } }) },
  });

  /** A signed webhook, exactly as the provider would send it. */
  const signed = (body) => {
    const rawBody = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = nodeCrypto
      .createHmac('sha256', APP_SECRET)
      .update(`${APP_ID}${timestamp}${rawBody}`)
      .digest('hex');
    return { rawBody, signature, timestamp };
  };

  const seed = async (uid, orderId, { price = '100', status = 'Processing' } = {}) => {
    await connection.models.Ccdeposit.destroy({ where: { orderid: orderId } });
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Users.destroy({ where: { id: uid } });

    await connection.models.Users.create({ id: uid, name: `cc-${uid}`, password: 'x', status: 'active' });
    await connection.models.Credits.create({ uid, usdt: '0' });
    await connection.models.Ccdeposit.create({
      userid: String(uid),
      coinid: 1280,
      price,
      orderid: orderId,
      chain: 'TRC20',
      status,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return orderId;
  };

  const balance = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.usdt ?? '0'));
  };

  const deposit = (orderId, overrides = {}) => ({
    type: 'ApiDeposit',
    msg: { orderId, coinSymbol: 'USDT', status: 'Success', amount: '100', ...overrides },
  });

  await t.test('a signed deposit credits once and writes a ledger row', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());

    const result = await service.handleWebhook(signed(deposit(orderId)));

    assert.equal(result.credited, true);
    assert.equal(await balance(uid), '100.00000000');

    // Legacy wrote `UPDATE credits SET usdt = usdt + $1` and nothing else, so a
    // crypto deposit appeared on no statement anywhere.
    const ledger = await connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
    assert.equal(ledger, 1);
  });

  await t.test('a coin symbol carrying SQL is REFUSED, not interpolated', async () => {
    /**
     * The legacy statement was:
     *
     *     `UPDATE credits SET ${coinSymbolLower} = ${coinSymbolLower} + $1 ...`
     *
     * with `coinSymbol` from this body. The amount was parameterised; the
     * column name was not.
     */
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());

    await assert.rejects(
      () => service.handleWebhook(signed(deposit(orderId, { coinSymbol: 'usdt = 999999, x' }))),
      (err) => err.code === 'CRYPTO_UNSUPPORTED_COIN' && err.status === 422
    );

    assert.equal(await balance(uid), '0.00000000');
    const row = await connection.models.Ccdeposit.findOne({ where: { orderid: orderId }, raw: true });
    assert.equal(row.status, 'Processing', 'and the deposit is untouched');
  });

  await t.test('an unknown coin is refused too', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());

    await assert.rejects(
      () => service.handleWebhook(signed(deposit(orderId, { coinSymbol: 'SHIB' }))),
      (err) => err.code === 'CRYPTO_UNSUPPORTED_COIN'
    );
    assert.equal(await balance(uid), '0.00000000');
  });

  await t.test('an unsigned webhook is rejected', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());

    await assert.rejects(
      () => service.handleWebhook({ rawBody: JSON.stringify(deposit(orderId)), signature: '', timestamp: '' }),
      (err) => err.code === 'CRYPTO_BAD_SIGNATURE' && err.status === 401
    );
    assert.equal(await balance(uid), '0.00000000');
  });

  await t.test('a tampered body does not verify', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());

    const genuine = signed(deposit(orderId, { amount: '1' }));
    // Same signature, bigger amount.
    const tampered = { ...genuine, rawBody: JSON.stringify(deposit(orderId, { amount: '999999' })) };

    await assert.rejects(
      () => service.handleWebhook(tampered),
      (err) => err.code === 'CRYPTO_BAD_SIGNATURE'
    );
    assert.equal(await balance(uid), '0.00000000');
  });

  await t.test('a replayed webhook credits ONCE', async () => {
    // The provider retries. Two guards: the final-status check, and an
    // idempotency key derived from the order.
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());

    await service.handleWebhook(signed(deposit(orderId)));
    const second = await service.handleWebhook(signed(deposit(orderId)));

    assert.equal(second.credited, undefined);
    assert.equal(second.reason, 'already settled');
    assert.equal(await balance(uid), '100.00000000');

    const ledger = await connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
    assert.equal(ledger, 1);
  });

  await t.test('two simultaneous webhooks for one order credit once', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());

    const results = await Promise.allSettled([
      service.handleWebhook(signed(deposit(orderId))),
      service.handleWebhook(signed(deposit(orderId))),
    ]);

    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal(await balance(uid), '100.00000000');
  });

  await t.test('a non-success status records without crediting', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());

    const result = await service.handleWebhook(signed(deposit(orderId, { status: 'Processing' })));

    assert.equal(result.credited, false);
    assert.equal(await balance(uid), '0.00000000');
  });

  await t.test('a webhook for an unknown order is acknowledged, not credited', async () => {
    const result = await service.handleWebhook(signed(deposit(newOrderId())));
    assert.equal(result.handled, false);
    assert.equal(result.reason, 'unknown order');
  });

  await t.test('the amount that ARRIVED is credited, not the amount ordered', async () => {
    // Over- and under-payment are both real. Crediting the order amount would
    // pay out money that never landed.
    const uid = newUid();
    const orderId = await seed(uid, newOrderId(), { price: '100' });

    await service.handleWebhook(signed(deposit(orderId, { amount: '97.5' })));
    assert.equal(await balance(uid), '97.50000000');
  });

  await t.test('a deposit amount keeps full precision', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId(), { price: '0.00123456' });

    await service.handleWebhook(signed(deposit(orderId, { amount: '0.00123456' })));
    assert.equal(await balance(uid), '0.00123456');
  });

  await t.test('a non-deposit event is acknowledged and ignored', async () => {
    const result = await service.handleWebhook(signed({ type: 'ApiWithdrawal', msg: {} }));
    assert.equal(result.handled, false);
    assert.equal(result.type, 'ApiWithdrawal');
  });
});
