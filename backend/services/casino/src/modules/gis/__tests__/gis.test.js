'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { GisService } = require('../gis.service');
const { SlotegratorClient } = require('../provider/slotegrator');
const { uuidV5, responseIdFor } = require('../responseId');
const { ERROR_CODE } = require('../gis.constants');

/**
 * Slotegrator (GIS).
 *
 * Every test below is a legacy behaviour written down as the failure it caused.
 * The one that matters most is the first: `bal` was an undeclared global, so
 * balances leaked between concurrent requests.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

const MERCHANT_ID = 'test-merchant';
const MERCHANT_KEY = 'test-merchant-key';

let connection;

let nextUid = 960_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

let seq = 0;
const newTxId = () => `GIS-${process.pid}-${(seq += 1)}`;

test('slotegrator (gis)', async (t) => {
  const logger = createLogger({ name: 'gis-test', level: 'silent' });

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

  /** The signer, used both to sign our fixtures and by the service to verify. */
  const provider = new SlotegratorClient({
    baseUrl: 'https://gis.test/v1',
    merchantId: MERCHANT_ID,
    merchantKey: MERCHANT_KEY,
    rateLimitMs: 0,
    logger,
    fetchImpl: async () => {
      throw new Error('no upstream call expected in this test');
    },
  });

  /**
   * A wallet standing in for user-service.
   *
   * It enforces the overdraft rule and honours the idempotency key, because
   * those are exactly the two behaviours the service depends on and the legacy
   * code lacked. A stub that always succeeded would prove nothing.
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
    const service = new GisService({
      models,
      db: connection,
      logger,
      wallet,
      provider,
      games: { async recordPlay() {} },
      config: { SERVICE_NAME: 'casino-service', GIS_MAX_SKEW_SECONDS: 300, ...config },
    });
    return { service, wallet };
  };

  /** A player row, so the casino-lock lookup has something to read. */
  const seedPlayer = async (uid) => {
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name: `gis-${uid}`, password: 'x', status: 'active' });
    return uid;
  };

  /** Build a signed callback, exactly as Slotegrator would send it. */
  const callback = (body, { at = Date.now(), sign } = {}) => {
    const headers = {
      'x-merchant-id': MERCHANT_ID,
      'x-timestamp': Math.floor(at / 1000).toString(),
      'x-nonce': `nonce-${(seq += 1)}`,
    };
    headers['x-sign'] =
      sign ??
      provider.sign(body, {
        'X-Merchant-Id': headers['x-merchant-id'],
        'X-Timestamp': headers['x-timestamp'],
        'X-Nonce': headers['x-nonce'],
      });
    return { body, headers };
  };

  // ══════════════════════════════════════════════════════════════════════
  //  The undeclared global
  // ══════════════════════════════════════════════════════════════════════

  await t.test('concurrent bets from two players do NOT mix their balances', async () => {
    /**
     * THE headline defect. `bal` had no declaration, so it was a module global
     * shared by every in-flight request:
     *
     *   A: bal = 100 → await → B: bal = 5000 → A resumes → writes 4980 to A
     *
     * Player A ends up holding player B's money, silently.
     */
    const rich = await seedPlayer(newUid());
    const poor = await seedPlayer(newUid());

    const balances = new Map([
      [String(rich), '5000'],
      [String(poor), '100'],
    ]);
    const { service } = build(balances);

    const bet = (uid) =>
      service.handleTransaction(
        callback({
          action: 'bet',
          player_id: String(uid),
          currency: 'USDT',
          amount: '10',
          transaction_id: newTxId(),
        })
      );

    await Promise.all([bet(rich), bet(poor), bet(rich), bet(poor)]);

    assert.equal(balances.get(String(rich)), '4980.00000000', 'the rich player paid exactly their own two bets');
    assert.equal(balances.get(String(poor)), '80.00000000', 'and the poor player theirs');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Authentication
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a callback with a wrong signature moves no money', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '500']]);
    const { service } = build(balances);

    const result = await service.handleTransaction(
      callback(
        { action: 'bet', player_id: String(uid), currency: 'USDT', amount: '100', transaction_id: newTxId() },
        { sign: 'f'.repeat(40) }
      )
    );

    assert.equal(result.error_code, ERROR_CODE.INTERNAL);
    assert.equal(balances.get(String(uid)), '500');
  });

  await t.test('editing the amount after signing invalidates the signature', async () => {
    // The signature covers every parameter, which is what makes this one better
    // than the other providers' schemes. Worth a test so it stays that way.
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '500']]);
    const { service } = build(balances);

    const honest = callback({
      action: 'bet',
      player_id: String(uid),
      currency: 'USDT',
      amount: '1',
      transaction_id: newTxId(),
    });
    honest.body.amount = '400';

    const result = await service.handleTransaction(honest);
    assert.equal(result.error_code, ERROR_CODE.INTERNAL);
    assert.equal(balances.get(String(uid)), '500');
  });

  await t.test('a stale X-Timestamp is refused even with a valid signature', async () => {
    // The header is inside the signature, so it cannot be edited — but legacy
    // never checked it was RECENT, so a captured request replayed forever.
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '500']]);
    const { service } = build(balances);

    const result = await service.handleTransaction(
      callback(
        { action: 'bet', player_id: String(uid), currency: 'USDT', amount: '100', transaction_id: newTxId() },
        { at: Date.now() - 3600_000 }
      )
    );

    assert.equal(result.error_code, ERROR_CODE.INTERNAL);
    assert.equal(balances.get(String(uid)), '500');
  });

  await t.test('an unconfigured integration refuses rather than signing against undefined', async () => {
    const unconfigured = new SlotegratorClient({ baseUrl: '', merchantId: '', merchantKey: '' });
    const { service } = build(new Map(), {});
    service.provider = unconfigured;

    const result = await service.handleTransaction({ body: { action: 'balance' }, headers: {} });
    assert.equal(result.error_code, ERROR_CODE.INTERNAL);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Idempotency
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a retried win is paid ONCE', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '0']]);
    const { service } = build(balances);

    const txId = newTxId();
    const win = () =>
      service.handleTransaction(
        callback({ action: 'win', player_id: String(uid), currency: 'USDT', amount: '250', transaction_id: txId })
      );

    const first = await win();
    const second = await win();

    assert.equal(balances.get(String(uid)), '250.00000000');
    assert.equal(second.transaction_id, first.transaction_id, 'and the same id comes back both times');

    /**
     * The RESPONSE, not just the stored balance.
     *
     * `balance` is the field the provider reads and shows the player, and it is
     * the one thing a test asserting only on the wallet would miss entirely —
     * a response of `{error_code: INTERNAL_ERROR}` still leaves the money
     * correct in the database.
     */
    assert.equal(first.balance, '250.0000', 'quoted to four places, as the provider expects');
    assert.equal(second.balance, '250.0000', 'and the retry is told the same');
    assert.equal(first.error_code, undefined);
  });

  await t.test('a bet counts toward the wager once (USD conversion is user-service\'s), a win never', async () => {
    // GIS/Slotegrator stakes never reached `userwager` — no VIP XP, no
    // rakeback, no commission for an aggregator-only player.
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '1000']]);
    const counted = [];
    const service = new GisService({
      models,
      db: connection,
      logger,
      wallet: makeWallet(balances),
      provider,
      games: { async recordPlay() {}, async recordActivity(args) { counted.push(args); return { counted: true }; } },
      config: { SERVICE_NAME: 'casino-service', GIS_MAX_SKEW_SECONDS: 300 },
    });

    const txId = newTxId();
    const bet = () =>
      service.handleTransaction(
        callback({ action: 'bet', player_id: String(uid), currency: 'USDT', amount: '40', transaction_id: txId })
      );
    const first = await bet();
    const retry = await bet();
    await service.handleTransaction(
      callback({ action: 'win', player_id: String(uid), currency: 'USDT', amount: '10', transaction_id: newTxId() })
    );

    assert.equal(counted.length, 1, 'one stake, one count');
    assert.equal(counted[0].wagered, '40.00000000');
    assert.equal(counted[0].currency, 'USDT');
    assert.equal(counted[0].source, 'gis');
    assert.equal(counted[0].ref, txId);
    // The internal flag never reaches the provider.
    assert.equal('duplicate' in first, false);
    assert.equal('duplicate' in retry, false);
  });

  await t.test('two retries arriving together apply once', async () => {
    // The legacy guard was a SELECT followed much later by an INSERT. Both
    // reads returned "not seen" and both paid.
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '0']]);
    const { service } = build(balances);

    const txId = newTxId();
    const win = () =>
      service.handleTransaction(
        callback({ action: 'win', player_id: String(uid), currency: 'USDT', amount: '100', transaction_id: txId })
      );

    await Promise.all([win(), win(), win()]);

    assert.equal(balances.get(String(uid)), '100.00000000');
    assert.equal(await models.GisTransactions.count({ where: { transaction_id: txId } }), 1);
  });

  await t.test('a refund retried under a FRESH transaction id still pays once', async () => {
    /**
     * Slotegrator retries a refund with a new id for the refund itself, keeping
     * `bet_transaction_id`. Legacy caught that with a second SELECT — a read,
     * with the same race. The stored key is derived from the bet, so the unique
     * index catches it.
     */
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '500']]);
    const { service } = build(balances);

    const betId = newTxId();
    await service.handleTransaction(
      callback({ action: 'bet', player_id: String(uid), currency: 'USDT', amount: '100', transaction_id: betId })
    );
    assert.equal(balances.get(String(uid)), '400.00000000');

    const refund = () =>
      service.handleTransaction(
        callback({
          action: 'refund',
          player_id: String(uid),
          currency: 'USDT',
          amount: '100',
          transaction_id: newTxId(), // a DIFFERENT id each time
          bet_transaction_id: betId,
        })
      );

    await refund();
    await refund();

    assert.equal(balances.get(String(uid)), '500.00000000', 'refunded once, not twice');
  });

  await t.test('a refund for a bet we never took moves nothing', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    const result = await service.handleTransaction(
      callback({
        action: 'refund',
        player_id: String(uid),
        currency: 'USDT',
        amount: '9999',
        transaction_id: newTxId(),
        bet_transaction_id: 'a-bet-that-never-happened',
      })
    );

    assert.ok(result.transaction_id, 'acknowledged, so the provider stops retrying');
    assert.equal(balances.get(String(uid)), '100', 'but nothing moved');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Rollbacks
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a refund and a rollback of one bet return the stake once, in either order', async () => {
    for (const order of [['refund', 'rollback'], ['rollback', 'refund']]) {
      const uid = await seedPlayer(newUid());
      const balances = new Map([[String(uid), '1000']]);
      const service = new GisService({ models, db: connection, logger, wallet: makeWallet(balances), provider, games: { async recordPlay() {}, async recordActivity() { return {}; }, async reverseActivity() { return {}; } }, config: { SERVICE_NAME: 'casino-service', GIS_MAX_SKEW_SECONDS: 300 } });
      const tx = (body) => service.handleTransaction(callback({ player_id: String(uid), currency: 'USDT', ...body }));
      const bet = newTxId();
      await tx({ action: 'bet', amount: '100', transaction_id: bet });
      for (const step of order) {
        if (step === 'refund') await tx({ action: 'refund', amount: '100', transaction_id: newTxId(), bet_transaction_id: bet });
        else await tx({ action: 'rollback', transaction_id: newTxId(), rollback_transactions: [{ transaction_id: bet, action: 'bet', amount: '100' }] });
      }
      assert.equal(Number(balances.get(String(uid))), 1000, order.join(' then '));
    }
  });

  await t.test('a refund pays at most the stake, and only for the bet of that player', async () => {
    const uid = await seedPlayer(newUid());
    const other = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '1000'], [String(other), '0']]);
    const service = new GisService({ models, db: connection, logger, wallet: makeWallet(balances), provider, games: { async recordPlay() {}, async recordActivity() { return {}; }, async reverseActivity() { return {}; } }, config: { SERVICE_NAME: 'casino-service', GIS_MAX_SKEW_SECONDS: 300 } });
    const tx = (player, body) => service.handleTransaction(callback({ player_id: String(player), currency: 'USDT', ...body }));
    const bet = newTxId();
    await tx(uid, { action: 'bet', amount: '100', transaction_id: bet });
    await tx(other, { action: 'refund', amount: '100', transaction_id: newTxId(), bet_transaction_id: bet });
    assert.equal(Number(balances.get(String(other))), 0, 'not the bet of another player');
    await tx(uid, { action: 'refund', amount: '9999', transaction_id: newTxId(), bet_transaction_id: bet });
    assert.equal(Number(balances.get(String(uid))), 1000, 'the stake, not the figure asked');
  });

  await t.test('a win naming a round with no bet is refused; free spins and matched rounds pay', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '1000']]);
    const service = new GisService({ models, db: connection, logger, wallet: makeWallet(balances), provider, games: { async recordPlay() {}, async recordActivity() { return {}; }, async reverseActivity() { return {}; } }, config: { SERVICE_NAME: 'casino-service', GIS_MAX_SKEW_SECONDS: 300 } });
    const tx = (body) => service.handleTransaction(callback({ player_id: String(uid), currency: 'USDT', ...body }));
    const round = `round-${newTxId()}`;
    const refused = await tx({ action: 'win', amount: '500', transaction_id: newTxId(), round_id: round });
    assert.ok(refused.error_code, 'no bet yet');
    assert.equal(Number(balances.get(String(uid))), 1000);
    await tx({ action: 'bet', amount: '10', transaction_id: newTxId(), round_id: round });
    await tx({ action: 'win', amount: '30', transaction_id: newTxId(), round_id: round });
    assert.equal(Number(balances.get(String(uid))), 1020);
    await tx({ action: 'win', amount: '5', transaction_id: newTxId(), round_id: `fs-${newTxId()}`, freespin_id: 'fs1' });
    assert.equal(Number(balances.get(String(uid))), 1025);
  });

  await t.test('wager feed: a refunded bet and a rolled-back bet stop counting, once each; a rolled-back win does not', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '1000']]);
    const reversed = [];
    const service = new GisService({
      models,
      db: connection,
      logger,
      wallet: makeWallet(balances),
      provider,
      games: {
        async recordPlay() {},
        async recordActivity() { return { counted: true }; },
        async reverseActivity(args) { reversed.push(args); return { reversed: true }; },
      },
      config: { SERVICE_NAME: 'casino-service', GIS_MAX_SKEW_SECONDS: 300 },
    });
    const tx = (body) => service.handleTransaction(callback({ player_id: String(uid), currency: 'USDT', ...body }));

    const refunded = newTxId();
    const rolled = newTxId();
    const win = newTxId();
    await tx({ action: 'bet', amount: '40', transaction_id: refunded });
    await tx({ action: 'bet', amount: '30', transaction_id: rolled });
    await tx({ action: 'win', amount: '10', transaction_id: win });

    const refundIds = [];
    const refund = () => {
      refundIds.push(newTxId());
      return tx({ action: 'refund', amount: '40', transaction_id: refundIds.at(-1), bet_transaction_id: refunded });
    };
    await refund();
    await refund(); // retried under a fresh id
    const rollback = (id) =>
      tx({ action: 'rollback', transaction_id: newTxId(), rollback_transactions: [{ transaction_id: id }] });
    await rollback(rolled);
    await rollback(rolled);
    await rollback(win);

    assert.deepEqual(reversed, [
      // The refunded amount and the provider's refund id (partial-refund aware, migration 090);
      // a failed call is queued for retry (`outbox`).
      { userId: uid, source: 'gis', ref: refunded, amount: '40.00000000', refundRef: refundIds[0], outbox: true },
      { userId: uid, source: 'gis', ref: rolled, amount: null, refundRef: null, outbox: true },
    ]);
    assert.equal(balances.get(String(uid)), '1000.00000000', 'stakes returned, win taken back');
  });

  await t.test('wager feed: a partial refund reverses only the refunded part, keyed by the refund id', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const reversed = [];
    const service = new GisService({
      models,
      db: connection,
      logger,
      wallet: makeWallet(balances),
      provider,
      games: {
        async recordPlay() {},
        async recordActivity() { return { counted: true }; },
        async reverseActivity(args) { reversed.push(args); return { reversed: true }; },
      },
      config: { SERVICE_NAME: 'casino-service', GIS_MAX_SKEW_SECONDS: 300 },
    });
    const betId = newTxId();
    const refundId = newTxId();
    await service.handleTransaction(callback({ action: 'bet', player_id: String(uid), currency: 'USDT', amount: '40', transaction_id: betId }));
    await service.handleTransaction(
      callback({ action: 'refund', player_id: String(uid), currency: 'USDT', amount: '15', transaction_id: refundId, bet_transaction_id: betId })
    );
    assert.deepEqual(reversed, [{ userId: uid, source: 'gis', ref: betId, amount: '15.00000000', refundRef: refundId, outbox: true }]);
    assert.equal(balances.get(String(uid)), '75.00000000');
  });

  await t.test('wager feed: a failing reversal never fails the refund', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const service = new GisService({
      models,
      db: connection,
      logger,
      wallet: makeWallet(balances),
      provider,
      games: {
        async recordPlay() {},
        async recordActivity() { return { counted: true }; },
        async reverseActivity() { throw new Error('user-service down'); },
      },
      config: { SERVICE_NAME: 'casino-service', GIS_MAX_SKEW_SECONDS: 300 },
    });
    const betId = newTxId();
    await service.handleTransaction(callback({ action: 'bet', player_id: String(uid), currency: 'USDT', amount: '40', transaction_id: betId }));
    const result = await service.handleTransaction(
      callback({ action: 'refund', player_id: String(uid), currency: 'USDT', amount: '40', transaction_id: newTxId(), bet_transaction_id: betId })
    );
    assert.equal(result.error_code, undefined);
    assert.equal(balances.get(String(uid)), '100.00000000');
  });

  await t.test('a rollback reverses OUR amount, not the one it names', async () => {
    // Legacy summed `Big(tx.amount)` straight from the request, so a rollback
    // quoting a larger figure than the bet it reverses was a withdrawal.
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '500']]);
    const { service } = build(balances);

    const betId = newTxId();
    await service.handleTransaction(
      callback({ action: 'bet', player_id: String(uid), currency: 'USDT', amount: '50', transaction_id: betId })
    );
    assert.equal(balances.get(String(uid)), '450.00000000');

    await service.handleTransaction(
      callback({
        action: 'rollback',
        player_id: String(uid),
        currency: 'USDT',
        transaction_id: newTxId(),
        rollback_transactions: [{ transaction_id: betId, action: 'bet', amount: '50000' }],
      })
    );

    assert.equal(balances.get(String(uid)), '500.00000000', 'the 50 we took back, not the 50000 it asked for');
  });

  await t.test('rolling back something we never applied does nothing', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '100']]);
    const { service } = build(balances);

    await service.handleTransaction(
      callback({
        action: 'rollback',
        player_id: String(uid),
        currency: 'USDT',
        transaction_id: newTxId(),
        rollback_transactions: [{ transaction_id: 'never-happened', action: 'bet', amount: '9999' }],
      })
    );

    assert.equal(balances.get(String(uid)), '100');
  });

  await t.test('a rollback retried under a fresh id applies once', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '500']]);
    const { service } = build(balances);

    const betId = newTxId();
    await service.handleTransaction(
      callback({ action: 'bet', player_id: String(uid), currency: 'USDT', amount: '80', transaction_id: betId })
    );

    const rollback = () =>
      service.handleTransaction(
        callback({
          action: 'rollback',
          player_id: String(uid),
          currency: 'USDT',
          transaction_id: newTxId(),
          rollback_transactions: [{ transaction_id: betId, action: 'bet', amount: '80' }],
        })
      );

    await rollback();
    await rollback();

    assert.equal(balances.get(String(uid)), '500.00000000');
  });

  await t.test('rolling back a WIN takes the money back', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '0']]);
    const { service } = build(balances);

    const winId = newTxId();
    await service.handleTransaction(
      callback({ action: 'win', player_id: String(uid), currency: 'USDT', amount: '300', transaction_id: winId })
    );
    assert.equal(balances.get(String(uid)), '300.00000000');

    await service.handleTransaction(
      callback({
        action: 'rollback',
        player_id: String(uid),
        currency: 'USDT',
        transaction_id: newTxId(),
        rollback_transactions: [{ transaction_id: winId, action: 'win', amount: '300' }],
      })
    );

    assert.equal(balances.get(String(uid)), '0.00000000');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Balance rules
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a bet larger than the balance is refused, and nothing is recorded', async () => {
    const uid = await seedPlayer(newUid());
    const balances = new Map([[String(uid), '10']]);
    const { service } = build(balances);

    const txId = newTxId();
    const result = await service.handleTransaction(
      callback({ action: 'bet', player_id: String(uid), currency: 'USDT', amount: '100', transaction_id: txId })
    );

    assert.equal(result.error_code, ERROR_CODE.INSUFFICIENT_FUNDS);
    assert.equal(balances.get(String(uid)), '10');
    assert.equal(
      await models.GisTransactions.count({ where: { transaction_id: txId } }),
      0,
      'a refused bet must not leave a row claiming its id — the retry has to be able to succeed'
    );
  });

  await t.test('a plain balance probe answers with a four-place figure and no error', async () => {
    const uid = await seedPlayer(newUid());
    const { service } = build(new Map([[String(uid), '1234.5']]));

    const result = await service.handleTransaction(
      callback({ action: 'balance', player_id: String(uid), currency: 'USDT' })
    );

    assert.equal(result.error_code, undefined);
    assert.equal(result.balance, '1234.5000');
    assert.equal(result.transaction_id, undefined, 'a probe carries no transaction');
  });

  await t.test('a balance probe carrying an amount reports insufficient funds', async () => {
    const uid = await seedPlayer(newUid());
    const { service } = build(new Map([[String(uid), '5']]));

    const result = await service.handleTransaction(
      callback({ action: 'balance', player_id: String(uid), currency: 'USDT', amount: '100' })
    );

    assert.equal(result.error_code, ERROR_CODE.INSUFFICIENT_FUNDS);
  });

  await t.test('an unknown player is refused rather than treated as having zero', async () => {
    const { service } = build(new Map());

    const result = await service.handleTransaction(
      callback({ action: 'balance', player_id: '999999999', currency: 'USDT' })
    );

    assert.equal(result.error_code, ERROR_CODE.INTERNAL);
    assert.match(result.error_description, /Player not found/);
  });

  await t.test('a non-numeric player id never reaches a query', async () => {
    const { service } = build(new Map());
    const result = await service.handleTransaction(
      callback({ action: 'balance', player_id: "1 OR 1=1", currency: 'USDT' })
    );
    assert.equal(result.error_code, ERROR_CODE.INTERNAL);
  });

  await t.test('an unsupported currency is refused', async () => {
    const uid = await seedPlayer(newUid());
    const { service } = build(new Map([[String(uid), '100']]));

    const result = await service.handleTransaction(
      callback({ action: 'balance', player_id: String(uid), currency: 'EUR' })
    );

    assert.equal(result.error_code, ERROR_CODE.INTERNAL);
    assert.match(result.error_description, /Unsupported currency/);
  });

  await t.test('INR and PKR callbacks move the wallet of the same name', async () => {
    for (const [sent, wallet] of [['INR', 'INR'], ['PKR', 'PKR']]) {
      const uid = await seedPlayer(newUid());
      const { service } = build(new Map([[String(uid), '900']]));

      const result = await service.handleTransaction(
        callback({ action: 'bet', player_id: String(uid), currency: sent, amount: '100', transaction_id: newTxId() })
      );

      assert.equal(result.error_code, undefined, `${sent} bet settles`);
      const row = await models.GisTransactions.findOne({ where: { user_id: uid }, order: [['id', 'DESC']], raw: true });
      assert.equal(row.currency, wallet);
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Operator locks
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a casino lock stops new bets but lets a win settle', async () => {
    // Refusing the win would leave the provider holding a round it cannot close.
    const uid = await seedPlayer(newUid());
    await models.Users.update({ casino_locked: true }, { where: { id: uid } });

    const balances = new Map([[String(uid), '500']]);
    const { service } = build(balances);

    const bet = await service.handleTransaction(
      callback({ action: 'bet', player_id: String(uid), currency: 'USDT', amount: '10', transaction_id: newTxId() })
    );
    assert.equal(bet.error_code, ERROR_CODE.INSUFFICIENT_FUNDS);
    assert.equal(balances.get(String(uid)), '500');

    await service.handleTransaction(
      callback({ action: 'win', player_id: String(uid), currency: 'USDT', amount: '40', transaction_id: newTxId() })
    );
    assert.equal(balances.get(String(uid)), '540.00000000', 'a win still settles');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The response id
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the response id is a real uuid v5 in the historical namespace', async () => {
    /**
     * The provider stores the id we return. If this ever changes, every id we
     * would produce for a historical transaction stops matching the one they
     * recorded — so it is pinned against a known vector.
     */
    const NS = 'b58d9c74-80bb-46cb-8e0d-57458f25c23c';
    const expected = require('uuid').v5('x', NS);

    assert.equal(uuidV5('x'), expected, 'must agree with the uuid package legacy used');
    assert.equal(responseIdFor('x'), expected);
    assert.match(responseIdFor('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  await t.test('the same provider id always produces the same response id', async () => {
    assert.equal(responseIdFor('abc-123'), responseIdFor('abc-123'));
    assert.notEqual(responseIdFor('abc-123'), responseIdFor('abc-124'));
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Sync
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a provider sync PRESERVES the enabled flag', async () => {
    /**
     * Legacy opened with `TRUNCATE TABLE gis_providers_new RESTART IDENTITY`.
     * `enabled` lives on that table and is what the admin toggle writes — so
     * every sync switched every disabled provider back on, silently.
     */
    const disabled = `${process.pid}-DisabledVendor`;
    const fresh = `${process.pid}-NewVendor`;

    await models.GisProvidersNew.destroy({ where: { name: [disabled, fresh] } });
    await models.GisProvidersNew.create({ name: disabled, enabled: false });

    const syncing = new GisService({
      models,
      db: connection,
      logger,
      config: { GIS_MAX_SKEW_SECONDS: 300 },
      provider: {
        configured: true,
        async getAllPages() {
          return { items: [{ provider: disabled }, { provider: fresh }], pageCount: 1 };
        },
      },
    });

    await syncing.syncProviders();

    const after = await models.GisProvidersNew.findOne({ where: { name: disabled }, raw: true });
    assert.equal(after.enabled, false, 'a provider an operator disabled stays disabled');

    const added = await models.GisProvidersNew.findOne({ where: { name: fresh }, raw: true });
    assert.equal(added.enabled, true, 'and a new one arrives enabled');
  });

  await t.test('a game sync upserts rather than truncating', async () => {
    const uuid = `${process.pid}-sync-game`;
    await models.Gisgamesnew.destroy({ where: { uuid } });
    await models.Gisgamesnew.create({ uuid, name: 'Before', provider: 'X' });

    const syncing = new GisService({
      models,
      db: connection,
      logger,
      config: {},
      provider: {
        configured: true,
        async getAllPages() {
          return {
            items: [
              { uuid, name: 'After', provider: 'X', is_mobile: 1, updated_at: '1700000000' },
              { name: 'no uuid at all' },
            ],
            pageCount: 1,
          };
        },
      },
    });

    const result = await syncing.syncGames();

    assert.equal(result.written, 1);
    assert.equal(result.skipped, 1, 'a row with no uuid is counted, not silently dropped');
    assert.equal(result.providers, 1, 'the same crawl records its providers');
    assert.ok(await models.GisProvidersNew.findOne({ where: { name: 'X' } }), 'provider X is in gis_providers_new');

    const row = await models.Gisgamesnew.findOne({ where: { uuid }, raw: true });
    assert.equal(row.name, 'After');
    assert.equal(row.is_mobile, true);
    assert.equal(
      String(row.updated_at),
      '1700000000',
      "the provider's epoch stamp lands in the bigint column, not an ORM timestamp"
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The signer
  // ══════════════════════════════════════════════════════════════════════

  await t.test('nested parameters sign in PHP bracket form, sorted', async () => {
    // The signed string has to match the request body byte for byte, including
    // how a space is encoded. Pinned so a "tidier" implementation cannot drift.
    const headers = { 'X-Merchant-Id': 'm', 'X-Timestamp': '100', 'X-Nonce': 'n' };

    const flat = provider.sign({ b: 'two words', a: 1 }, headers);
    const nested = provider.sign({ list: [{ id: 'x' }] }, headers);

    assert.match(flat, /^[0-9a-f]{40}$/, 'HMAC-SHA1, hex');
    assert.notEqual(flat, nested);

    // Key order in the object must not change the signature.
    assert.equal(flat, provider.sign({ a: 1, b: 'two words' }, headers));
  });

  await t.test("owner's INR-as-PKR: the game opens in PKR, callbacks convert PKR → INR and move the INR wallet", async () => {
    const q = (sql) => connection.sequelize.query(sql);
    // 1 INR = 3 PKR at these rates. Inserted only for this test, removed after.
    const added = [];
    for (const [cur, rate] of [['INR', '0.012'], ['PKR', '0.004']]) {
      const [rows] = await q(`SELECT 1 FROM exchangerate WHERE UPPER(currency) = '${cur}'`);
      if (!rows.length) {
        await q(`INSERT INTO exchangerate (currency, usd_rate) VALUES ('${cur}', ${rate})`);
        added.push(cur);
      }
    }
    await q("INSERT INTO site_features (feature, enabled, variant) VALUES ('slotegrator_inr_as_pkr', true, 'on') ON CONFLICT (feature) DO UPDATE SET variant = 'on'");
    try {
      const uid = await seedPlayer(newUid());
      const balances = new Map([[String(uid), '1000']]);
      const sent = [];
      const service = new GisService({
        models,
        db: connection,
        logger,
        wallet: makeWallet(balances),
        provider: { configured: true, sign: (...a) => provider.sign(...a), async post(_path, params) { sent.push(params); return { url: 'https://game.test' }; } },
        games: { async recordPlay() {}, async recordActivity() {} },
        config: { SERVICE_NAME: 'casino-service', GIS_MAX_SKEW_SECONDS: 300 },
      });

      const { sessionId } = await service.launch({ userId: uid, gameUuid: 'g-pkr', playerName: 'p', currency: 'INR', device: 'desktop' });
      assert.equal(sent[0].currency, 'PKR', 'an INR game opens in PKR');

      const call = (body) => service.handleTransaction(callback({ player_id: String(uid), currency: 'PKR', session_id: sessionId, ...body }));
      const [r] = await connection.sequelize.query("SELECT usd_rate FROM exchangerate WHERE UPPER(currency) = 'INR'");
      const [p] = await connection.sequelize.query("SELECT usd_rate FROM exchangerate WHERE UPPER(currency) = 'PKR'");
      const fx = Number(r[0].usd_rate) / Number(p[0].usd_rate);

      const probe = await call({ action: 'balance' });
      assert.equal(Number(probe.balance).toFixed(2), (1000 * fx).toFixed(2), 'the balance is quoted in PKR');

      const bet = await call({ action: 'bet', amount: String(30 * fx), transaction_id: newTxId() });
      assert.equal(Number(balances.get(String(uid))).toFixed(4), '970.0000', 'a PKR bet debits its INR value');
      assert.equal(Number(bet.balance).toFixed(2), (970 * fx).toFixed(2));

      await call({ action: 'win', amount: String(50 * fx), transaction_id: newTxId() });
      assert.equal(Number(balances.get(String(uid))).toFixed(4), '1020.0000', 'a PKR win credits its INR value');

      // A PKR callback for any other session is the PKR wallet's, untouched by the switch.
      const other = await service.handleTransaction(callback({ action: 'balance', player_id: String(uid), currency: 'PKR', session_id: 'not-an-inr-session' }));
      assert.equal(other.balance, '1020.0000', 'no conversion outside an INR-as-PKR session');

      await q("UPDATE site_features SET variant = 'off' WHERE feature = 'slotegrator_inr_as_pkr'");
      await service.launch({ userId: uid, gameUuid: 'g-pkr', playerName: 'p', currency: 'INR', device: 'desktop' });
      assert.equal(sent[1].currency, 'INR', 'switched off: INR opens in INR');
    } finally {
      await q("DELETE FROM site_features WHERE feature = 'slotegrator_inr_as_pkr'");
      for (const cur of added) await q(`DELETE FROM exchangerate WHERE UPPER(currency) = '${cur}'`);
    }
  });
});
