'use strict';

process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const { DirectWalletService } = require('../directWallet.service');
const v = require('../directWallet.validators');

/**
 * Direct User Wallet (admin-structure.zip ka Wallet page):
 *   - Super Admin direct user ko kisi bhi currency me credit / debit kare
 *   - owner ke Direct User wallet (staff_balances, INR) se rate ke hisaab se INR kate / jude
 *   - agent ka user (parent wala) yahan nahi; wallet kam ho to kuch nahi badle
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const TXN = 'direct wallet txn';
const M = (v) => money.toMinor(v);

test('direct wallet: rates and validators', () => {
  // 1 BTC @ 65000 USD, INR @ 0.012 USD → 5,416,666.67 INR
  const { inrMinor, rateMinor } = DirectWalletService.toInr(M('1'), M('65000'), M('0.012'));
  assert.equal(money.toDecimalString(inrMinor), '5416666.67000000');
  assert.equal(money.toDecimalString(rateMinor), '5416666.66666667');
  // INR → INR is 1:1
  assert.equal(money.toDecimalString(DirectWalletService.toInr(M('250.5'), M('0.012'), M('0.012')).inrMinor), '250.50000000');

  assert.equal(v.adjust.body.safeParse({ userId: 1, currency: 'btc', amount: '0.00012345', operation: 'credit', transactionPassword: 'x' }).success, true);
  assert.equal(v.adjust.body.safeParse({ userId: 1, currency: 'BTC', amount: 1, operation: 'credit', transactionPassword: 'x' }).success, false, 'number amount');
  assert.equal(v.adjust.body.safeParse({ userId: 1, currency: 'BTC', amount: '1', operation: 'credit' }).success, false, 'password needed');
  assert.equal(v.adjust.body.safeParse({ userId: 1, currency: 'BTC', amount: '1', operation: 'mint', transactionPassword: 'x' }).success, false);
});

test('direct wallet against a database', async (t) => {
  const logger = createLogger({ name: 'direct-wallet-test', level: 'silent' });
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
      service: 'admin-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models } = connection;
  const q = (sql, replacements) => connection.sequelize.query(sql, { replacements, type: 'SELECT' });
  const service = new DirectWalletService({ models, db: connection, logger });

  // Rates jo test DB me hain (na hon to daal do).
  for (const [currency, usd] of [['INR', '0.012'], ['USDT', '1']]) {
    const [row] = await q('SELECT 1 FROM exchangerate WHERE currency = :currency', { currency });
    if (!row) await q('INSERT INTO exchangerate (currency, usd_rate) VALUES (:currency, :usd) RETURNING id', { currency, usd });
  }
  const [{ usd_rate: inrUsd }] = await q("SELECT usd_rate FROM exchangerate WHERE currency = 'INR'");
  const [{ usd_rate: usdtUsd }] = await q("SELECT usd_rate FROM exchangerate WHERE currency = 'USDT'");

  const ownerRole = 8300 + (process.pid % 40);
  await q('INSERT INTO roles (id, name, level) VALUES (:id, :name, 1) ON CONFLICT (id) DO UPDATE SET level = 1 RETURNING id', {
    id: ownerRole,
    name: `direct-wallet-owner-${ownerRole}`,
  });

  const owner = 975_000 + (process.pid % 1000);
  const direct = 830_000_000 + (process.pid % 100_000) * 10;
  const client = direct + 1;

  const cleanup = async () => {
    await q('DELETE FROM owner_direct_ledger WHERE owner_id = :owner RETURNING id', { owner });
    for (const uid of [direct, client]) {
      await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
      await models.WalletHistory.destroy({ where: { uid } });
      await models.Credits.destroy({ where: { uid } });
      await models.Users.destroy({ where: { id: uid } });
    }
    await models.StaffBalances.destroy({ where: { staff_id: owner } });
    await models.Staff.destroy({ where: { id: owner } });
  };
  await cleanup();
  t.after(async () => {
    await cleanup();
    await connection.close();
  });

  await models.Staff.create({
    id: owner,
    name: `direct-wallet-owner-${owner}`,
    email: `direct-wallet-${owner}@test.invalid`,
    password: await hashPassword('login', 4),
    transaction_password: await hashPassword(TXN, 4),
    role_id: ownerRole,
    status: 'active',
  });
  await models.StaffBalances.create({ staff_id: owner, inr: '1000' });
  await models.Users.create({ id: direct, name: `dw-direct-${direct}`, password: 'x', status: 'active', parent_staff_id: null });
  await models.Users.create({ id: client, name: `dw-client-${client}`, password: 'x', status: 'active', parent_staff_id: owner });

  const actor = { id: owner, canIssueFunds: true };
  const directBalance = async () => money.toDecimalString(money.toMinorQuantised((await models.StaffBalances.findByPk(owner, { raw: true })).inr));
  const usdtOf = async (uid) => money.toDecimalString(money.toMinorQuantised((await models.Credits.findOne({ where: { uid }, raw: true }))?.usdt ?? '0'));
  const inrFor = (amount) => money.toDecimalString(DirectWalletService.toInr(M(amount), M(usdtUsd), M(inrUsd)).inrMinor);

  await t.test('credit in USDT: user gets USDT, owner wallet pays the INR value, ledger has both', async () => {
    const r = await service.adjust({ actor, userId: direct, currency: 'usdt', amount: '5', operation: 'credit', transactionPassword: TXN });
    const inr = inrFor('5');
    assert.equal(r.currency, 'USDT');
    assert.equal(r.inrValue, inr);
    assert.equal(await usdtOf(direct), '5.00000000');
    assert.equal(await directBalance(), money.toDecimalString(M('1000') - M(inr)));

    const [row] = await q('SELECT * FROM owner_direct_ledger WHERE owner_id = :owner ORDER BY id DESC LIMIT 1', { owner });
    assert.equal(row.entry_type, 'user_deposit');
    assert.equal(row.currency, 'USDT');
    assert.equal(money.toDecimalString(money.toMinorQuantised(row.currency_amount)), '5.00000000');

    const history = await service.history({ actor, userId: direct, currency: 'USDT' });
    assert.equal(history.total, 1);
    assert.equal(history.rows[0].operation, 'credit');
  });

  await t.test('debit in USDT: comes back into the owner wallet; more than the user holds moves nothing', async () => {
    const before = await directBalance();
    await service.adjust({ actor, userId: direct, currency: 'USDT', amount: '2', operation: 'debit', transactionPassword: TXN });
    assert.equal(await usdtOf(direct), '3.00000000');
    assert.equal(await directBalance(), money.toDecimalString(M(before) + M(inrFor('2'))));

    const kept = await directBalance();
    await assert.rejects(
      () => service.adjust({ actor, userId: direct, currency: 'USDT', amount: '50', operation: 'debit', transactionPassword: TXN }),
      (err) => err.code === 'INSUFFICIENT_FUNDS' && err.details?.party === 'user'
    );
    assert.equal(await usdtOf(direct), '3.00000000');
    assert.equal(await directBalance(), kept);
  });

  await t.test('owner wallet too small: refused, nothing moves', async () => {
    const kept = await directBalance();
    await assert.rejects(
      () => service.adjust({ actor, userId: direct, currency: 'USDT', amount: '100000', operation: 'credit', transactionPassword: TXN }),
      (err) => err.code === 'INSUFFICIENT_FUNDS' && err.details?.party === 'owner_direct'
    );
    assert.equal(await usdtOf(direct), '3.00000000');
    assert.equal(await directBalance(), kept);
  });

  await t.test('an agent\'s user (has a parent), a wrong password, a non-owner: all refused', async () => {
    await assert.rejects(
      () => service.adjust({ actor, userId: client, currency: 'USDT', amount: '1', operation: 'credit', transactionPassword: TXN }),
      (err) => err.code === 'DIRECT_WALLET_NOT_DIRECT_USER'
    );
    await assert.rejects(
      () => service.adjust({ actor, userId: direct, currency: 'USDT', amount: '1', operation: 'credit', transactionPassword: 'wrong' }),
      (err) => String(err.code).startsWith('TXN_PASSWORD')
    );
    await assert.rejects(
      () => service.adjust({ actor: { id: owner, canIssueFunds: false }, userId: direct, currency: 'USDT', amount: '1', operation: 'credit', transactionPassword: TXN }),
      (err) => err.code === 'DIRECT_WALLET_OWNER_ONLY'
    );
    await assert.rejects(
      () => service.adjust({ actor, userId: direct, currency: 'SC', amount: '1', operation: 'credit', transactionPassword: TXN }),
      (err) => err.code === 'DIRECT_WALLET_UNKNOWN_CURRENCY'
    );
  });

  await t.test('the list has direct users only', async () => {
    const list = await service.listUsers({ actor, search: String(direct).slice(0, 6), limit: 200 });
    const ids = list.rows.map((r) => r.id);
    assert.ok(ids.includes(String(direct)));
    assert.ok(!ids.includes(String(client)));
    assert.equal(list.rows.find((r) => r.id === String(direct)).balances.USDT, '3.00000000');
  });
});
