'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const { hashPassword, totp } = require('@ibitplay/auth');

const { WhitelistService, COOL_OFF_MS } = require('../whitelist.service');
const { CryptoWithdrawService } = require('../../crypto-withdraw/cryptoWithdraw.service');
const { WalletService } = require('../../wallet/wallet.service');
const { REASON } = require('../../wallet/wallet.constants');

/**
 * Whitelist-only withdrawals are binding: with the switch on, a crypto
 * withdrawal to an address not on the list — or added less than 24 h ago — is
 * refused before any money moves. Loosening the list needs the password (and
 * the 2FA code when 2FA is on), and switching it off lands 24 h later.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const PASSWORD = 'whitelist-test-pass';
const SECRET = 'JBSWY3DPEHPK3PXP';

let nextUid = 932_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

const rejectsWith = (promise, code) => assert.rejects(promise, (err) => (assert.equal(err.code, code), true));

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
    config: {
      SERVICE_NAME: 'user-service',
      WITHDRAW_MINIMUM: '1',
      WITHDRAW_REQUIRE_KYC: false,
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-000000',
      JWT_ADMIN_SECRET: 'test-admin-secret-that-is-long-enough-000000',
    },
  };
  const whitelist = new WhitelistService(deps);
  const withdrawals = new CryptoWithdrawService(deps);
  const wallet = new WalletService(deps);

  const uid = newUid();
  const saved = `TQn9Y2khEsLJW1ChVWFMSMeRDow5oREq${uid}`;
  const other = `TXo1Y2khEsLJW1ChVWFMSMeRDow5oREq${uid}`;
  const auth = { password: PASSWORD };

  const clean = async () => {
    await models.UserWithdrawalWhitelist.destroy({ where: { user_id: uid } });
    await models.User2fa.destroy({ where: { uid: String(uid) } });
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
  await models.Users.create({ id: uid, name: `wle-${uid}`, password: await hashPassword(PASSWORD, 4), status: 'active' });
  await models.Credits.create({ uid, usdt: '0' });
  await wallet.credit(
    { userId: uid, currency: 'USDT', amount: '100', reason: REASON.DEPOSIT, idempotencyKey: `wle-seed:${uid}` },
    { sourceService: 'test' }
  );

  const request = (to, amount) => withdrawals.request({ userId: uid, coin: 'USDT', amount, wallet: to, chain: 'TRC20' });
  // Moves an address past its cool-off, as 24 h passing would.
  const ripen = () => models.UserWithdrawalWhitelist.update({ active_at: new Date(Date.now() - 1000) }, { where: { user_id: uid } });

  await t.test('adding an address needs the account password', async () => {
    await rejectsWith(whitelist.add(uid, { label: 'cold', currency: 'usdt', address: saved }), 'WHITELIST_PASSWORD_REQUIRED');
    await rejectsWith(whitelist.add(uid, { label: 'cold', currency: 'usdt', address: saved, password: 'wrong' }), 'WHITELIST_PASSWORD_REQUIRED');

    const row = await whitelist.add(uid, { label: 'cold', currency: 'usdt', address: saved, ...auth });
    const wait = new Date(row.activeAt).getTime() - Date.now();
    assert.ok(wait > COOL_OFF_MS - 60_000 && wait <= COOL_OFF_MS, 'usable 24 h after it was added');
  });

  await t.test('switch off: any address is accepted', async () => {
    const row = await request(other, '5');
    assert.equal(row.replayed, false);
  });

  await t.test('switch on: an address not on the list is refused and nothing is held', async () => {
    const on = await whitelist.setEnforcement(uid, true);
    assert.deepEqual(on, { whitelistOnly: true, offAt: null });
    const before = await models.Withdrawals.count({ where: { uid } });

    await assert.rejects(request(other, '6'), (err) => {
      assert.equal(err.code, 'CRYPTO_WITHDRAW_ADDRESS_NOT_WHITELISTED');
      assert.equal(err.status, 403);
      return true;
    });
    assert.equal(await models.Withdrawals.count({ where: { uid } }), before, 'no withdrawal row was left');
  });

  await t.test('a saved address is refused until its 24 h cool-off ends', async () => {
    await rejectsWith(request(saved, '7'), 'CRYPTO_WITHDRAW_ADDRESS_NOT_WHITELISTED');
    await ripen();
    const row = await request(saved, '7');
    assert.equal(row.replayed, false);
  });

  await t.test('the same address under another currency is not a match', async () => {
    assert.equal(await whitelist.isAllowed(uid, { currency: 'BTC', address: saved }), false);
    assert.equal(await whitelist.isAllowed(uid, { currency: 'usdt', address: saved }), true);
  });

  await t.test('switching off needs the password and lands 24 h later; switching on cancels it', async () => {
    await rejectsWith(whitelist.setEnforcement(uid, false, {}), 'WHITELIST_PASSWORD_REQUIRED');

    const pending = await whitelist.setEnforcement(uid, false, auth);
    assert.equal(pending.whitelistOnly, true, 'still enforced while the switch-off is pending');
    const wait = new Date(pending.offAt).getTime() - Date.now();
    assert.ok(wait > COOL_OFF_MS - 60_000 && wait <= COOL_OFF_MS);
    assert.equal(await whitelist.isAllowed(uid, { currency: 'USDT', address: other }), false);

    // Asking again does not push the time back.
    assert.equal((await whitelist.setEnforcement(uid, false, auth)).offAt, pending.offAt);

    assert.deepEqual(await whitelist.setEnforcement(uid, true), { whitelistOnly: true, offAt: null });

    // Once the time passes, it is off.
    await whitelist.setEnforcement(uid, false, auth);
    await models.Users.update({ withdraw_whitelist_off_at: new Date(Date.now() - 1000) }, { where: { id: uid } });
    assert.equal(await whitelist.isAllowed(uid, { currency: 'USDT', address: other }), true);
    const list = await whitelist.list(uid);
    assert.equal(list.whitelistOnly, false);
    assert.equal(list.offAt, null);
    assert.ok(list.addresses[0].activeAt);
    await whitelist.setEnforcement(uid, true);
  });

  await t.test('with 2FA on, the code is needed as well', async () => {
    await models.User2fa.create({ uid: String(uid), is_enabled: true, secret_key: SECRET });
    const [row] = (await whitelist.list(uid)).addresses;

    await rejectsWith(whitelist.remove(uid, row.id, auth), 'TWOFA_INVALID_CODE');
    await rejectsWith(whitelist.remove(uid, row.id, { ...auth, code: '000000' }), 'TWOFA_INVALID_CODE');
    await rejectsWith(whitelist.remove(uid, row.id, { password: 'wrong', code: totp.currentCode(SECRET) }), 'WHITELIST_PASSWORD_REQUIRED');

    // The last address gone: enforcement goes off on the 24 h delay, not at once.
    const removed = await whitelist.remove(uid, row.id, { ...auth, code: totp.currentCode(SECRET) });
    assert.equal(removed.remaining, 0);
    assert.equal(removed.whitelistOnly, true);
    assert.ok(removed.offAt);
  });
});
