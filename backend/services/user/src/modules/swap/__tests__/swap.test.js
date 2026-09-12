'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { SwapService } = require('../swap.service');
const { feeRateFor } = require('../swap.constants');
const { resolveColumn } = require('../../wallet/wallet.constants');

/**
 * Swap correctness, against a real PostgreSQL.
 *
 * The legacy swap was the single most dangerous piece of code in the codebase:
 * it interpolated the request's currency straight into
 * `UPDATE credits SET ${currency} = ...` and had no authentication. These tests
 * cover both the injection surface and the arithmetic that replaced its float
 * maths.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;
let service;

let nextUid = 940_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('swap', async (t) => {
  const logger = createLogger({ name: 'swap-test', level: 'silent' });

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

  service = new SwapService({
    models: connection.models,
    db: connection,
    config: { SERVICE_NAME: 'user-service' },
    logger,
  });

  // Rates: 1 INR = 0.012 USD, 1 USDT = 1 USD.
  await connection.models.Exchangerate.destroy({ where: { currency: ['INR', 'USDT'] } });
  await connection.models.Exchangerate.bulkCreate([
    { currency: 'INR', usd_rate: '0.012', last_updated: new Date() },
    { currency: 'USDT', usd_rate: '1', last_updated: new Date() },
  ]);

  const seed = async (uid, columns) => {
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Credits.create({ uid, ...columns });
  };

  const balances = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return {
      INR: money.toDecimalString(money.toMinor(row?.inr ?? '0')),
      USDT: money.toDecimalString(money.toMinor(row?.usdt ?? '0')),
    };
  };

  // ══════════════════════════════════════════════════════════════════════

  await t.test('the currency allow-list rejects an injection attempt', async () => {
    // The exact shape the legacy controller would have executed.
    const attacks = [
      'inr, usdt = 999999 --',
      'inr"; UPDATE credits SET usdt = 1000; --',
      'constructor',
      '__proto__',
      'INR OR 1=1',
    ];

    for (const attack of attacks) {
      assert.throws(() => resolveColumn(attack), /Unsupported currency/, `must reject: ${attack}`);
    }

    // And the legitimate values still resolve.
    assert.equal(resolveColumn('INR'), 'inr');
    assert.equal(resolveColumn('usdt'), 'usdt');
  });

  await t.test('a swap debits the source in full and credits the converted remainder', async () => {
    const uid = newUid();
    await seed(uid, { inr: '10000', usdt: '0' });

    const result = await service.swap({
      userId: uid, fromCurrency: 'INR', toCurrency: 'USDT', amount: '1000',
    });

    // INR fee is 15%: 1000 -> 150 fee -> 850 converted.
    // 850 INR * 0.012 = 10.2 USD / 1 = 10.2 USDT.
    assert.equal(result.feeAmount, '150.00000000');
    assert.equal(result.amountAfterFee, '850.00000000');
    assert.equal(result.toAmount, '10.20000000');

    const after = await balances(uid);
    assert.equal(after.INR, '9000.00000000', 'the FULL amount leaves the source currency');
    assert.equal(after.USDT, '10.20000000');
  });

  await t.test('the 0.15 fee is exact — no float drift', async () => {
    const uid = newUid();
    await seed(uid, { inr: '10000', usdt: '0' });

    // 0.15 is not representable in binary floating point. 3333 * 0.15 in a
    // double is 499.95000000000005; the fee must be exactly 499.95.
    const estimate = await service.estimate({
      fromCurrency: 'INR', toCurrency: 'USDT', amount: '3333',
    });

    assert.equal(estimate.feeAmount, '499.95000000');
    assert.equal(estimate.amountAfterFee, '2833.05000000');
  });

  await t.test('fee rates are per-currency', async () => {
    assert.equal(feeRateFor('INR'), '0.15');
    assert.equal(feeRateFor('BJB'), '0');
    assert.equal(feeRateFor('USDT'), '0.01');
    assert.equal(feeRateFor('unknown'), '0.01');
  });

  await t.test('an insufficient balance leaves both currencies untouched', async () => {
    const uid = newUid();
    await seed(uid, { inr: '100', usdt: '5' });

    await assert.rejects(
      () => service.swap({ userId: uid, fromCurrency: 'INR', toCurrency: 'USDT', amount: '1000' }),
      (err) => err.code === 'SWAP_INSUFFICIENT_BALANCE'
    );

    const after = await balances(uid);
    assert.equal(after.INR, '100.00000000');
    assert.equal(after.USDT, '5.00000000', 'the credit leg must roll back with the debit');
  });

  await t.test('a swap that would round to zero is refused', async () => {
    const uid = newUid();
    await seed(uid, { inr: '1', usdt: '0' });

    // 0.00000001 INR after fee converts to less than one satoshi of USDT.
    // Legacy would have taken the input and credited nothing.
    await assert.rejects(
      () => service.swap({ userId: uid, fromCurrency: 'INR', toCurrency: 'USDT', amount: '0.00000001' }),
      (err) => err.code === 'SWAP_AMOUNT_TOO_SMALL'
    );

    const after = await balances(uid);
    assert.equal(after.INR, '1.00000000', 'nothing may be taken when nothing is given');
  });

  await t.test('swapping a currency into itself is refused', async () => {
    const uid = newUid();
    await seed(uid, { inr: '100' });

    await assert.rejects(
      () => service.swap({ userId: uid, fromCurrency: 'INR', toCurrency: 'INR', amount: '10' }),
      (err) => err.code === 'SWAP_SAME_CURRENCY'
    );
  });

  await t.test('a missing rate is refused rather than converting at zero', async () => {
    const uid = newUid();
    await seed(uid, { inr: '100', doge: '0' });
    await connection.models.Exchangerate.destroy({ where: { currency: 'DOGE' } });

    await assert.rejects(
      () => service.swap({ userId: uid, fromCurrency: 'INR', toCurrency: 'DOGE', amount: '10' }),
      (err) => err.code === 'SWAP_RATE_UNAVAILABLE'
    );

    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    assert.equal(money.toDecimalString(money.toMinor(row.inr)), '100.00000000');
  });

  await t.test('both legs land on the ledger so each currency reconciles', async () => {
    const uid = newUid();
    await seed(uid, { inr: '10000', usdt: '0' });

    await service.swap({ userId: uid, fromCurrency: 'INR', toCurrency: 'USDT', amount: '1000' });

    const rows = await connection.models.CreditsLedger.findAll({
      where: { user_id: String(uid) }, raw: true,
    });

    assert.equal(rows.length, 2, 'one ledger row per leg');

    const inrLeg = rows.find((r) => r.currency === 'INR');
    const usdtLeg = rows.find((r) => r.currency === 'USDT');

    assert.equal(money.toDecimalString(money.toMinor(inrLeg.amount)), '-1000.00000000');
    assert.equal(money.toDecimalString(money.toMinor(usdtLeg.amount)), '10.20000000');
  });

  await t.test('swap history records the rates used, so a swap can be re-derived', async () => {
    const uid = newUid();
    await seed(uid, { inr: '10000', usdt: '0' });

    const result = await service.swap({
      userId: uid, fromCurrency: 'INR', toCurrency: 'USDT', amount: '1000',
    });

    const row = await connection.models.SwapHistory.findByPk(result.swapId, { raw: true });
    assert.equal(row.uid, uid);
    assert.equal(row.from_currency, 'INR');
    assert.equal(row.to_currency, 'USDT');
    assert.equal(money.toDecimalString(money.toMinor(row.usd_rate_from)), '0.01200000');
    assert.equal(money.toDecimalString(money.toMinor(row.usd_rate_to)), '1.00000000');
  });

  await t.test('balances only lists currencies the player actually holds', async () => {
    const uid = newUid();
    await seed(uid, { inr: '50', usdt: '0', btc: '0' });

    const held = await service.getBalances(uid);
    assert.deepEqual(Object.keys(held), ['INR']);
  });
});
