'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { SeamlessService } = require('../seamless.service');
const { RESPONSE_CODES } = require('../seamless.constants');

/**
 * The casino seamless wallet.
 *
 * These are the highest-traffic money endpoints on the platform, and the legacy
 * implementation had four independent defects. Each has a test below written as
 * the failure it allowed, not as the feature it implements.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const SECRET = 'test-seamless-secret';
const OPERATOR = 'OP123';

let connection;

let nextUid = 910_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);
let seq = 0;
const newTxId = () => `TX-${process.pid}-${(seq += 1)}`;

/** The provider's timestamp format: UTC, `YYYY-MM-DD HH:mm:ss`. */
const stamp = (at = Date.now()) => new Date(at).toISOString().slice(0, 19).replace('T', ' ');

const sign = (action, requestTime) =>
  crypto.createHash('md5').update(`${OPERATOR}${requestTime}${action}${SECRET}`).digest('hex');

const request = (action, extra = {}) => {
  const requestTime = extra.request_time ?? stamp();
  return {
    operator_code: OPERATOR,
    request_time: requestTime,
    sign: extra.sign ?? sign(action, requestTime),
    product_code: 'P1',
    currency: 'USDT',
    ...extra,
  };
};

test('casino seamless wallet', async (t) => {
  const logger = createLogger({ name: 'seamless-test', level: 'silent' });

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

  /**
   * An in-process wallet standing in for user-service.
   *
   * Deliberately NOT a stub that always succeeds: it enforces the overdraft
   * rule and the idempotency key, because those are the two behaviours the
   * seamless service depends on and the legacy code did not have.
   */
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
        const movement = { ledgerId: applied.size + 1, newBalance: next, replayed: false };
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
        const movement = { ledgerId: applied.size + 1, newBalance: next, replayed: false };
        applied.set(key, movement);
        return movement;
      },
      applied,
    };
  };

  const build = (balances, config = {}) => {
    const wallet = makeWallet(balances);
    const service = new SeamlessService({
      models: connection.models,
      db: connection,
      logger,
      wallet,
      config: {
        SERVICE_NAME: 'casino-service',
        SEAMLESS_SECRET_KEY: SECRET,
        SEAMLESS_OPERATOR_CODE: OPERATOR,
        SEAMLESS_MAX_SKEW_SECONDS: 300,
        SEAMLESS_SIGN_MODE: 'legacy',
        ...config,
      },
    });
    return { service, wallet };
  };

  const player = (balance = '1000') => {
    const uid = newUid();
    return { uid, balances: new Map([[String(uid), balance]]) };
  };

  // ══════════════════════════════════════════════════════════════════════
  //  Duplicate detection — legacy's was a stub returning false
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a retried WIN is paid once', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);
    const id = newTxId();

    const body = request('deposit', { member_account: String(uid), transactions: [{ id, amount: '50' }] });

    const first = await service.deposit(body);
    const second = await service.deposit({ ...body, request_time: stamp(), sign: sign('deposit', stamp()) });

    assert.equal(first.code, RESPONSE_CODES.SUCCESS);
    assert.equal(second.code, RESPONSE_CODES.SUCCESS, 'a retry must look successful or the provider retries forever');
    assert.equal(balances.get(String(uid)), '150.00000000', 'legacy paid this twice');
  });

  await t.test('a retried BET is charged once', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);
    const id = newTxId();
    const body = request('withdraw', { member_account: String(uid), transactions: [{ id, amount: '30' }] });

    await service.withdraw(body);
    await service.withdraw(body);

    assert.equal(balances.get(String(uid)), '70.00000000');
  });

  await t.test('concurrent retries of the same transaction apply once', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);
    const id = newTxId();
    const body = request('deposit', { member_account: String(uid), transactions: [{ id, amount: '25' }] });

    await Promise.all([service.deposit(body), service.deposit(body), service.deposit(body)]);

    assert.equal(balances.get(String(uid)), '125.00000000');
    assert.equal(
      await connection.models.SeamlessTransaction.count({ where: { transaction_id: id } }),
      1,
      'the unique index decides, not an application check'
    );
  });

  await t.test('a half-applied batch completes on retry rather than re-applying', async () => {
    // A batch of two where the second is new: the retry must skip the first and
    // apply the second. A single summed movement could not express that.
    const { uid, balances } = player('100');
    const { service } = build(balances);
    const first = newTxId();
    const second = newTxId();

    await service.deposit(
      request('deposit', { member_account: String(uid), transactions: [{ id: first, amount: '10' }] })
    );

    await service.deposit(
      request('deposit', {
        member_account: String(uid),
        transactions: [{ id: first, amount: '10' }, { id: second, amount: '20' }],
      })
    );

    assert.equal(balances.get(String(uid)), '130.00000000');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Replay — the signature covers only the action name
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a STALE request_time is refused', async () => {
    // The whole mitigation for the weak signature. Without it, a captured
    // signature is valid forever for any member and any amount.
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const old = stamp(Date.now() - 3600_000);
    const body = request('deposit', {
      member_account: String(uid),
      request_time: old,
      sign: sign('deposit', old),
      transactions: [{ id: newTxId(), amount: '999999' }],
    });

    const result = await service.deposit(body);

    assert.equal(result.code, RESPONSE_CODES.INVALID_SIGN);
    assert.equal(balances.get(String(uid)), '100', 'nothing may move on a stale request');
  });

  await t.test('an unparseable request_time is refused, not accepted', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const result = await service.deposit(
      request('deposit', {
        member_account: String(uid),
        request_time: 'not-a-time',
        sign: sign('deposit', 'not-a-time'),
        transactions: [{ id: newTxId(), amount: '100' }],
      })
    );

    assert.equal(result.code, RESPONSE_CODES.INVALID_SIGN, 'failing closed is the only safe direction');
  });

  await t.test('a wrong signature is refused', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const result = await service.deposit(
      request('deposit', {
        member_account: String(uid),
        sign: 'f'.repeat(32),
        transactions: [{ id: newTxId(), amount: '100' }],
      })
    );

    assert.equal(result.code, RESPONSE_CODES.INVALID_SIGN);
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('a signature for a DIFFERENT action does not transfer', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);
    const at = stamp();

    const result = await service.deposit({
      operator_code: OPERATOR,
      request_time: at,
      // A valid signature — for `withdraw`.
      sign: sign('withdraw', at),
      currency: 'USDT',
      member_account: String(uid),
      transactions: [{ id: newTxId(), amount: '100' }],
    });

    assert.equal(result.code, RESPONSE_CODES.INVALID_SIGN);
  });

  await t.test('another operator code is refused', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);
    const at = stamp();

    const result = await service.deposit({
      operator_code: 'SOMEONE-ELSE',
      request_time: at,
      sign: crypto.createHash('md5').update(`SOMEONE-ELSE${at}deposit${SECRET}`).digest('hex'),
      currency: 'USDT',
      member_account: String(uid),
      transactions: [{ id: newTxId(), amount: '100' }],
    });

    assert.equal(result.code, RESPONSE_CODES.INCORRECT_AGENT_KEY);
  });

  await t.test('an unconfigured integration refuses rather than checking against undefined', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances, { SEAMLESS_SECRET_KEY: '' });

    const result = await service.deposit(
      request('deposit', { member_account: String(uid), transactions: [{ id: newTxId(), amount: '100' }] })
    );

    assert.equal(result.code, RESPONSE_CODES.PRODUCT_UNDER_MAINTENANCE);
  });

  await t.test('the FULL signing mode covers the member and the amounts', async () => {
    // With this on, a captured signature is worthless for any other request —
    // the replay problem disappears rather than being narrowed by the clock.
    const { uid, balances } = player('100');
    const { service } = build(balances, { SEAMLESS_SIGN_MODE: 'full' });

    const at = stamp();
    const id = newTxId();
    const full = (member, txs) =>
      crypto
        .createHash('sha256')
        .update(
          `${OPERATOR}${at}deposit${member}${txs.map((x) => `${x.id}:${x.amount}`).sort().join('|')}${SECRET}`
        )
        .digest('hex');

    const txs = [{ id, amount: '50' }];

    const good = await service.deposit({
      operator_code: OPERATOR, request_time: at, sign: full(String(uid), txs),
      currency: 'USDT', member_account: String(uid), transactions: txs,
    });
    assert.equal(good.code, RESPONSE_CODES.SUCCESS);

    // The same signature, pointed at a bigger amount.
    const forged = await service.deposit({
      operator_code: OPERATOR, request_time: at, sign: full(String(uid), txs),
      currency: 'USDT', member_account: String(uid), transactions: [{ id: newTxId(), amount: '999999' }],
    });
    assert.equal(forged.code, RESPONSE_CODES.INVALID_SIGN);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The thousands conversion — legacy scaled the whole balance
  // ══════════════════════════════════════════════════════════════════════

  await t.test('an IDR2 bet scales the AMOUNT, not the balance', async () => {
    // Legacy: `balance -= amount; if (isThousands) balance /= 1000;` then STORED
    // it. A player holding 1,000 who opened one IDR2 game was left with 1.
    const { uid, balances } = player('1000');
    const { service } = build(balances);

    const result = await service.withdraw(
      request('withdraw', {
        member_account: String(uid),
        currency: 'IDR2',
        transactions: [{ id: newTxId(), amount: '0.05' }], // 0.05 × 1000 = 50
      })
    );

    assert.equal(result.code, RESPONSE_CODES.SUCCESS);
    assert.equal(balances.get(String(uid)), '950.00000000', 'the balance must not be divided by 1000');
  });

  await t.test('an IDR2 balance is QUOTED in the provider’s units', async () => {
    const { uid, balances } = player('1000');
    const { service } = build(balances);

    const result = await service.getBalance(
      request('getbalance', { member_account: String(uid), currency: 'IDR2' })
    );

    assert.equal(result.code, RESPONSE_CODES.SUCCESS);
    assert.equal(result.balance, 1, '1,000 real units is 1 in thousands-quoted currency');
  });

  await t.test('a normal currency is not scaled at all', async () => {
    const { uid, balances } = player('1000');
    const { service } = build(balances);

    const result = await service.getBalance(request('getbalance', { member_account: String(uid) }));
    assert.equal(result.balance, 1000);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Balance handling
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a bet beyond the balance is refused and nothing moves', async () => {
    const { uid, balances } = player('10');
    const { service } = build(balances);

    const result = await service.withdraw(
      request('withdraw', { member_account: String(uid), transactions: [{ id: newTxId(), amount: '500' }] })
    );

    assert.equal(result.code, RESPONSE_CODES.INSUFFICIENT_BALANCE);
    assert.equal(balances.get(String(uid)), '10');
  });

  await t.test('an unknown member is reported as such', async () => {
    const { service } = build(new Map());
    const result = await service.getBalance(request('getbalance', { member_account: '999999999' }));
    assert.equal(result.code, RESPONSE_CODES.MEMBER_NOT_EXISTS);
  });

  await t.test('an unsupported currency is refused', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const result = await service.deposit(
      request('deposit', {
        member_account: String(uid), currency: 'XYZ',
        transactions: [{ id: newTxId(), amount: '10' }],
      })
    );
    assert.equal(result.code, RESPONSE_CODES.INCORRECT_AGENT_KEY);
  });

  await t.test('a transaction with no id is refused', async () => {
    // Without an id there is nothing to key idempotency on, so it cannot be
    // applied safely at all.
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const result = await service.deposit(
      request('deposit', { member_account: String(uid), transactions: [{ amount: '10' }] })
    );
    assert.equal(result.code, RESPONSE_CODES.API_ERROR);
    assert.equal(balances.get(String(uid)), '100');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Rollback and cancel
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a rollback returns OUR recorded amount, not the one it names', async () => {
    // Legacy reversed whatever the request said, so a rollback quoting a larger
    // figure than the bet it reverses was a withdrawal with extra steps.
    const { uid, balances } = player('100');
    const { service } = build(balances);
    const id = newTxId();

    await service.withdraw(
      request('withdraw', { member_account: String(uid), transactions: [{ id, amount: '40' }] })
    );
    assert.equal(balances.get(String(uid)), '60.00000000');

    const result = await service.rollback(
      request('rollback', {
        member_account: String(uid),
        transactions: [{ id, amount: '999999' }], // the lie
      })
    );

    assert.equal(result.code, RESPONSE_CODES.SUCCESS);
    assert.equal(balances.get(String(uid)), '100.00000000', 'exactly the bet is returned');
  });

  await t.test('a repeated rollback reverses once', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);
    const id = newTxId();

    await service.withdraw(
      request('withdraw', { member_account: String(uid), transactions: [{ id, amount: '25' }] })
    );

    const body = request('rollback', { member_account: String(uid), transactions: [{ id }] });
    await service.rollback(body);
    await service.rollback(body);

    assert.equal(balances.get(String(uid)), '100.00000000');
  });

  await t.test('rolling back a WIN takes the money back', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);
    const id = newTxId();

    await service.deposit(
      request('deposit', { member_account: String(uid), transactions: [{ id, amount: '50' }] })
    );
    assert.equal(balances.get(String(uid)), '150.00000000');

    await service.rollback(request('rollback', { member_account: String(uid), transactions: [{ id }] }));
    assert.equal(balances.get(String(uid)), '100.00000000');
  });

  await t.test('rolling back something we never applied is refused', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const result = await service.rollback(
      request('rollback', { member_account: String(uid), transactions: [{ id: 'NEVER-HAPPENED' }] })
    );

    assert.equal(result.code, RESPONSE_CODES.BET_NOT_EXIST, 'this must not look like it worked');
    assert.equal(balances.get(String(uid)), '100');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Audit
  // ══════════════════════════════════════════════════════════════════════

  await t.test('every applied movement leaves a traceable record', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);
    const id = newTxId();

    await service.deposit(
      request('deposit', {
        member_account: String(uid),
        transactions: [{ id, amount: '15', round_id: 'R-1', game_code: 'G-1' }],
      })
    );

    const row = await connection.models.SeamlessTransaction.findOne({
      where: { transaction_id: id }, raw: true,
    });

    assert.ok(row, 'legacy recorded nothing at all');
    assert.equal(row.round_id, 'R-1');
    assert.equal(row.game_code, 'G-1');
    assert.ok(row.ledger_id, 'and the ledger row it produced is linked');
  });
});
