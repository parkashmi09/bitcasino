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

  /**
   * CCPayment's order record, per order id — what `getAppOrderInfo` answers. The webhook only
   * names the order; the money is read from here, as CCPayment's doc requires.
   */
  const orders = new Map();
  const providerCalls = [];
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
    http: {
      raw: async (url, { body } = {}) => {
        providerCalls.push(url);
        if (!url.endsWith('/getAppOrderInfo')) return { code: 10000, data: { coins: [] } };
        const order = orders.get(JSON.parse(body).orderId);
        if (order instanceof Error) throw order;
        return order ? { code: 10000, msg: 'success', data: order } : { code: 11000, msg: 'order not found' };
      },
    },
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
      chain: 'TRX',
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
  const ledgerRows = (uid) => connection.models.CreditsLedger.count({ where: { user_id: String(uid) } });
  const rowOf = (orderId) => connection.models.Ccdeposit.findOne({ where: { orderid: orderId }, raw: true });

  let rec = 0;
  /** One payment in the order's `paidList`. */
  const payment = (amount, overrides = {}) => ({
    recordId: `rec-${process.pid}-${(rec += 1)}`,
    amount,
    serviceFee: '0',
    status: 'Success',
    isFlaggedAsRisky: false,
    ...overrides,
  });
  const paidOrder = (orderId, paidList, coinSymbol = 'USDT') => orders.set(orderId, { coinId: 1280, coinSymbol, chain: 'TRX', paidList });

  // The webhook as CCPayment sends it: no amount, and a status that is only a hint.
  const deposit = (orderId, overrides = {}) => ({
    type: 'ApiDeposit',
    msg: { recordId: 'from-webhook', orderId, coinId: 1280, coinSymbol: 'USDT', status: 'Success', isFlaggedAsRisky: false, ...overrides },
  });

  await t.test('a signed deposit credits what the order record says arrived, with a ledger row', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());
    paidOrder(orderId, [payment('100')]);

    const result = await service.handleWebhook(signed(deposit(orderId)));

    assert.equal(result.credited, true);
    assert.equal(await balance(uid), '100.00000000');
    // Legacy wrote `UPDATE credits SET usdt = usdt + $1` and nothing else, so a
    // crypto deposit appeared on no statement anywhere.
    assert.equal(await ledgerRows(uid), 1);
    const row = await rowOf(orderId);
    assert.equal(row.status, 'Success');
    assert.equal(money.toDecimalString(money.toMinorQuantised(row.amount)), '100.00000000');
  });

  await t.test('an UNDER-payment credits what arrived, not the amount ordered', async () => {
    // The bug this rewrite exists for: the webhook carries no amount, and the
    // old code fell back to the ORDER price — 100 credited for 1 sent.
    const uid = newUid();
    const orderId = await seed(uid, newOrderId(), { price: '100' });
    paidOrder(orderId, [payment('1')]);

    await service.handleWebhook(signed(deposit(orderId)));
    assert.equal(await balance(uid), '1.00000000');
  });

  await t.test('an amount in the webhook body is ignored — only the order record pays', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());
    paidOrder(orderId, [payment('5')]);

    await service.handleWebhook(signed(deposit(orderId, { amount: '999999' })));
    assert.equal(await balance(uid), '5.00000000');
  });

  await t.test('webhook says Success but the order record is still Processing: nothing credited', async () => {
    // CCPayment: "Do not treat the webhook status as the final order status".
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());
    paidOrder(orderId, [payment('100', { status: 'Processing' })]);

    const result = await service.handleWebhook(signed(deposit(orderId)));
    assert.equal(result.credited, false);
    assert.equal(await balance(uid), '0.00000000');
    assert.equal((await rowOf(orderId)).status, 'Processing');
  });

  await t.test('a payment flagged as risky is held, not credited', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());
    paidOrder(orderId, [payment('100', { isFlaggedAsRisky: true })]);

    const result = await service.handleWebhook(signed(deposit(orderId, { isFlaggedAsRisky: true })));
    assert.equal(result.credited, false);
    assert.equal(await balance(uid), '0.00000000');
    assert.equal((await rowOf(orderId)).status, 'Risky');
  });

  await t.test('two payments into one order are both credited, each once', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId(), { price: '100' });
    const first = payment('60');
    paidOrder(orderId, [first]);
    await service.handleWebhook(signed(deposit(orderId)));

    paidOrder(orderId, [first, payment('40')]);
    const second = await service.handleWebhook(signed(deposit(orderId)));
    assert.equal(second.credits.length, 1, 'only the new payment is a new credit');

    await service.handleWebhook(signed(deposit(orderId)));
    assert.equal(await balance(uid), '100.00000000');
    assert.equal(await ledgerRows(uid), 2);
  });

  await t.test('a coin symbol carrying SQL is REFUSED, not interpolated', async () => {
    /**
     * The legacy statement was:
     *
     *     `UPDATE credits SET ${coinSymbolLower} = ${coinSymbolLower} + $1 ...`
     *
     * with `coinSymbol` from the webhook. The coin now comes from the order
     * record, and is still looked up in a fixed map.
     */
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());
    paidOrder(orderId, [payment('100')], 'usdt = 999999, x');

    await assert.rejects(
      () => service.handleWebhook(signed(deposit(orderId))),
      (err) => err.code === 'CRYPTO_UNSUPPORTED_COIN' && err.status === 422
    );

    assert.equal(await balance(uid), '0.00000000');
    assert.equal((await rowOf(orderId)).status, 'Processing', 'and the deposit is untouched');
  });

  await t.test('an unknown coin is refused too', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());
    paidOrder(orderId, [payment('100')], 'SHIB');

    await assert.rejects(
      () => service.handleWebhook(signed(deposit(orderId))),
      (err) => err.code === 'CRYPTO_UNSUPPORTED_COIN'
    );
    assert.equal(await balance(uid), '0.00000000');
  });

  await t.test('an unsigned webhook is rejected', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());
    paidOrder(orderId, [payment('100')]);

    await assert.rejects(
      () => service.handleWebhook({ rawBody: JSON.stringify(deposit(orderId)), signature: '', timestamp: '' }),
      (err) => err.code === 'CRYPTO_BAD_SIGNATURE' && err.status === 401
    );
    assert.equal(await balance(uid), '0.00000000');
  });

  await t.test('a tampered body does not verify', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());
    paidOrder(orderId, [payment('100')]);

    const genuine = signed(deposit(orderId, { status: 'Processing' }));
    // Same signature, different status.
    const tampered = { ...genuine, rawBody: JSON.stringify(deposit(orderId)) };

    await assert.rejects(
      () => service.handleWebhook(tampered),
      (err) => err.code === 'CRYPTO_BAD_SIGNATURE'
    );
    assert.equal(await balance(uid), '0.00000000');
  });

  await t.test('a replayed webhook credits ONCE', async () => {
    // The provider retries; the credit is keyed on CCPayment's recordId.
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());
    paidOrder(orderId, [payment('100')]);

    await service.handleWebhook(signed(deposit(orderId)));
    const second = await service.handleWebhook(signed(deposit(orderId)));

    assert.equal(second.credited, false);
    assert.equal(await balance(uid), '100.00000000');
    assert.equal(await ledgerRows(uid), 1);
  });

  await t.test('two simultaneous webhooks for one order credit once', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());
    paidOrder(orderId, [payment('100')]);

    const results = await Promise.allSettled([
      service.handleWebhook(signed(deposit(orderId))),
      service.handleWebhook(signed(deposit(orderId))),
    ]);

    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal(await balance(uid), '100.00000000');
    assert.equal(await ledgerRows(uid), 1);
  });

  await t.test('a failed payment marks the order Failed, and says so once', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());
    paidOrder(orderId, [payment('100', { status: 'Failed' })]);

    const first = await service.handleWebhook(signed(deposit(orderId, { status: 'Failed' })));
    assert.equal(first.credited, false);
    assert.equal(first.failed, true);
    assert.equal((await rowOf(orderId)).status, 'Failed');

    const again = await service.handleWebhook(signed(deposit(orderId, { status: 'Failed' })));
    assert.equal(again.failed, false, 'the player is told once');
    assert.equal(await balance(uid), '0.00000000');
  });

  await t.test('a webhook for an unknown order is acknowledged, and CCPayment is not asked', async () => {
    const before = providerCalls.length;
    const result = await service.handleWebhook(signed(deposit(newOrderId())));
    assert.equal(result.handled, false);
    assert.equal(result.reason, 'unknown order');
    assert.equal(providerCalls.length, before);
  });

  await t.test('CCPayment unreachable: the webhook fails (so it is retried) and nothing is credited', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId());
    orders.set(orderId, new Error('connect ETIMEDOUT'));

    await assert.rejects(() => service.handleWebhook(signed(deposit(orderId))));
    assert.equal(await balance(uid), '0.00000000');
    assert.equal((await rowOf(orderId)).status, 'Processing');
  });

  await t.test('a deposit amount keeps 8 places, and anything finer is cut, never rounded up', async () => {
    const uid = newUid();
    const orderId = await seed(uid, newOrderId(), { price: '0.00123456' });
    paidOrder(orderId, [payment('0.00123456'), payment('0.000000019')]);

    await service.handleWebhook(signed(deposit(orderId)));
    assert.equal(await balance(uid), '0.00123457');
  });

  await t.test('an event this site does not handle is acknowledged and ignored', async () => {
    const result = await service.handleWebhook(signed({ type: 'ApiRefund', msg: {} }));
    assert.equal(result.handled, false);
    assert.equal(result.type, 'ApiRefund');
  });

  await t.test('a withdrawal event for no order of ours is acknowledged and ignored', async () => {
    assert.equal((await service.handleWebhook(signed({ type: 'ApiWithdrawal', msg: {} }))).reason, 'no order id');
    assert.equal((await service.handleWebhook(signed({ type: 'ApiWithdrawal', msg: { orderId: 'NOT-OURS-1' } }))).reason, 'unknown order');
  });
});
