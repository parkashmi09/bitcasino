'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { XCasinoService } = require('../xCasino.service');
const { verify, legacyHash, payloadHash, isFresh } = require('../signature');
const v = require('../xCasino.validators');

/**
 * The XGaming aggregator.
 *
 * Two attacks this file exists to prove are closed:
 *
 *   1. one captured callback authenticated ANY payload, because the signature
 *      covered `command` and `request_timestamp` and not `data`;
 *   2. the wallet column came from an unauthenticated request body and was
 *      interpolated into `UPDATE credits SET ${coin} = $1`.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const SECRET = 'test-casino-secret';

let connection;

let nextId = 200_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

let seq = 0;
const newTxId = () => `tx-${process.pid}-${(seq += 1)}`;

/** The provider's timestamp format. */
const stamp = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString().replace('T', ' ').slice(0, 19);

test('the signature covers the payload', async (t) => {
  await t.test('A CAPTURED CALLBACK NO LONGER AUTHENTICATES A DIFFERENT BODY', () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * THE ATTACK
     *
     * Legacy signed `command + request_timestamp + SECRET`. `data` — where
     * `user_id`, `amount` and `transaction_type` live — was not covered.
     *
     * Below: a genuine 10-rupee bet is captured, and its `data` is replaced
     * with a million-rupee win for a different account. The three signed
     * fields are untouched.
     * ═══════════════════════════════════════════════════════════════════
     */
    const command = 'changebalance';
    const requestTimestamp = stamp();

    const genuineBody = JSON.stringify({
      command,
      request_timestamp: requestTimestamp,
      data: { user_id: 1001, transaction_type: 'BET', amount: 10 },
    });

    const forgedBody = JSON.stringify({
      command,
      request_timestamp: requestTimestamp,
      data: { user_id: 2002, transaction_type: 'WIN', amount: 1000000 },
    });

    // The hash the ATTACKER holds — computed the legacy way, over the genuine
    // request. It contains nothing about the body.
    const captured = legacyHash({ command, requestTimestamp, secret: SECRET });

    // Legacy would have accepted it against the forged body: the inputs to its
    // hash function are identical for both.
    assert.equal(
      legacyHash({ command, requestTimestamp, secret: SECRET }),
      captured,
      'the legacy hash is the same for both bodies — that IS the vulnerability'
    );

    // Here it does not verify against either body, because the body is signed.
    assert.equal(
      verify({ command, requestTimestamp, rawBody: forgedBody, hash: captured, secret: SECRET }).ok,
      false,
      'THE FORGED BODY IS REFUSED'
    );
    assert.equal(
      verify({ command, requestTimestamp, rawBody: genuineBody, hash: captured, secret: SECRET }).ok,
      false,
      'and so is the genuine one, on the old hash'
    );

    // A correctly signed request verifies.
    const proper = payloadHash({ command, requestTimestamp, rawBody: genuineBody, secret: SECRET });
    const verdict = verify({ command, requestTimestamp, rawBody: genuineBody, hash: proper, secret: SECRET });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.mode, 'payload');
  });

  await t.test('a tampered body does not verify', () => {
    const command = 'changebalance';
    const requestTimestamp = stamp();
    const body = JSON.stringify({ data: { amount: 10 } });
    const hash = payloadHash({ command, requestTimestamp, rawBody: body, secret: SECRET });

    const tampered = JSON.stringify({ data: { amount: 999999 } });
    assert.equal(verify({ command, requestTimestamp, rawBody: tampered, hash, secret: SECRET }).ok, false);
  });

  await t.test('the legacy hash is accepted ONLY when explicitly enabled', () => {
    const command = 'balance';
    const requestTimestamp = stamp();
    const body = '{}';
    const hash = legacyHash({ command, requestTimestamp, secret: SECRET });

    assert.equal(verify({ command, requestTimestamp, rawBody: body, hash, secret: SECRET }).ok, false);

    const permitted = verify({ command, requestTimestamp, rawBody: body, hash, secret: SECRET, allowLegacy: true });
    assert.equal(permitted.ok, true);
    assert.equal(permitted.mode, 'legacy', 'and it says which mode let it through, so the caller can log it');
  });

  await t.test('A STALE REQUEST IS REFUSED', () => {
    /**
     * Legacy put `request_timestamp` inside the hash and never compared it to
     * a clock, so a captured request stayed valid forever. Combined with the
     * unsigned payload, that made one capture a permanent credential.
     */
    const command = 'balance';
    const old = stamp(-60 * 60 * 1000);
    const body = '{}';
    const hash = payloadHash({ command, requestTimestamp: old, rawBody: body, secret: SECRET });

    const verdict = verify({ command, requestTimestamp: old, rawBody: body, hash, secret: SECRET });
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'stale or unparseable timestamp');
  });

  await t.test('a timestamp far in the future is refused too', () => {
    // Otherwise a request could be built to outlive the freshness window.
    assert.equal(isFresh(stamp(60 * 60 * 1000)), false);
    assert.equal(isFresh(stamp(-30 * 1000)), true, 'but a recent one is fine');
    assert.equal(isFresh(stamp(30 * 1000)), true, 'and a little clock skew is tolerated');
  });

  await t.test('an unparseable timestamp is refused rather than treated as now', () => {
    assert.equal(isFresh('not a date'), false);
    assert.equal(isFresh(''), false);
    assert.equal(isFresh(null), false);
  });

  await t.test('no configured secret means nothing verifies', () => {
    // Better than a deployment that silently accepts everything.
    assert.equal(verify({ command: 'x', requestTimestamp: stamp(), rawBody: '{}', hash: 'a', secret: '' }).ok, false);
  });
});

