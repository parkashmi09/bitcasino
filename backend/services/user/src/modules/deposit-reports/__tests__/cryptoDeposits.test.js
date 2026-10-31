'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { DepositReportsService } = require('../depositReports.service');

/**
 * The staff crypto-deposit list.
 *
 * `ccdeposit` holds the deposit in the COIN: `paymentOrders` writes `price`
 * and leaves `amount` unset, older rows carry the coin amount in `amount`.
 * The list read `amount` as USD, so 0.001 BTC showed as "0.00 USD".
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextUid = 850_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

// The platform owner's tree, which also covers players with no staff — so the
// test players need no staff row of their own.
const STAFF_ID = 1;

test('deposit reports: crypto deposit list', async (t) => {
  const logger = createLogger({ name: 'ccdeposit-list-test', level: 'silent' });

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

  const uids = [];
  t.after(async () => {
    if (uids.length) {
      await connection.models.Ccdeposit.destroy({ where: { userid: uids.map(String) } });
      await connection.models.Users.destroy({ where: { id: uids } });
    }
    await connection.close();
  });

  // The shared test DB's rate table is whatever other suites left there, so
  // the rates are fixed here: BTC priced, DOGE not.
  const models = Object.create(connection.models, {
    Exchangerate: {
      value: { findAll: async () => [{ currency: 'BTC', usd_rate: '60000.00000000' }, { currency: 'INR', usd_rate: '0.012' }] },
    },
  });

  const make = (config = {}) =>
    new DepositReportsService({
      models,
      logger,
      config,
      clients: { admin: { get: async () => ({ data: { ids: [STAFF_ID] } }) } },
    });
  const staff = { id: STAFF_ID };

  const seedPlayer = async () => {
    const uid = newUid();
    uids.push(uid);
    await connection.models.Ccdeposit.destroy({ where: { userid: String(uid) } });
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({
      id: uid, name: `ccl-${uid}`, password: 'x', status: 'active', parent_staff_id: null,
    });
    return uid;
  };

  const deposit = (uid, fields) =>
    connection.models.Ccdeposit.create({
      userid: String(uid), chain: 'BTC', orderid: `ccl-${uid}-${Math.random()}`, status: 'Success',
      created_at: new Date(), ...fields,
    });

  const listFor = async (uid, config) => {
    const { rows } = await make(config).listCryptoDeposits({ staff, userId: uid, limit: 50 });
    return rows;
  };

  await t.test('a paymentOrders row (price set, amount null) shows the coin amount, ticker and USD', async () => {
    const uid = await seedPlayer();
    await deposit(uid, { coinid: 1155, price: '0.001', amount: null });

    const [row] = await listFor(uid);
    assert.equal(row.coin, 'BTC');
    assert.equal(row.coinId, 1155);
    assert.equal(row.amount, '0.00100000');
    assert.equal(row.amountUsd, '60.00000000', 'not "0.00"');
    assert.equal(row.amountInr, undefined);
  });

  await t.test('an older row with the coin amount in `amount` still reads', async () => {
    const uid = await seedPlayer();
    await deposit(uid, { coinid: 1155, price: null, amount: '0.5' });

    const [row] = await listFor(uid);
    assert.equal(row.amount, '0.50000000');
    assert.equal(row.amountUsd, '30000.00000000');
  });

  await t.test('a coin with no rate has no USD value, rather than a guessed one', async () => {
    const uid = await seedPlayer();
    await deposit(uid, { coinid: 1492, chain: 'DOGE', price: '125.5' });

    const [row] = await listFor(uid);
    assert.equal(row.coin, 'DOGE');
    assert.equal(row.amount, '125.50000000');
    assert.equal(row.amountUsd, null);
  });

  await t.test('an unknown coin id reads #<id>; the configured map wins over the fallback', async () => {
    const uid = await seedPlayer();
    await deposit(uid, { coinid: 99_991, price: '2' });

    const [unknown] = await listFor(uid);
    assert.equal(unknown.coin, '#99991');
    assert.equal(unknown.amountUsd, null);

    const [configured] = await listFor(uid, { CCPAYMENT_COIN_IDS: JSON.stringify({ BTC: 99_991 }) });
    assert.equal(configured.coin, 'BTC');
    assert.equal(configured.amountUsd, '120000.00000000');
  });

  await t.test('a coin filter keeps that ticker only (the site admin currency filter)', async () => {
    const uid = await seedPlayer();
    await deposit(uid, { coinid: 1155, price: '0.001' });
    await deposit(uid, { coinid: 1280, chain: 'TRC20', price: '20' });
    await deposit(uid, { coinid: 99_992, price: '3' });

    const coins = async (coin, config) => (await make(config).listCryptoDeposits({ staff, userId: uid, coin, limit: 50 })).rows.map((r) => r.coin).sort();
    assert.deepEqual(await coins('USDT'), ['USDT']);
    assert.deepEqual(await coins('btc'), ['BTC']);
    assert.deepEqual(await coins('ETH'), [], 'no rows in it');
    assert.deepEqual(await coins('NOPE'), [], 'a coin no id maps to matches nothing');
    assert.deepEqual(await coins('USDT', { CCPAYMENT_COIN_IDS: JSON.stringify({ USDT: 99_992 }) }), ['USDT', 'USDT'], 'the configured id counts too');
    assert.deepEqual(await coins(undefined), ['#99992', 'BTC', 'USDT']);
  });
});
