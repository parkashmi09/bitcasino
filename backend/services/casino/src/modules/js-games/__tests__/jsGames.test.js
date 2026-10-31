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

/** A provider round id. Unique per test run, like the serials. */
let rounds = 0;
const newRound = () => `R-${process.pid}-${(rounds += 1)}`;

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

  /**
   * user-service, stubbed.
   *
   * VIP on-wager sync and rakeback accrual cross that boundary. `posted` is
   * what the assertions read: loyalty side-effects must be a consequence of
   * a settlement, not a precondition for one, so every test that does not care
   * about them simply ignores the list.
   */
  const makeClients = () => {
    const posted = [];
    return {
      posted,
      user: {
        async post(path, body) {
          posted.push({ path, body });
          if (path === '/internal/user/rakeback/accrue') {
            const { vipRewards, money: m } = require('@ibitplay/common');
            const rate = vipRewards.DEFAULT_RAKEBACK_RATE;
            const amount = body.amount
              ? body.amount
              : m.toDecimalString(m.multiply(body.stakeUsd, rate));
            return { accrued: amount, amount, duplicate: false };
          }
          return { ok: true };
        },
        async get(_path, { query } = {}) {
          // One INR = 0.012 USD, which is the only conversion these tests need.
          return { usdValue: money.toDecimalString(money.multiply(query.amount, '0.012')) };
        },
      },
    };
  };

  const build = (balances, config = {}) => {
    const wallet = makeWallet(balances);
    const clients = makeClients();
    const service = new JsGamesService({
      models,
      db: connection,
      logger,
      wallet,
      clients,
      v1,
      v2,
      config: { SERVICE_NAME: 'casino-service', JSGAMES_MAX_SKEW_SECONDS: 300, ...config },
    });
    return { service, wallet, clients };
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
  //  v2 — round settlement
  // ══════════════════════════════════════════════════════════════════════

  /**
   * The provider's message: two amounts and a round id.
   *
   * There is no `transaction_type` and no `transaction_id` on the wire. An
   * earlier pass of the handler required both and rejected every genuine
   * callback with `Invalid transaction_type`; these helpers are shaped like the
   * real thing so that cannot come back unnoticed.
   */
  const stake = (uid, round, amount, currency = 'USDT') => ({
    user_id: uid,
    game_uid: 'g-test',
    game_round: round,
    serial_number: newSerial(),
    bet_amount: amount,
    win_amount: '0',
    currency,
  });

  const payout = (uid, round, amount, currency = 'USDT') => ({
    user_id: uid,
    game_uid: 'g-test',
    game_round: round,
    serial_number: newSerial(),
    bet_amount: '0',
    win_amount: amount,
    currency,
  });

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
      v2Callback({ ...stake(uid, newRound(), '10'), balance: '99999999' })
    );

    assert.equal(result.success, true);
    assert.equal(balances.get(String(uid)), '90.00000000', 'the stake was taken; the named balance was ignored');
    assert.equal(result.new_balance, '90.00000000');
  });

  await t.test('v2 settles a stake and then a payout on ONE round', async () => {
    /**
     * THE REGRESSION THIS FILE EXISTS FOR.
     *
     * Both messages carry the same `game_round`, because they are two halves of
     * one spin. With the table keyed on that column ALONE the payout collided
     * with the stake and was swallowed as a replay — the player was never paid,
     * silently, and only ever in the direction that costs them money.
     *
     * The key is the PAIR: (round, settlement type).
     */
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);
    const round = newRound();

    const bet = await service.betCallbackV2(v2Callback(stake(uid, round, '10')));
    assert.equal(bet.success, true);
    assert.equal(balances.get(String(uid)), '90.00000000');

    const win = await service.betCallbackV2(v2Callback(payout(uid, round, '25')));
    assert.equal(win.success, true, 'the payout must not be mistaken for a replay of the stake');
    assert.equal(balances.get(String(uid)), '115.00000000');

    assert.equal(
      await models.GameTransaction.count({ where: { external_transaction_id: round } }),
      2,
      'one round, two settlements'
    );
  });

  await t.test('v2 names the settlement from the amounts, not from the body', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);
    const round = newRound();

    // A winning spin settled in ONE message: both amounts non-zero.
    const result = await service.betCallbackV2(
      v2Callback({
        ...stake(uid, round, '10'),
        win_amount: '30',
        // The provider does not send this. If it ever did, it must not be read.
        transaction_type: 'loss',
      })
    );

    assert.equal(result.success, true);
    assert.equal(balances.get(String(uid)), '120.00000000', 'moved by win - bet');

    const row = await models.GameTransaction.findOne({ where: { external_transaction_id: round }, raw: true });
    assert.equal(row.transaction_type, 'bet_result');
    assert.equal(row.amount, '20.00000000', 'the signed delta, not either amount alone');
  });

  await t.test('v2 refuses a win on a round that was never staked', async () => {
    /**
     * Without this, `bet_amount: 0` plus any `win_amount` mints credit. A
     * signature proves who sent a message, not that it describes a real round.
     */
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '0']]);
    const { service } = build(balances);

    const result = await service.betCallbackV2(v2Callback(payout(uid, newRound(), '1000')));

    assert.equal(result.success, false);
    assert.equal(result.error, 'No matching bet for this round');
    assert.equal(balances.get(String(uid)), '0');
  });

  await t.test('v2 allows an unstaked win only when explicitly configured to', async () => {
    // The switch exists for a provider confirmed to settle bonus rounds under a
    // fresh round id. Off is the default; this proves the switch is real.
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '0']]);
    const { service } = build(balances, { JSGAMES_REQUIRE_BET_FOR_WIN: false });

    const result = await service.betCallbackV2(v2Callback(payout(uid, newRound(), '40')));

    assert.equal(result.success, true);
    assert.equal(balances.get(String(uid)), '40.00000000');
  });

  await t.test('v2 refuses an unsigned callback', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const result = await service.betCallbackV2({ body: stake(uid, newRound(), '10'), headers: {} });

    assert.equal(result.success, false);
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('v2 refuses a callback whose body was edited after signing', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const honest = v2Callback(payout(uid, newRound(), '1'));
    honest.body.win_amount = '5000';

    const result = await service.betCallbackV2(honest);
    assert.equal(result.success, false);
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('v2 refuses a replayed signature once its timestamp expires', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const result = await service.betCallbackV2(
      v2Callback(stake(uid, newRound(), '50'), { at: Date.now() - 3600_000 })
    );

    assert.equal(result.success, false);
    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test("v2 refuses the literal round id 'unknown'", async () => {
    // Legacy defaulted a missing key to that string, which would make every
    // callback omitting one collide with every other.
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    for (const game_round of ['unknown', '', '   ']) {
      const result = await service.betCallbackV2(v2Callback({ ...stake(uid, 'x', '10'), game_round }));
      assert.equal(result.success, false, `${JSON.stringify(game_round)} must be refused`);
    }

    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('v2 takes a retried stake ONCE', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const round = newRound();
    const body = stake(uid, round, '20');

    const first = await service.betCallbackV2(v2Callback(body));
    const second = await service.betCallbackV2(v2Callback(body));
    const third = await service.betCallbackV2(v2Callback(body));

    assert.equal(first.success, true);
    assert.equal(second.duplicate, true, 'a replay reports success so the provider stops retrying');
    assert.equal(second.success, true);
    assert.equal(second.new_balance, '80.00000000', 'and it answers with the balance we hold');
    assert.equal(third.duplicate, true);

    assert.equal(balances.get(String(uid)), '80.00000000');
    assert.equal(await models.GameTransaction.count({ where: { external_transaction_id: round } }), 1);
  });

  await t.test('v2 concurrent retries apply once', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const body = stake(uid, newRound(), '75');
    const send = () => service.betCallbackV2(v2Callback(body));

    await Promise.all([send(), send(), send()]);
    assert.equal(balances.get(String(uid)), '25.00000000');
  });

  await t.test('v2 negative-bet correction reverses that part of the stake in the wager feed', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);
    const recorded = [];
    const reversed = [];
    service.games = {
      recordActivity: async (a) => { recorded.push(a); return { counted: true }; },
      reverseActivity: async (a) => { reversed.push(a); return { reversed: true }; },
      recordPlay: async () => {},
    };
    const round = newRound();

    assert.equal((await service.betCallbackV2(v2Callback(stake(uid, round, '10')))).success, true);
    const correction = { ...stake(uid, round, '-4'), serial_number: 'sn-fix-1' };
    assert.equal((await service.betCallbackV2(v2Callback(correction))).success, true);

    assert.equal(recorded.length, 1, 'only the real stake is counted');
    assert.deepEqual(reversed, [{
      userId: uid, source: 'jsgames-v2', ref: `${uid}:${round}`, amount: '4.00000000', refundRef: 'negative_bet:sn-fix-1', outbox: true,
    }]);
    assert.equal(balances.get(String(uid)), '94.00000000', 'the 4 came back to the wallet');
  });

  await t.test('v2: ANOTHER PLAYER\'s same round id is a new settlement, not a duplicate', async () => {
    const a = await seedPlayer(newUid());
    const b = await seedPlayer(newUid());
    const balances = new Map([[String(a), '100'], [String(b), '100']]);
    const { service } = build(balances);
    const round = newRound();

    const first = await service.betCallbackV2(v2Callback(stake(a, round, '10')));
    const second = await service.betCallbackV2(v2Callback(stake(b, round, '10')));

    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.notEqual(second.duplicate, true, 'B is not told his stake was a replay');
    assert.equal(balances.get(String(a)), '90.00000000');
    assert.equal(balances.get(String(b)), '90.00000000', 'and B was actually debited');

    // The same player's retry is still a duplicate.
    const retry = await service.betCallbackV2(v2Callback(stake(b, round, '10')));
    assert.equal(retry.duplicate, true);
    assert.equal(balances.get(String(b)), '90.00000000');
  });

  await t.test('v2 refuses a stake the balance will not cover', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '5']]);
    const { service } = build(balances);
    const round = newRound();

    const result = await service.betCallbackV2(v2Callback(stake(uid, round, '10')));

    assert.equal(result.success, false);
    assert.equal(result.error, 'Insufficient balance');
    // Normalised to the wallet's scale, as on every other path.
    assert.equal(result.new_balance, '5.00000000', 'the provider is told what we actually hold');
    assert.equal(balances.get(String(uid)), '5');
    assert.equal(
      await models.GameTransaction.count({ where: { external_transaction_id: round } }),
      0,
      'a refused settlement leaves no row, so a corrected retry can still be made'
    );
  });

  await t.test('v2 denormalises the game name onto the settlement', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);
    const round = newRound();

    const gameUid = `cat-${process.pid}-${Date.now()}`;
    await models.JsGames.create({
      game_uid: gameUid,
      game_name: 'Catalogued Game',
      game_type: 'Slot Game',
      is_active: true,
      vendor: 'testvendor',
    });

    try {
      await service.betCallbackV2(v2Callback({ ...stake(uid, round, '10'), game_uid: gameUid }));

      const row = await models.GameTransaction.findOne({ where: { external_transaction_id: round }, raw: true });
      assert.equal(row.game_name, 'Catalogued Game');
      assert.equal(row.game_type, 'Slot Game');
    } finally {
      await models.JsGames.destroy({ where: { game_uid: gameUid } });
    }
  });

  await t.test('v2 settles a game the catalogue has never heard of', async () => {
    // A provider retiring a game must not make its rounds unsettleable.
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);
    const round = newRound();

    const result = await service.betCallbackV2(
      v2Callback({ ...stake(uid, round, '10'), game_uid: 'never-catalogued' })
    );

    assert.equal(result.success, true);
    const row = await models.GameTransaction.findOne({ where: { external_transaction_id: round }, raw: true });
    assert.equal(row.game_name, null);
  });

  // ── Rakeback ──────────────────────────────────────────────────────────

  /*
   * The stake is counted (USD conversion, VIP, affiliate, rakeback) by
   * user-service's `POST /internal/user/wager/record`. casino sends the stake
   * in its own currency with the bet's key; it no longer converts or accrues
   * itself, so rupees can never be counted as dollars on this side.
   */
  const records = (clients) => clients.posted.filter((p) => p.path === '/internal/user/wager/record');

  await t.test('v2 counts the stake once, keyed on the round', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service, clients } = build(balances);
    const round = newRound();

    await service.betCallbackV2(v2Callback(stake(uid, round, '50')));

    const [record] = records(clients);
    assert.ok(record, 'wager record posted');
    assert.equal(record.body.amount, '50.00000000');
    assert.equal(record.body.currency, 'USDT');
    assert.equal(record.body.source, 'jsgames-v2');
    assert.equal(record.body.ref, `${uid}:${round}`, 'keyed on the player and round, so a retry counts nothing');
    assert.equal(record.body.rakeback, true);
  });

  await t.test('v2 sends a non-USD stake in its own currency for user-service to convert', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '10000']]);
    const { service, clients } = build(balances);

    await service.betCallbackV2(v2Callback(stake(uid, newRound(), '1000', 'INR')));

    const [record] = records(clients);
    assert.ok(record);
    assert.equal(record.body.amount, '1000.00000000');
    assert.equal(record.body.currency, 'INR');
    assert.equal(clients.posted.filter((p) => p.path === '/internal/user/rakeback/accrue').length, 0,
      'no direct accrual from casino any more');
  });

  await t.test('v2 records the stake as a decimal, not minor units', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service, clients } = build(balances);

    await service.betCallbackV2(v2Callback(stake(uid, newRound(), '10')));

    const [record] = records(clients);
    assert.equal(record.body.amount, '10.00000000');
    assert.match(record.body.amount, /^\d+(\.\d+)?$/);
  });

  await t.test('v2 does not count a payout, or a replay', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service, clients } = build(balances);
    const round = newRound();

    await service.betCallbackV2(v2Callback(stake(uid, round, '10')));
    assert.equal(records(clients).length, 1);

    await service.betCallbackV2(v2Callback(stake(uid, round, '10')));
    await service.betCallbackV2(v2Callback(payout(uid, round, '30')));

    assert.equal(records(clients).length, 1, 'one stake, one record');
  });

  await t.test('v2 settles even when the wager record fails', async () => {
    // Rakeback is a loyalty accrual. It does not get to fail a settlement.
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service, clients } = build(balances);
    clients.user.post = async () => {
      throw new Error('user-service is down');
    };

    const result = await service.betCallbackV2(v2Callback(stake(uid, newRound(), '10')));

    assert.equal(result.success, true);
    assert.equal(balances.get(String(uid)), '90.00000000');
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

    const refused = await service.betCallbackV1(
      v1Callback({
        member_account: `h24e9e_USDT_${uid}`,
        currency_code: 'USDT',
        bet_amount: '0',
        win_amount: '500',
        serial_number: newSerial(),
        game_round: `no-bet-${serial}`,
        game_uid: 'g1',
      })
    );
    assert.notEqual(refused.code, CODE.SUCCESS, 'a win alone in a round with no stake pays nothing');
    assert.equal(balances.get(String(uid)), '115.00000000');

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

  /**
   * The provider hashes the body it RECEIVED. `JSON.stringify` drops undefined
   * and null, so signing them produced a digest over fields that were never
   * sent, and every such launch came back as a bare `20004 Invalid signature`.
   * Confirmed against the live endpoint: the same call signs and launches with
   * `name` set, and was rejected with `name: undefined`.
   */
  await t.test('the v2 signature covers the body that is actually sent', async () => {
    const timestamp = '1700000000000';
    assert.equal(
      v2.sign({ game_uid: 'g', name: undefined, timestamp }),
      v2.sign({ game_uid: 'g', timestamp }),
      'an undefined field must not enter the canonical string'
    );
    assert.equal(
      v2.sign({ game_uid: 'g', name: null, timestamp }),
      v2.sign({ game_uid: 'g', timestamp }),
      'nor a null one'
    );
    // Empty string IS serialised, so it stays in — dropping it would recreate
    // the same mismatch in the other direction.
    assert.notEqual(
      v2.sign({ game_uid: 'g', name: '', timestamp }),
      v2.sign({ game_uid: 'g', timestamp }),
      'an empty string is sent, so it must be signed'
    );
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
