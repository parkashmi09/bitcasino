'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { WhitelistService } = require('../whitelist.service');
const { CryptoWithdrawService } = require('../../crypto-withdraw/cryptoWithdraw.service');
const { WalletService } = require('../../wallet/wallet.service');
const { REASON } = require('../../wallet/wallet.constants');

/**
 * Whitelist-only withdrawals are binding: with the switch on, a crypto
 * withdrawal to an address not on the list is refused before any money moves.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let nextUid = 932_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('withdrawal whitelist enforcement', async (t) => {
  const logger = createLogger({ name: 'whitelist-enforcement-test', level: 'silent' });

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

  const { models } = connection;
  const deps = {
    models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service', WITHDRAW_MINIMUM: '1', WITHDRAW_REQUIRE_KYC: false },
  };
  const whitelist = new WhitelistService(deps);
  const withdrawals = new CryptoWithdrawService(deps);
  const wallet = new WalletService(deps);

  const uid = newUid();
  const saved = `TQn9Y2khEsLJW1ChVWFMSMeRDow5oREq${uid}`;
  const other = `TXo1Y2khEsLJW1ChVWFMSMeRDow5oREq${uid}`;

  const clean = async () => {
    await models.UserWithdrawalWhitelist.destroy({ where: { user_id: uid } });
    await models.Withdrawals.destroy({ where: { uid } });
    await models.CreditsLedger.destroy({ where: { user_id: String(uid) } });
    await models.Credits.destroy({ where: { uid } });
    await models.Users.destroy({ where: { id: uid } });
  };
  t.after(async () => {
    await clean();
    await connection.close();
  });

  await clean();
  await models.Users.create({ id: uid, name: `wle-${uid}`, password: 'x', status: 'active' });
  await models.Credits.create({ uid, usdt: '0' });
  await wallet.credit(
    { userId: uid, currency: 'USDT', amount: '100', reason: REASON.DEPOSIT, idempotencyKey: `wle-seed:${uid}` },
    { sourceService: 'test' }
  );
  await whitelist.add(uid, { label: 'cold', currency: 'usdt', address: saved });

  const request = (wallet, amount) => withdrawals.request({ userId: uid, coin: 'USDT', amount, wallet, chain: 'TRC20' });

  await t.test('switch off: any address is accepted', async () => {
    const row = await request(other, '5');
    assert.equal(row.replayed, false);
  });

  await t.test('switch on: an address not on the list is refused and nothing is held', async () => {
    await whitelist.setEnforcement(uid, true);
    const before = await models.Withdrawals.count({ where: { uid } });

    await assert.rejects(request(other, '6'), (err) => {
      assert.equal(err.code, 'CRYPTO_WITHDRAW_ADDRESS_NOT_WHITELISTED');
      assert.equal(err.status, 403);
      return true;
    });
    assert.equal(await models.Withdrawals.count({ where: { uid } }), before, 'no withdrawal row was left');
  });

  await t.test('switch on: a saved address goes through', async () => {
    const row = await request(saved, '7');
    assert.equal(row.replayed, false);
  });

  await t.test('the same address under another currency is not a match', async () => {
    assert.equal(await whitelist.isAllowed(uid, { currency: 'BTC', address: saved }), false);
    assert.equal(await whitelist.isAllowed(uid, { currency: 'usdt', address: saved }), true);
  });
});
