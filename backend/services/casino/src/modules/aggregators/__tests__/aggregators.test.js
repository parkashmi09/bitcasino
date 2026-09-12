'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { AggregatorsService } = require('../aggregators.service');

/**
 * The three remaining casino wallet callbacks.
 *
 * The first test is the one that matters: `/processRequest` credited any amount
 * to any named player, to anyone who could reach the port.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

const ASIA_KEY = 'asia-shared-secret';
const NEXUS_KEY = 'nexus-shared-secret';
const EVO_KEY = 'evo-shared-secret';

let connection;

let nextUid = 995_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

let seq = 0;
const newRef = () => `AG-${process.pid}-${(seq += 1)}`;

test('casino aggregators', async (t) => {
  const logger = createLogger({ name: 'aggregators-test', level: 'silent' });

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

  const broadcasts = [];

  const build = (balances, config = {}) => {
    const wallet = makeWallet(balances);
    const service = new AggregatorsService({
      models,
      db: connection,
      logger,
      wallet,
      onSettled: (event) => broadcasts.push(event),
      config: {
        AGGREGATOR_ASIA_SECRET: ASIA_KEY,
        AGGREGATOR_NEXUS_SECRET: NEXUS_KEY,
        AGGREGATOR_EVO_SECRET: EVO_KEY,
        ...config,
      },
    });
    return { service, wallet };
  };

  const player = (balance = '1000') => {
    const uid = newUid();
    return { uid, balances: new Map([[String(uid), balance]]) };
  };

  const asiaHeaders = { 'x-aggregator-key': ASIA_KEY };
  const nexusHeaders = { 'x-aggregator-key': NEXUS_KEY };
  const evoHeaders = { 'x-aggregator-key': EVO_KEY };

  // ══════════════════════════════════════════════════════════════════════
  //  asiaapi — /processRequest
  // ══════════════════════════════════════════════════════════════════════

  await t.test('an unauthenticated writeBet mints NOTHING', async () => {
    /**
     * The legacy handler, in full:
     *
     *     const newBalance = parseFloat(userBalance) - parseFloat(bet) + parseFloat(win);
     *     await updateUserBalanceNew(login, newBalance.toFixed(2));
     *
     * with no key, no signature and no session. This is that request.
     */
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const result = await service.asia({
      body: { cmd: 'writeBet', login: uid, bet: '0.01', win: '1000000', tradeId: newRef() },
      headers: {},
    });

    assert.equal(result.status, 'fail');
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('a wrong shared secret mints nothing either', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const result = await service.asia({
      body: { cmd: 'writeBet', login: uid, bet: '1', win: '99999', tradeId: newRef() },
      headers: { 'x-aggregator-key': 'not-the-key' },
    });

    assert.equal(result.status, 'fail');
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('an aggregator with NO secret configured refuses rather than falling open', async () => {
    // The legacy behaviour was "no check at all". An unset secret must not
    // reproduce it.
    const { uid, balances } = player('100');
    const { service } = build(balances, { AGGREGATOR_ASIA_SECRET: undefined });

    const result = await service.asia({
      body: { cmd: 'getBalance', login: uid },
      headers: { 'x-aggregator-key': '' },
    });

    assert.equal(result.status, 'fail');
  });

  await t.test('a settled round moves the NET, once', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const tradeId = newRef();
    const settle = () =>
      service.asia({
        body: { cmd: 'writeBet', login: uid, bet: '10', win: '25', tradeId, gameId: 'g1', sessionId: 's1' },
        headers: asiaHeaders,
      });

    const first = await settle();
    const second = await settle();

    assert.equal(first.status, 'success');
    assert.equal(balances.get(String(uid)), '115.00000000', 'net +15');
    assert.equal(second.balance, '115.00', 'the retry is told the same figure');
    assert.equal(
      await models.AggregatorTransaction.count({ where: { aggregator: 'asia', transaction_id: tradeId } }),
      1
    );
  });

  await t.test('concurrent retries settle once', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const tradeId = newRef();
    const settle = () =>
      service.asia({ body: { cmd: 'writeBet', login: uid, bet: '0', win: '50', tradeId }, headers: asiaHeaders });

    await Promise.all([settle(), settle(), settle()]);
    assert.equal(balances.get(String(uid)), '150.00000000');
  });

  await t.test('a stake larger than the balance is refused with the provider\'s own code', async () => {
    const { uid, balances } = player('5');
    const { service } = build(balances);

    const result = await service.asia({
      body: { cmd: 'writeBet', login: uid, bet: '100', win: '0', tradeId: newRef() },
      headers: asiaHeaders,
    });

    assert.equal(result.error, 'fail_balance');
    assert.equal(balances.get(String(uid)), '5');
  });

  await t.test('a settlement with no trade id is refused — a retry could not be recognised', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const result = await service.asia({
      body: { cmd: 'writeBet', login: uid, bet: '0', win: '10' },
      headers: asiaHeaders,
    });

    assert.equal(result.status, 'fail');
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('a junk amount is refused rather than becoming NaN', async () => {
    /**
     * `parseFloat("12abc")` is 12 and `parseFloat("abc")` is NaN — and NaN then
     * flowed through the balance arithmetic and out of `toFixed(2)` as the
     * string "NaN", which is what got written.
     */
    const { uid, balances } = player('100');
    const { service } = build(balances);

    for (const win of ['abc', '12abc', '-5', '', 'Infinity']) {
      const result = await service.asia({
        body: { cmd: 'writeBet', login: uid, bet: '0', win, tradeId: newRef() },
        headers: asiaHeaders,
      });
      assert.equal(result.status, 'fail', `win=${JSON.stringify(win)} must be refused`);
    }

    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('an unknown player is refused, not treated as having zero', async () => {
    // `getUserBalanceNew` returned the string "0.00" for a missing row, so an
    // unknown login looked real and failed later, at the UPDATE.
    const { service } = build(new Map());

    const result = await service.asia({ body: { cmd: 'getBalance', login: 999999999 }, headers: asiaHeaders });
    assert.equal(result.status, 'fail');
  });

  await t.test('a non-numeric login never reaches a query', async () => {
    const { service } = build(new Map());
    const result = await service.asia({ body: { cmd: 'getBalance', login: "1 OR 1=1" }, headers: asiaHeaders });
    assert.equal(result.status, 'fail');
  });

  await t.test('getBalance answers in the provider envelope', async () => {
    const { uid, balances } = player('42.5');
    const { service } = build(balances);

    const result = await service.asia({ body: { cmd: 'getBalance', login: uid }, headers: asiaHeaders });

    assert.equal(result.status, 'success');
    assert.equal(result.balance, '42.50');
    assert.equal(result.currency, 'USD');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  nexus — /gold_api
  // ══════════════════════════════════════════════════════════════════════

  await t.test('nexus settles the net and is idempotent on txn_id', async () => {
    const { uid, balances } = player('500');
    const { service } = build(balances);

    const txnId = newRef();
    const body = {
      method: 'transaction',
      user_code: uid,
      game_type: 'slot',
      slot: { bet_money: '20', win_money: '5', txn_id: txnId, game_code: 'g', provider_code: 'p', txn_type: 'bet' },
    };

    await service.nexus({ body, headers: nexusHeaders });
    await service.nexus({ body, headers: nexusHeaders });

    assert.equal(balances.get(String(uid)), '485.00000000', 'net -15, applied once');
  });

  await t.test('nexus stores FRACTIONAL amounts', async () => {
    /**
     * `transaction_live` and `transaction_slot` declare `bet_money`,
     * `win_money` and `user_balance` as BIGINT, so every legacy write rounded
     * to a whole unit — a 0.40 stake became 0.
     */
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const txnId = newRef();
    await service.nexus({
      body: {
        method: 'transaction',
        user_code: uid,
        game_type: 'live',
        live: { bet_money: '0.40', win_money: '0', txn_id: txnId, txn_type: 'bet' },
      },
      headers: nexusHeaders,
    });

    const row = await models.AggregatorTransaction.findOne({
      where: { aggregator: 'nexus', transaction_id: txnId },
      raw: true,
    });

    assert.equal(String(row.stake), '0.40000000', 'not rounded to 0');
    assert.equal(balances.get(String(uid)), '99.60000000');
  });

  await t.test('nexus refuses an unknown game type', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const result = await service.nexus({
      body: { method: 'transaction', user_code: uid, game_type: 'sportsbook' },
      headers: nexusHeaders,
    });

    assert.equal(result.status, 0);
    assert.equal(result.msg, 'INVALID_GAME_TYPE');
  });

  await t.test('nexus refuses an unknown method', async () => {
    const { service } = build(new Map());
    const result = await service.nexus({ body: { method: 'drain_wallet' }, headers: nexusHeaders });
    assert.equal(result.msg, 'INVALID_METHOD');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  EVO — /callback_evo
  // ══════════════════════════════════════════════════════════════════════

  const evoBody = (uid, { round, bet, win, game = 'g1' }) => ({
    'event[data][user][agregator_user_id]': String(uid),
    'event[data][game][game_id]': game,
    'event[data][game][round][round_id]': round,
    'event[data][pay_for_action_this_round]': bet,
    'event[data][game][round][win]': win,
  });

  await t.test('evo settles BEFORE it answers, and only once', async () => {
    /**
     * Legacy did `res.sendStatus(200)` and then settled inside
     * `H.wait(1000).then(...)`. A restart in that second lost the settlement
     * after the provider had been told it succeeded.
     */
    const { uid, balances } = player('200');
    const { service } = build(balances);

    const round = newRef();
    const first = await service.evo({ body: evoBody(uid, { round, bet: '10', win: '30' }), headers: evoHeaders });

    // The money has already moved by the time the call resolves.
    assert.equal(first.ok, true);
    assert.equal(balances.get(String(uid)), '220.00000000');

    const second = await service.evo({ body: evoBody(uid, { round, bet: '10', win: '30' }), headers: evoHeaders });
    assert.equal(second.duplicate, true);
    assert.equal(balances.get(String(uid)), '220.00000000');
  });

  await t.test('evo pays a player who is not connected over the socket', async () => {
    /**
     * `var client = queue.client;` ran BEFORE `if (queue)`, so settling for a
     * disconnected player threw a TypeError inside a callback with no handler.
     * The broadcast is a hook here and cannot fail the settlement.
     */
    const { uid, balances } = player('100');
    const wallet = makeWallet(balances);

    const service = new AggregatorsService({
      models,
      db: connection,
      logger,
      wallet,
      onSettled: () => {
        throw new Error('no socket for this player');
      },
      config: { AGGREGATOR_EVO_SECRET: EVO_KEY },
    });

    const result = await service.evo({
      body: evoBody(uid, { round: newRef(), bet: '0', win: '50' }),
      headers: evoHeaders,
    });

    assert.equal(result.ok, true);
    assert.equal(balances.get(String(uid)), '150.00000000', 'paid despite the broadcast failing');
  });

  await t.test('an evo ping with no stake and no win settles nothing', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const result = await service.evo({
      body: evoBody(uid, { round: newRef(), bet: '0', win: '0' }),
      headers: evoHeaders,
    });

    assert.equal(result.skipped, true);
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('an unauthenticated evo callback settles nothing', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);

    const result = await service.evo({
      body: evoBody(uid, { round: newRef(), bet: '0', win: '9999' }),
      headers: {},
    });

    assert.equal(result.ok, false);
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('the settlement broadcast fires only after the money is committed', async () => {
    const { uid, balances } = player('100');
    const { service } = build(balances);
    broadcasts.length = 0;

    await service.evo({ body: evoBody(uid, { round: newRef(), bet: '0', win: '5' }), headers: evoHeaders });

    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].userId, uid);
    assert.equal(broadcasts[0].balance, '105.00000000', 'and it carries the balance AFTER the movement');
  });
});
