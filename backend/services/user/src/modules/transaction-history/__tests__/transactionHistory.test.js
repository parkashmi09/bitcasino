'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { TransactionHistoryService } = require('../transactionHistory.service');

/**
 * A player's statement, across every rail that holds one.
 *
 * The port read three tables and called it a history: `deposits`,
 * `fiat_deposits`, `fiat_withdrawals`. Four deposit rails and three withdrawal
 * rails exist, and `deposits` is not one of them — nothing in the new backend
 * writes it. So a player who deposited through CCPayment, A-Pay or WayPay, or
 * withdrew crypto or through A-Pay, saw an empty screen, which is
 * indistinguishable from the money having vanished.
 *
 * These tests seed one row on each rail and assert it comes back.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextUid = 870_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('transaction history: every rail', async (t) => {
  const logger = createLogger({ name: 'txhistory-test', level: 'silent' });
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

  t.after(async () => {
    if (connection) await connection.close();
  });

  const models = connection.models;

  const service = new TransactionHistoryService({
    models,
    logger,
    clients: {},
    // `ccdeposit.coinid` is CCPayment's own number. 1280 is USDT in the
    // provider's coin list, which is what a deployment configures here.
    config: { CCPAYMENT_COIN_IDS: { USDT: 1280 } },
  });

  /** A player with one row on every rail, each at a distinct time. */
  const seedPlayer = async () => {
    const uid = newUid();
    await models.Users.create({ id: uid, name: `tx-${uid}`, password: 'x', status: 'active' });

    const at = (minutes) => new Date(Date.UTC(2026, 0, 1, 12, minutes, 0));

    // ── deposits ──────────────────────────────────────────────────────
    await models.Ccdeposit.create({
      // VARCHAR(255), not BIGINT — the rails disagree about the id's type.
      userid: String(uid),
      orderid: `order-${uid}`,
      coinid: 1280,
      price: '25.5',
      amount: '25.5',
      status: 'Success',
      created_at: at(1),
    });
    await models.FiatDeposits.create({
      user_id: uid,
      amount: '1000',
      currency: 'PKR',
      transaction_id: `TX-manual-${uid}`,
      status: 'pending',
      created_at: at(2),
    });
    await models.Apaydeposits.create({
      order_id: `apay-d-${uid}`,
      user_id: uid,
      amount: '500',
      currency: 'INR',
      payment_system: 'upi',
      custom_transaction_id: `TX-apay-${uid}`,
      status: 'Success',
      created_at: at(3),
    });
    await models.PayInTransactions.create({
      user_id: uid,
      transaction_id: `wp-${uid}`,
      out_trade_no: `wp-out-${uid}`,
      currency: 'INR',
      amount: '750',
      pay_type: 'imps',
      // SMALLINT. 1 is success — the only rail that stores a number.
      status: 1,
      created_at: at(4),
    });

    // ── withdrawals ───────────────────────────────────────────────────
    await models.Withdrawals.create({
      uid,
      amount: '0.004',
      coin: 'BTC',
      chain: 'BTC',
      wallet: 'bc1qexamplewalletaddress0000',
      status: 'In Queue',
      date: at(5),
    });
    await models.FiatWithdrawals.create({
      uid,
      amount: '300',
      currency: 'INR',
      status: 'Rejected',
      bank_name: 'imps',
      account_number: '938939939939393',
      account_holder_name: `tx-${uid}`,
      ifsc_code: 'PUNB0144420',
      date: at(6),
    });
    await models.Apaywithdrawals.create({
      order_id: `apay-w-${uid}`,
      // VARCHAR(200) here and BIGINT on `apaydeposits` — the same integration
      // disagreeing with itself, which is why the rail carries a flag.
      user_id: String(uid),
      amount: '800',
      currency: 'NPR',
      payment_system: 'esewa_p2p',
      custom_transaction_id: `TX-apayw-${uid}`,
      status: 'Failed',
      payout_details: { bank_name: 'esewa_p2p', account_number: '9800000000' },
      created_at: at(7),
    });

    return uid;
  };

  await t.test('a deposit on every rail comes back', async () => {
    const uid = await seedPlayer();
    const { count, rows } = await service.allDeposits({ userId: uid });

    assert.equal(count, 4, 'four deposit rails, four rows');
    assert.deepEqual(
      rows.map((r) => r.method).sort(),
      ['apay', 'crypto', 'manual', 'waypay'],
      'the port returned `manual` alone — the other three rails were unread'
    );
  });

  await t.test('a withdrawal on every rail comes back', async () => {
    const uid = await seedPlayer();
    const { count, rows } = await service.allWithdrawals({ userId: uid });

    assert.equal(count, 3);
    assert.deepEqual(rows.map((r) => r.method).sort(), ['apay', 'crypto', 'manual']);
  });

  await t.test('the A-Pay rail is not returned twice', async () => {
    // Legacy merged A-Pay into `fiatWithdrawals` AND repeated it under
    // `apayWithdrawals`, so a client reading both double-counted every payout.
    const uid = await seedPlayer();
    const { rows } = await service.allWithdrawals({ userId: uid });

    assert.equal(rows.filter((r) => r.method === 'apay').length, 1);
  });

  await t.test('rows are newest first, across rails', async () => {
    const uid = await seedPlayer();
    const { rows } = await service.allDeposits({ userId: uid });

    const dates = rows.map((r) => new Date(r.date).getTime());
    assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
    assert.equal(rows[0].method, 'waypay', 'the latest deposit was the WayPay one');
  });

  await t.test('every rail answers in ONE shape', async () => {
    /**
     * The shapes differing per rail is what broke the screen: the client had a
     * branch per type, and when a group arrived as `{count, rows}` instead of
     * an array the branch called `.map` on an object and threw.
     */
    const uid = await seedPlayer();
    const { rows } = await service.allDeposits({ userId: uid });

    for (const row of rows) {
      for (const key of ['id', 'kind', 'method', 'type', 'amount', 'status', 'details', 'date']) {
        assert.ok(key in row, `${row.method} row is missing ${key}`);
      }
      assert.equal(row.kind, 'deposit');
      assert.match(row.amount, /^\d+\.\d{8}$/, 'amounts are canonical decimal strings');
    }
  });

  await t.test('the WayPay SMALLINT status reads as a word', async () => {
    // `status = 1` next to 'pending' and 'Success' meant three vocabularies in
    // one list. Legacy's own mapping also read 2 (failed) as 'pending'.
    const uid = await seedPlayer();
    const { rows } = await service.allDeposits({ userId: uid });

    const waypay = rows.find((r) => r.method === 'waypay');
    assert.equal(waypay.status, 'approved');
  });

  await t.test('a status filter matches across the rails that spell it differently', async () => {
    const uid = await seedPlayer();

    // 'Success' on ccdeposit and apaydeposits, `1` on pay_in_transactions.
    const { rows } = await service.allDeposits({ userId: uid, status: 'success' });
    assert.deepEqual(rows.map((r) => r.method).sort(), ['apay', 'crypto']);

    const approved = await service.allDeposits({ userId: uid, status: 'approved' });
    assert.deepEqual(approved.rows.map((r) => r.method), ['waypay'], 'the numeric rail translates');
  });

  await t.test('the crypto coin id reads back as a ticker', async () => {
    const uid = await seedPlayer();
    const { rows } = await service.allDeposits({ userId: uid });

    assert.equal(rows.find((r) => r.method === 'crypto').currency, 'USDT');
  });

  await t.test('a wallet address is masked', async () => {
    const uid = await seedPlayer();
    const { rows } = await service.allWithdrawals({ userId: uid });
    const crypto = rows.find((r) => r.method === 'crypto');

    assert.ok(!crypto.details.includes('bc1qexamplewalletaddress0000'));
    assert.equal(crypto.destination.wallet, 'bc1qex…0000');
  });

  await t.test('the destination is on the row — a failed payout has to say where', async () => {
    const uid = await seedPlayer();
    const { rows } = await service.allWithdrawals({ userId: uid });

    const manual = rows.find((r) => r.method === 'manual');
    assert.equal(manual.destination.accountNumber, '938939939939393');

    // A-Pay keeps the account inside a JSONB column whose shape varies per
    // payment system, which is why it is flattened rather than passed through.
    const apay = rows.find((r) => r.method === 'apay');
    assert.equal(apay.destination.accountNumber, '9800000000');
  });

  await t.test('one player cannot see another', async () => {
    const [mine, theirs] = [await seedPlayer(), await seedPlayer()];

    const { rows } = await service.allDeposits({ userId: mine });
    assert.ok(rows.length > 0);
    assert.ok(rows.every((r) => String(r.userId) === String(mine)), `leaked ${theirs}`);
  });

  await t.test('paging slices the merged list, and the count is the real total', async () => {
    const uid = await seedPlayer();

    const first = await service.allDeposits({ userId: uid, limit: 2, offset: 0 });
    const second = await service.allDeposits({ userId: uid, limit: 2, offset: 2 });

    assert.equal(first.rows.length, 2);
    assert.equal(second.rows.length, 2);
    assert.equal(first.count, 4, 'the total counts every rail, not the page');
    assert.equal(second.count, 4);

    const seen = new Set([...first.rows, ...second.rows].map((r) => `${r.method}:${r.id}`));
    assert.equal(seen.size, 4, 'the two pages do not overlap');
  });

  await t.test('combined returns deposits and withdrawals under one shape', async () => {
    const uid = await seedPlayer();
    const result = await service.combined({ userId: uid, limit: 50, offset: 0 });

    assert.deepEqual(Object.keys(result).sort(), ['deposits', 'withdrawals']);
    assert.equal(result.deposits.count, 4);
    assert.equal(result.withdrawals.count, 3);
    assert.ok(Array.isArray(result.deposits.rows), 'rows is an ARRAY — the client maps it');
  });
});