test('validators refuse what became SQL', async (t) => {
  await t.test('A CURRENCY CARRYING SQL IS REFUSED', () => {
    /**
     * Legacy: `UPDATE credits SET ${coin} = $1 WHERE uid = $2`, with `coin`
     * from `game_runs.coin` — written by the unauthenticated `/gamerun` route
     * straight from the request body.
     */
    const parse = (currency) =>
      v.openGame.body.safeParse({ gameId: 1, currency });

    assert.equal(parse('INR').success, true);
    assert.equal(parse('inr = 999999, usdt').success, false);
    assert.equal(parse('NOTACOIN').success, false);
    assert.equal(parse('').success, false);
  });

  await t.test('`user_id` is not accepted on the launch body at all', () => {
    // It comes from the token. `.strict()` refuses it outright rather than
    // ignoring it, so a client still sending it learns.
    assert.equal(v.openGame.body.safeParse({ gameId: 1, currency: 'INR', userId: 5 }).success, false);
    assert.equal(v.openGame.body.safeParse({ gameId: 1, currency: 'INR', user_id: 5 }).success, false);
  });

  await t.test('a negative amount is refused', () => {
    // A negative BET is a credit wearing a debit's name.
    const body = (amount) => ({
      command: 'changebalance',
      request_timestamp: stamp(),
      hash: 'a'.repeat(40),
      data: {
        session: 'x'.repeat(16), user_id: 1, transaction_id: 't1',
        transaction_type: 'BET', amount, round_finished: false,
      },
    });
    assert.equal(v.changeBalance.body.safeParse(body('10.50')).success, true);
    assert.equal(v.changeBalance.body.safeParse(body(-10)).success, false);
    assert.equal(v.changeBalance.body.safeParse(body('-10')).success, false);
  });

  await t.test('an unknown transaction type is refused', () => {
    const parsed = v.changeBalance.body.safeParse({
      command: 'changebalance',
      request_timestamp: stamp(),
      hash: 'a'.repeat(40),
      data: {
        session: 'x'.repeat(16), user_id: 1, transaction_id: 't1',
        transaction_type: 'FREEMONEY', amount: '1', round_finished: false,
      },
    });
    assert.equal(parsed.success, false);
  });
});

