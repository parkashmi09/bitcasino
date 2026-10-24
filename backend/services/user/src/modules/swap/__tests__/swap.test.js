'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { SwapService } = require('../swap.service');
const { feeRateFor } = require('../swap.constants');
const { resolveColumn } = require('../../wallet/wallet.constants');
const v = require('../swap.validators');

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
  await connection.models.Exchangerate.destroy({ where: { currency: ['INR', 'USDT', 'BJB'] } });
  await connection.models.Exchangerate.bulkCreate([
    { currency: 'INR', usd_rate: '0.012', last_updated: new Date() },
    { currency: 'USDT', usd_rate: '1', last_updated: new Date() },
    { currency: 'BJB', usd_rate: '1', last_updated: new Date() },
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

    // INR fee is 1%: 1000 -> 10 fee -> 990 converted.
    // 990 INR * 0.012 = 11.88 USD / 1 = 11.88 USDT.
    assert.equal(result.feeAmount, '10.00000000');
    assert.equal(result.amountAfterFee, '990.00000000');
    assert.equal(result.toAmount, '11.88000000');

    const after = await balances(uid);
    assert.equal(after.INR, '9000.00000000', 'the FULL amount leaves the source currency');
    assert.equal(after.USDT, '11.88000000');
  });

  await t.test('the 0.01 fee is exact — no float drift', async () => {
    const uid = newUid();
    await seed(uid, { inr: '10000', usdt: '0' });

    // 3333.33 * 0.01 in a double is 33.333299999999994; the fee must be exactly 33.3333.
    const estimate = await service.estimate({
      fromCurrency: 'INR', toCurrency: 'USDT', amount: '3333.33',
    });

    assert.equal(estimate.feeAmount, '33.33330000');
    assert.equal(estimate.amountAfterFee, '3299.99670000');
  });

  await t.test('fee rates are per-currency', async () => {
    assert.equal(feeRateFor('INR'), '0.01');
    assert.equal(feeRateFor('BJB'), '0', 'a retired coin is free to swap OUT of');
    assert.equal(feeRateFor('USDT'), '0.01');
    assert.equal(feeRateFor('unknown'), '0.01');
  });

  await t.test('the Super Admin sets the swap fee; the quote uses it, a retired coin stays free', async () => {
    const key = "DELETE FROM admin_configurations WHERE config_key = 'swap_fee'";
    await connection.sequelize.query(key);
    try {
      assert.equal((await service.getFee()).fee, '0.01', 'no setting is the 1% default');
      assert.equal((await service.setFee({ fee: '0.025' })).fee, '0.025');
      const est = await service.estimate({ fromCurrency: 'INR', toCurrency: 'USDT', amount: '1000' });
      assert.equal(est.feeAmount, '25.00000000');
      assert.equal((await service.setFee({ fee: '0' })).fee, '0', 'a second set overwrites');
      assert.ok(!v.setFee.body.safeParse({ fee: '0.6' }).success, 'over 50% is refused');
      assert.ok(!v.setFee.body.safeParse({ fee: '-0.1' }).success);
      assert.ok(v.setFee.body.safeParse({ fee: '0.0125' }).success);
    } finally {
      await connection.sequelize.query(key);
    }
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
    assert.equal(money.toDecimalString(money.toMinor(usdtLeg.amount)), '11.88000000');
  });

  await t.test('the staff history takes a currency filter (a swap out of or into it)', async () => {
    assert.equal(v.adminHistory.query.parse({ currency: 'usdt' }).currency, 'USDT');
    assert.equal(v.adminHistory.query.safeParse({ currency: "INR' OR 1=1" }).success, false);

    const uid = newUid();
    await seed(uid, { inr: '10000', usdt: '0' });
    await service.swap({ userId: uid, fromCurrency: 'INR', toCurrency: 'USDT', amount: '1000' });
    // The root sees everyone: scope is the requested player only.
    const scoped = new SwapService({ models: connection.models, db: connection, logger, config: { SERVICE_NAME: 'user-service', ROOT_STAFF_ID: 1 }, clients: { admin: { get: async () => ({ ids: [1] }) } } });
    const list = async (currency) => (await scoped.listAllHistory({ staff: { id: 1 }, userId: uid, currency, limit: 10, offset: 0 })).count;
    assert.equal(await list(undefined), 1);
    assert.equal(await list('USDT'), 1, 'into USDT');
    assert.equal(await list('INR'), 1, 'out of INR');
    assert.equal(await list('BTC'), 0);
  });

  await t.test('the fee summary values each fee in USDT at its own swap\'s rate', async () => {
    const uid = newUid();
    await seed(uid, { inr: '10000', usdt: '0' });
    const result = await service.swap({ userId: uid, fromCurrency: 'INR', toCurrency: 'USDT', amount: '1000' });
    const scoped = new SwapService({ models: connection.models, db: connection, logger, config: { SERVICE_NAME: 'user-service', ROOT_STAFF_ID: 1 }, clients: { admin: { get: async () => ({ ids: [1] }) } } });

    const summary = await scoped.feeSummary({ staff: { id: 1 }, userId: uid, channel: 'all' }) // the test player has no users row;
    const row = await connection.models.SwapHistory.findByPk(result.swapId, { raw: true });
    assert.equal(summary.swaps, 1);
    assert.equal(Number(summary.feeUsdt), Number(row.fee_amount) * Number(row.usd_rate_from));
    assert.equal(summary.todayUsdt, summary.feeUsdt, 'made today');

    const days = await scoped.feeHistory({ staff: { id: 1 }, userId: uid, channel: 'all', limit: 10, offset: 0 });
    assert.equal(days.count, 1);
    assert.equal(days.rows[0].swaps, 1);
    assert.equal(days.rows[0].feeUsdt, summary.feeUsdt);
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

  await t.test('a swap reads back at the time it was made, whatever the server time zone (082)', async () => {
    // The column was `timestamp without time zone`: written as UTC wall time, read back in the
    // process zone, so on an IST server every swap showed 5h30m early. Run in IST to prove it.
    const tz = process.env.TZ;
    process.env.TZ = 'Asia/Kolkata';
    try {
      const uid = newUid();
      await seed(uid, { inr: '10000', usdt: '0' });
      const before = Date.now();
      await service.swap({ userId: uid, fromCurrency: 'INR', toCurrency: 'USDT', amount: '1000' });

      const row = await connection.models.SwapHistory.findOne({ where: { uid }, order: [['id', 'DESC']], raw: true });
      const skew = Math.abs(new Date(row.created_at).getTime() - before);
      assert.ok(skew < 60_000, `created_at is ${Math.round(skew / 60_000)} min away from the swap`);
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });

  await t.test('balances only lists currencies the player actually holds', async () => {
    const uid = newUid();
    await seed(uid, { inr: '50', usdt: '0', btc: '0' });

    const held = await service.getBalances(uid);
    assert.deepEqual(Object.keys(held), ['INR']);
  });
  await t.test('a retired coin (BJB) can be swapped out of, never into', async () => {
    const body = (from, to) => v.swap.body.safeParse({ fromCurrency: from, toCurrency: to, amount: '1' });
    assert.equal(body('BJB', 'USDT').success, true);
    assert.equal(body('USDT', 'BJB').success, false);
    assert.equal(body('usdt', 'bjb').success, false);

    const uid = newUid();
    await seed(uid, { bjb: '4', usdt: '0' });
    const result = await service.swap({ userId: uid, fromCurrency: 'BJB', toCurrency: 'USDT', amount: '4' });
    assert.equal(result.feeAmount, '0.00000000');
    assert.equal(result.toAmount, '4.00000000');

    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    assert.equal(money.toDecimalString(money.toMinor(row?.bjb ?? '0')), '0.00000000');
    assert.equal(money.toDecimalString(money.toMinor(row?.usdt ?? '0')), '4.00000000');

    // The service refuses it too, should anything bypass the validator.
    await seed(uid, { bjb: '0', usdt: '5' });
    await assert.rejects(
      () => service.swap({ userId: uid, fromCurrency: 'USDT', toCurrency: 'BJB', amount: '1' }),
      (error) => error.code === 'WALLET_CURRENCY_RETIRED'
    );
    const untouched = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    assert.equal(money.toDecimalString(money.toMinor(untouched?.usdt ?? '0')), '5.00000000', 'nothing moved');
  });
});
