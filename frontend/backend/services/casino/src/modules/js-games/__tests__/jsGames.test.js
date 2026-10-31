'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { JsGamesService } = require('../jsGames.service');
const { HuiduClient } = require('../providers/huidu');
const { XGamesApiClient } = require('../providers/xgamesApi');
const { CODE } = require('../jsGames.constants');

/**
 * The two jsGames wallet callbacks.
 *
 * The first test is the one that matters: v2 took the player's new balance from
 * the request body, unauthenticated. It never fired only because the table it
 * wrote to did not exist — and migration 016 creates that table.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

const AES_KEY = 'a'.repeat(32); // aes-256 needs exactly 32 bytes
const API_KEY = 'test-api-key';
const API_SECRET = 'test-api-secret';

let connection;

let nextUid = 980_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

let seq = 0;
const newSerial = () => `S-${process.pid}-${(seq += 1)}`;

test('jsGames', async (t) => {
  const logger = createLogger({ name: 'jsgames-test', level: 'silent' });

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
      service: 'casino-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  t.after(async () => {
    if (connection) await connection.close();
  });

  const { models } = connection;

  const v1 = new HuiduClient({
    baseUrl: 'https://huidu.test',
    agencyUid: 'agency-1',
    aesKey: AES_KEY,
    playerPrefix: 'h24e9e',
    logger,
    fetchImpl: async () => {
      throw new Error('no upstream call expected');
    },
  });

  const v2 = new XGamesApiClient({
    baseUrl: 'https://games.test/api/game',
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    maxSkewSeconds: 300,
    logger,
    fetchImpl: async () => {
      throw new Error('no upstream call expected');
    },
  });

  /** A wallet that enforces the overdraft rule and honours idempotency keys. */
  const makeWallet = (balances) => {
    const applied = new Map();
    return {
      key: (reason, ref) => `casino-service:${reason}:${ref.type}:${ref.id}`,
      async balance(userId) {
        return { balance: balances.get(String(userId)) ?? null };
      },
      async credit({ userId, amount, reason, ref }) {
        const key = this.key(reason, ref);
        if (applied.has(key)) return applied.get(key);
        const next = money.toDecimalString(money.add(balances.get(String(userId)) ?? '0', amount));
        balances.set(String(userId), next);
        const movement = { ledgerId: applied.size + 1, newBalance: next };
        applied.set(key, movement);
        return movement;
      },
      async debit({ userId, amount, reason, ref }) {
        const key = this.key(reason, ref);
        if (applied.has(key)) return applied.get(key);
        const current = balances.get(String(userId)) ?? '0';
        if (money.lt(current, amount)) {
          const error = new Error('Insufficient funds');
          error.code = 'WALLET_INSUFFICIENT_FUNDS';
          throw error;
        }
        const next = money.toDecimalString(money.subtract(current, amount));
        balances.set(String(userId), next);
        const movement = { ledgerId: applied.size + 1, newBalance: next };
        applied.set(key, movement);
        return movement;
      },
      applied,
    };
  };

  const build = (balances, config = {}) => {
    const wallet = makeWallet(balances);
    const service = new JsGamesService({
      models,
      db: connection,
      logger,
      wallet,
      v1,
      v2,
      config: { SERVICE_NAME: 'casino-service', JSGAMES_MAX_SKEW_SECONDS: 300, ...config },
    });
    return { service, wallet };
  };

  const seedPlayer = async (uid) => {
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name: `js-${uid}`, password: 'x', status: 'active' });
    return uid;
  };

  /** A v1 callback, encrypted exactly as huidu.bet would send it. */
  const v1Callback = (payload) => ({
    agency_uid: 'agency-1',
    timestamp: Date.now().toString(),
    payload: v1.encrypt({ timestamp: Date.now().toString(), ...payload }),
  });

  /** A v2 callback, signed with the provider's own scheme. */
  const v2Callback = (body, { at = Date.now(), signature } = {}) => {
    const timestamp = String(at);
    return {
      body,
      headers: {
        'x-api-key': API_KEY,
        'x-timestamp': timestamp,
        'x-signature': signature ?? v2.sign({ ...body, timestamp }),
      },
    };
  };

  // ══════════════════════════════════════════════════════════════════════
  //  v2 — the balance-from-the-body endpoint
  // ══════════════════════════════════════════════════════════════════════

  await t.test('v2 IGNORES a balance supplied in the request body', async () => {
    /**
     * THE headline defect:
     *
     *     const newBalance = Number(parseFloat(balance).toFixed(8));
     *     UPDATE credits SET usdt = $1 WHERE uid = $2
     *
     * Post a number, own that balance. Even with a valid signature the field
     * must have no effect — the balance comes from the movement.
     */
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const result = await service.betCallbackV2(
      v2Callback({
        user_id: uid,
        transaction_type: 'bet',
        amount: '10',
        currency: 'USDT',
        balance: '99999999',
        transaction_id: newSerial(),
      })
    );

    assert.equal(result.success, true);
    assert.equal(balances.get(String(uid)), '90.00000000', 'the stake was taken; the named balance was ignored');
    assert.equal(result.new_balance, '90.00000000');
  });

  await t.test('v2 refuses an unsigned callback', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const result = await service.betCallbackV2({
      body: { user_id: uid, transaction_type: 'win', amount: '5000', currency: 'USDT', transaction_id: newSerial() },
      headers: {},
    });

    assert.equal(result.success, false);
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('v2 refuses a callback whose body was edited after signing', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const honest = v2Callback({
      user_id: uid,
      transaction_type: 'win',
      amount: '1',
      currency: 'USDT',
      transaction_id: newSerial(),
    });
    honest.body.amount = '5000';

    const result = await service.betCallbackV2(honest);
    assert.equal(result.success, false);
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('v2 refuses a replayed signature once its timestamp expires', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const result = await service.betCallbackV2(
      v2Callback(
        { user_id: uid, transaction_type: 'win', amount: '50', currency: 'USDT', transaction_id: newSerial() },
        { at: Date.now() - 3600_000 }
      )
    );

    assert.equal(result.success, false);
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test("v2 refuses the literal transaction id 'unknown'", async () => {
    // Legacy defaulted a missing id to that string, which would make every
    // callback omitting one collide with every other.
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    for (const transaction_id of ['unknown', '', '   ']) {
      const result = await service.betCallbackV2(
        v2Callback({ user_id: uid, transaction_type: 'win', amount: '10', currency: 'USDT', transaction_id })
      );
      assert.equal(result.success, false, `${JSON.stringify(transaction_id)} must be refused`);
    }

    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('v2 pays a retried win ONCE', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '0']]);
    const { service } = build(balances);

    const transaction_id = newSerial();
    const win = () =>
      service.betCallbackV2(
        v2Callback({ user_id: uid, transaction_type: 'win', amount: '200', currency: 'USDT', transaction_id })
      );

    await win();
    await win();
    await win();

    assert.equal(balances.get(String(uid)), '200.00000000');
    assert.equal(await models.GameTransaction.count({ where: { external_transaction_id: transaction_id } }), 1);
  });

  await t.test('v2 concurrent retries apply once', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '0']]);
    const { service } = build(balances);

    const transaction_id = newSerial();
    const win = () =>
      service.betCallbackV2(
        v2Callback({ user_id: uid, transaction_type: 'win', amount: '75', currency: 'USDT', transaction_id })
      );

    await Promise.all([win(), win(), win()]);
    assert.equal(balances.get(String(uid)), '75.00000000');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  v1 — huidu.bet
  // ══════════════════════════════════════════════════════════════════════

  await t.test('v1 records a message carrying BOTH a bet and a win', async () => {
    /**
     * Legacy branched on three shapes — bet only, win only, both zero — and ran
     * the balance UPDATE unconditionally afterwards. A winning spin settled in
     * one message matched no branch: `x - bet + win` still ran, and NOTHING was
     * recorded anywhere.
     */
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const serial = newSerial();
    const result = await service.betCallbackV1(
      v1Callback({
        member_account: `h24e9e_USDT_${uid}`,
        currency_code: 'USDT',
        bet_amount: '10',
        win_amount: '25',
        serial_number: serial,
        game_uid: 'g1',
      })
    );

    assert.equal(result.code, CODE.SUCCESS);
    assert.equal(balances.get(String(uid)), '115.00000000', 'net +15');

    const row = await models.JsGameTransactions.findOne({ where: { serial_number: serial }, raw: true });
    assert.ok(row, 'and it left a record — legacy left none');
    assert.equal(row.transaction_type, 'settle');
    assert.equal(String(row.amount), '15.00000000');
  });

  await t.test('v1 refuses a bet larger than the balance instead of going negative', async () => {
    // `x - bet + win` had no floor.
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '5']]);
    const { service } = build(balances);

    const result = await service.betCallbackV1(
      v1Callback({
        member_account: `h24e9e_USDT_${uid}`,
        currency_code: 'USDT',
        bet_amount: '100',
        win_amount: '0',
        serial_number: newSerial(),
      })
    );

    assert.equal(result.code, CODE.INSUFFICIENT_BALANCE);
    assert.equal(balances.get(String(uid)), '5');
  });

  await t.test('v1 pays a retried win ONCE', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '0']]);
    const { service } = build(balances);

    const serial = newSerial();
    const win = () =>
      service.betCallbackV1(
        v1Callback({
          member_account: `h24e9e_USDT_${uid}`,
          currency_code: 'USDT',
          bet_amount: '0',
          win_amount: '60',
          serial_number: serial,
        })
      );

    await win();
    await win();

    assert.equal(balances.get(String(uid)), '60.00000000');
    assert.equal(await models.JsGameTransactions.count({ where: { serial_number: serial } }), 1);
  });

  await t.test('v1 refuses a payload that does not decrypt under our key', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const foreign = new HuiduClient({
      baseUrl: 'https://huidu.test',
      agencyUid: 'agency-1',
      aesKey: 'b'.repeat(32),
      playerPrefix: 'h24e9e',
      logger,
    });

    const result = await service.betCallbackV1({
      agency_uid: 'agency-1',
      payload: foreign.encrypt({
        member_account: `h24e9e_USDT_${uid}`,
        currency_code: 'USDT',
        bet_amount: '0',
        win_amount: '9999',
        serial_number: newSerial(),
      }),
    });

    assert.equal(result.code, CODE.PAYLOAD_ERROR);
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('v1 refuses a callback with no serial number', async () => {
    // Without one the movement cannot be made idempotent, so a retry is a
    // second payment. Legacy accepted it and carried on.
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const result = await service.betCallbackV1(
      v1Callback({
        member_account: `h24e9e_USDT_${uid}`,
        currency_code: 'USDT',
        bet_amount: '0',
        win_amount: '50',
      })
    );

    assert.equal(result.code, CODE.BAD_PARAMETERS);
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('v1 refuses a malformed member account rather than inserting undefined', async () => {
    // `member_account.split('_')[2]` yields `undefined` for a two-part account,
    // and `undefined` then went into the INSERT as the user id.
    const balances = new Map();
    const { service } = build(balances);

    for (const member_account of ['h24e9e_USDT', 'garbage', 'h24e9e_USDT_notanumber', '']) {
      const result = await service.betCallbackV1(
        v1Callback({
          member_account,
          currency_code: 'USDT',
          bet_amount: '0',
          win_amount: '10',
          serial_number: newSerial(),
        })
      );
      assert.equal(result.code, CODE.BAD_PARAMETERS, `${member_account || '(empty)'} must be refused`);
    }
  });

  await t.test('v1 refuses a currency the platform does not settle', async () => {
    // Legacy interpolated this value into SQL as a column name.
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const result = await service.betCallbackV1(
      v1Callback({
        member_account: `h24e9e_USDT_${uid}`,
        currency_code: 'usdt"; DROP TABLE credits; --',
        bet_amount: '0',
        win_amount: '10',
        serial_number: newSerial(),
      })
    );

    assert.equal(result.code, CODE.UNSUPPORTED_CURRENCY);
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('v1 refuses a stale payload', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const result = await service.betCallbackV1({
      agency_uid: 'agency-1',
      payload: v1.encrypt({
        timestamp: String(Date.now() - 3600_000),
        member_account: `h24e9e_USDT_${uid}`,
        currency_code: 'USDT',
        bet_amount: '0',
        win_amount: '50',
        serial_number: newSerial(),
      }),
    });

    assert.equal(result.code, CODE.PAYLOAD_ERROR);
    assert.equal(balances.get(String(uid)), '100');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Transfers
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a transfer INTO the game debits us first, and refunds if the provider refuses', async () => {
    /**
     * Legacy never touched `credits` at all — it told the provider to credit the
     * account and recorded the result. Balance appeared at the provider out of
     * nothing.
     */
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '500']]);

    const refusing = new HuiduClient({
      baseUrl: 'https://huidu.test',
      agencyUid: 'agency-1',
      aesKey: AES_KEY,
      playerPrefix: 'h24e9e',
      logger,
      fetchImpl: async () => ({
        ok: true,
        async json() {
          return { code: CODE.TRANSFER_FAILED, msg: 'Transfer failed' };
        },
      }),
    });

    const { service } = build(balances);
    service.v1 = refusing;

    await assert.rejects(
      () =>
        service.transferV1({
          userId: uid,
          gameUid: 'g1',
          amount: '100',
          transferType: 'deposit',
          currencyCode: 'USDT',
          actor: { id: 1 },
        }),
      (err) => err.code === 'JSGAMES_UPSTREAM_REJECTED'
    );

    assert.equal(balances.get(String(uid)), '500.00000000', 'the debit was put back');
  });

  await t.test('a transfer of zero is refused', async () => {
    const uid = await seedPlayer(newUid());
    const { service } = build(new Map([[String(uid), '500']]));

    await assert.rejects(
      () =>
        service.transferV1({
          userId: uid,
          gameUid: 'g1',
          amount: '0',
          transferType: 'deposit',
          currencyCode: 'USDT',
          actor: { id: 1 },
        }),
      (err) => err.code === 'JSGAMES_TRANSFER_AMOUNT_REQUIRED'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Provider adapters
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a key that is not 32 bytes leaves v1 unconfigured rather than throwing mid-request', async () => {
    // Legacy handed whatever was in the constant straight to `createCipheriv`,
    // so a wrong-length key threw on the first launch of the day.
    const short = new HuiduClient({ baseUrl: 'https://x', agencyUid: 'a', aesKey: 'too-short', playerPrefix: 'p' });
    assert.equal(short.configured, false);
    assert.equal(v1.configured, true);
  });

  await t.test('v1 encryption round-trips', async () => {
    const payload = { a: 1, b: 'two', nested: { c: [1, 2] } };
    assert.deepEqual(v1.decrypt(v1.encrypt(payload)), payload);
    assert.equal(v1.decrypt('not base64 ciphertext'), null, 'and a bad payload is null, not a throw');
  });

  await t.test('the v2 signature is order-independent and covers every field', async () => {
    const timestamp = '1700000000000';
    assert.equal(v2.sign({ b: 2, a: 1, timestamp }), v2.sign({ a: 1, b: 2, timestamp }));
    assert.notEqual(v2.sign({ a: 1, timestamp }), v2.sign({ a: 2, timestamp }));
    assert.match(v2.sign({ a: 1, timestamp }), /^[0-9a-f]{64}$/);
  });

  await t.test('an unconfigured v2 client verifies nothing', async () => {
    const blank = new XGamesApiClient({ baseUrl: '', apiKey: '', apiSecret: '' });
    assert.equal(blank.verify({ body: {}, headers: {} }), 'not configured');
  });

  // Referenced so the import is not merely decorative — the digest below is the
  // shape the provider expects and pins the algorithm.
  await t.test('the v2 scheme is HMAC-SHA256, not a plain hash', async () => {
    const timestamp = '1';
    const plain = crypto.createHash('sha256').update(`a=1&timestamp=${timestamp}`).digest('hex');
    assert.notEqual(v2.sign({ a: 1, timestamp }), plain, 'the secret must be part of it');
  });
});