test('the aggregator against a database', async (t) => {
  const logger = createLogger({ name: 'xcasino-test', level: 'silent' });

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

  const { models } = connection;
  const service = new XCasinoService({
    models,
    db: connection,
    logger,
    config: {
      XCASINO_SECRET: SECRET,
      XCASINO_ID: 'test-casino',
      XCASINO_GAMERUN_URL: 'https://gamerun.test',
      XCASINO_GAMERUN_URL_ALT: 'https://gamerun-alt.test',
      XCASINO_PRIMARY_VENDORS: 'evolution,pragmatic',
    },
  });

  const player = newId();
  const locked = newId();

  t.before(async () => {
    for (const id of [player, locked]) {
      await models.TransactionsCasino.destroy({ where: { user_id: id } });
      await models.GameRuns.destroy({ where: { user_id: id } });
      await models.Credits.destroy({ where: { uid: id } });
      await models.Users.destroy({ where: { id } });
    }

    await models.Users.bulkCreate([
      { id: player, name: `xc-${player}`, password: 'x', status: 'active' },
      { id: locked, name: `xl-${locked}`, password: 'x', status: 'active', casino_locked: true },
    ]);
    await models.Credits.bulkCreate([
      { uid: player, inr: '1000' },
      { uid: locked, inr: '1000' },
    ]);
  });

  t.after(async () => {
    for (const id of [player, locked]) {
      await models.TransactionsCasino.destroy({ where: { user_id: id } });
      await models.GameRuns.destroy({ where: { user_id: id } });
      await models.Credits.destroy({ where: { uid: id } });
      await models.Users.destroy({ where: { id } });
    }
    if (connection) await connection.close();
  });

  const balanceOf = async (uid) => {
    const row = await models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };

  const openSession = async (userId = player) => {
    const run = await service.openGame({ userId, gameId: 42, currency: 'INR', vendor: 'evolution' });
    return run.session;
  };

  await t.test('a launch produces an https URL carrying the session', async () => {
    const run = await service.openGame({ userId: player, gameId: 42, currency: 'INR', vendor: 'evolution' });

    assert.ok(run.gameRunUrl.startsWith('https://gamerun.test/'));
    assert.ok(run.gameRunUrl.includes(`session=${run.session}`));
    assert.equal(run.session.length, 64, '32 random bytes, hex');
  });

  await t.test('a LOCKED player cannot open a game', async () => {
    // Legacy checked nothing here, so an account the operator had locked could
    // still launch a casino game.
    await assert.rejects(
      () => service.openGame({ userId: locked, gameId: 42, currency: 'INR' }),
      (err) => err.code === 'XCASINO_PLAYER_LOCKED'
    );
  });

  await t.test('a bet debits exactly once and records the transaction', async () => {
    const session = await openSession();
    const before = await balanceOf(player);
    const transactionId = newTxId();

    const result = await service.changeBalance({
      session, userId: player, transactionId, roundId: 'r1',
      transactionType: 'BET', amount: '100', roundFinished: false,
    });

    assert.equal(result.balance, 900);
    assert.equal(await balanceOf(player), money.toDecimalString(money.toMinor(before) - money.toMinor('100')));

    /**
     * The record legacy could never write — `transactionscasino` did not exist,
     * and the INSERT ran AFTER the balance had already moved.
     */
    const row = await models.TransactionsCasino.findOne({ where: { transaction_id: transactionId }, raw: true });
    assert.equal(row.transaction_status, 'OK');
    assert.equal(row.balance_before, '1000.00000000');
    assert.equal(row.balance_after, '900.00000000');
    assert.equal(row.wallet, 'inr');
  });

  await t.test('A RETRY IS IDEMPOTENT — it does not debit twice', async () => {
    /**
     * A provider retries on a timeout, and legacy's only duplicate check was a
     * SELECT against the table that did not exist — so every retry moved the
     * balance again.
     */
    const session = await openSession();
    const transactionId = newTxId();
    const before = await balanceOf(player);

    await service.changeBalance({
      session, userId: player, transactionId, transactionType: 'BET', amount: '50', roundFinished: false,
    });
    const second = await service.changeBalance({
      session, userId: player, transactionId, transactionType: 'BET', amount: '50', roundFinished: false,
    });

    assert.equal(second.replayed, true);
    assert.equal(
      await balanceOf(player),
      money.toDecimalString(money.toMinor(before) - money.toMinor('50')),
      'debited once'
    );

    const count = await models.TransactionsCasino.count({ where: { transaction_id: transactionId } });
    assert.equal(count, 1);
  });

  await t.test('TWO SIMULTANEOUS RETRIES DEBIT ONCE', async () => {
    const session = await openSession();
    const transactionId = newTxId();
    const before = await balanceOf(player);

    const call = () =>
      service.changeBalance({
        session, userId: player, transactionId, transactionType: 'BET', amount: '25', roundFinished: false,
      });

    await Promise.allSettled([call(), call()]);

    assert.equal(await balanceOf(player), money.toDecimalString(money.toMinor(before) - money.toMinor('25')));
    assert.equal(await models.TransactionsCasino.count({ where: { transaction_id: transactionId } }), 1);
  });

  await t.test('CONCURRENT BETS CANNOT OVERDRAW', async () => {
    /**
     * Legacy read the balance, computed in JavaScript and wrote an ABSOLUTE
     * value — so two concurrent bets both saw the same balance and the second
     * write erased the first. The player bet twice and paid once.
     *
     * Ten bets of 200 against a balance of 1000: exactly five may succeed.
     */
    const solo = newId();
    await models.Users.create({ id: solo, name: `xs-${solo}`, password: 'x', status: 'active' });
    await models.Credits.create({ uid: solo, inr: '1000' });

    const session = await openSession(solo);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        service.changeBalance({
          session, userId: solo, transactionId: newTxId(),
          transactionType: 'BET', amount: '200', roundFinished: false,
        })
      )
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    assert.equal(succeeded, 5, 'exactly five of ten');
    assert.equal(await balanceOf(solo), '0.00000000', 'and never negative');

    await models.TransactionsCasino.destroy({ where: { user_id: solo } });
    await models.GameRuns.destroy({ where: { user_id: solo } });
    await models.Credits.destroy({ where: { uid: solo } });
    await models.Users.destroy({ where: { id: solo } });
  });

  await t.test('a bet beyond the balance is refused and moves nothing', async () => {
    const session = await openSession();
    const before = await balanceOf(player);

    await assert.rejects(
      () =>
        service.changeBalance({
          session, userId: player, transactionId: newTxId(),
          transactionType: 'BET', amount: '99999999', roundFinished: false,
        }),
      (err) => err.code === 'XCASINO_INSUFFICIENT_FUNDS'
    );

    assert.equal(await balanceOf(player), before);
  });

  await t.test('a win credits', async () => {
    const session = await openSession();
    const before = await balanceOf(player);

    await service.changeBalance({
      session, userId: player, transactionId: newTxId(),
      transactionType: 'WIN', amount: '250.75', roundFinished: true,
    });

    assert.equal(await balanceOf(player), money.toDecimalString(money.toMinor(before) + money.toMinor('250.75')));
  });

  await t.test('money keeps full precision through the ledger', async () => {
    const session = await openSession();
    const before = await balanceOf(player);

    await service.changeBalance({
      session, userId: player, transactionId: newTxId(),
      transactionType: 'WIN', amount: '0.00000001', roundFinished: true,
    });

    assert.equal(
      await balanceOf(player),
      money.toDecimalString(money.toMinor(before) + money.toMinor('0.00000001')),
      'legacy rounded to two places with toFixed and read every numeric as a float'
    );
  });

  await t.test("A SESSION CANNOT BE USED FOR ANOTHER PLAYER'S ACCOUNT", async () => {
    const session = await openSession(player);

    await assert.rejects(
      () =>
        service.changeBalance({
          session, userId: locked, transactionId: newTxId(),
          transactionType: 'WIN', amount: '1000000', roundFinished: true,
        }),
      (err) => err.code === 'XCASINO_INVALID_SESSION'
    );

    assert.equal(await balanceOf(locked), '1000.00000000');
  });

  await t.test('an unknown session is refused', async () => {
    await assert.rejects(
      () => service.balance({ session: 'no-such-session-at-all', userId: player }),
      (err) => err.code === 'XCASINO_INVALID_SESSION'
    );
  });

  await t.test('a cancel returns the stake once', async () => {
    const session = await openSession();
    const transactionId = newTxId();

    await service.changeBalance({
      session, userId: player, transactionId, transactionType: 'BET', amount: '75', roundFinished: false,
    });
    const afterBet = await balanceOf(player);

    await service.cancel({ transactionId, userId: player });
    const afterCancel = await balanceOf(player);
    assert.equal(afterCancel, money.toDecimalString(money.toMinor(afterBet) + money.toMinor('75')));

    // Cancelling again returns the same outcome rather than crediting twice.
    await service.cancel({ transactionId, userId: player });
    assert.equal(await balanceOf(player), afterCancel);
  });

  await t.test('a WIN cannot be cancelled', async () => {
    // Clawing money out of a wallet the player may have spent from is a
    // different operation from handing a stake back.
    const session = await openSession();
    const transactionId = newTxId();

    await service.changeBalance({
      session, userId: player, transactionId, transactionType: 'WIN', amount: '10', roundFinished: true,
    });

    await assert.rejects(
      () => service.cancel({ transactionId, userId: player }),
      (err) => err.code === 'XCASINO_CANNOT_CANCEL'
    );
  });

  await t.test('the status lookup answers, which is what makes a timeout recoverable', async () => {
    /**
     * Legacy read `transactionscasino` here — the table that did not exist —
     * so it answered error 90 to every question. A provider that cannot find
     * out whether a transaction landed resolves the ambiguity by retrying the
     * money move.
     */
    const session = await openSession();
    const transactionId = newTxId();

    await service.changeBalance({
      session, userId: player, transactionId, transactionType: 'BET', amount: '5', roundFinished: false,
    });

    const found = await service.status({ transactionId, userId: player });
    assert.equal(found.found, true);
    assert.equal(found.transaction_status, 'OK');
    assert.equal(found.amount, 5);

    const missing = await service.status({ transactionId: 'never-happened' });
    assert.equal(missing.found, false);
  });

  await t.test('authenticate reports the session, the player and the balance', async () => {
    const session = await openSession();
    const auth = await service.authenticate({ session });

    assert.equal(auth.user_id, String(player));
    assert.equal(auth.currency_code, 'INR');
    assert.equal(typeof auth.balance, 'number');
  });

  await t.test('a currency that disagrees with the session is refused', async () => {
    // Legacy ignored `currency_code` and answered from the session's wallet
    // whatever the provider asked about.
    const session = await openSession();
    await assert.rejects(
      () => service.balance({ session, userId: player, currencyCode: 'BTC' }),
      (err) => err.code === 'XCASINO_CURRENCY_MISMATCH'
    );
  });

  await t.test('an insecure game-run host is refused', async () => {
    // The launch URL carries the session token in its query string.
    const insecure = new XCasinoService({
      models, db: connection, logger,
      config: { XCASINO_GAMERUN_URL: 'http://gamerun.test', XCASINO_ID: 'x' },
    });

    await assert.rejects(
      () => insecure.openGame({ userId: player, gameId: 1, currency: 'INR' }),
      (err) => err.code === 'XCASINO_NOT_CONFIGURED'
    );
  });

  await t.test('an unconfigured host fails loudly rather than using a compiled-in one', async () => {
    const unconfigured = new XCasinoService({ models, db: connection, logger, config: {} });
    await assert.rejects(
      () => unconfigured.openGame({ userId: player, gameId: 1, currency: 'INR' }),
      (err) => err.code === 'XCASINO_NOT_CONFIGURED'
    );
  });
});
