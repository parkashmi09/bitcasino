'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const db = require('@ibitplay/db');
const { createLogger, money, withdrawalCapFigures } = require('@ibitplay/common');

const { OriginalGamesService } = require('../originalGames.service');
const { OriginalGamesClient, sign } = require('../provider/client');

/** The guide's go-live wallet checklist (§9 / §10), case by case, against a real database. */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const WEBHOOK_SECRET = 'og-webhook-secret';
const PATH = '/api/v1/casino/original-games/wallet';

let nextUid = 970_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);
let seq = 0;
const newTx = () => `og-test-${process.pid}-${Date.now()}-${(seq += 1)}`;

test('original games aggregator', async (t) => {
  const logger = createLogger({ name: 'og-test', level: 'silent' });
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
      service: 'casino-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }
  const { models } = connection;
  // Every player this suite makes is removed after it, rounds and all: left behind they are direct
  // users with Original Games play, and the admin reports' fixtures then count them.
  const made = [];
  t.after(async () => {
    if (made.length) {
      await connection.sequelize.query('DELETE FROM og_transactions WHERE user_id IN (:ids)', { replacements: { ids: made } });
      await connection.sequelize.query('DELETE FROM og_sessions WHERE user_id IN (:ids)', { replacements: { ids: made } });
      await models.Users.destroy({ where: { id: made } });
    }
    await connection.close();
  });

  /** user-service stand-in: overdraft refused, idempotent per (reason, ref). */
  const balances = new Map();
  const moves = [];
  const applied = new Map();
  const wallet = {
    async balance(userId, currency) {
      return { balance: balances.get(`${userId}:${currency}`) ?? null };
    },
    async move(sign_, { userId, currency, amount, reason, ref, betId }) {
      moves.push({ reason, txId: ref.id, betId });
      const key = `${reason}:${ref.id}`;
      if (applied.has(key)) return applied.get(key);
      const k = `${userId}:${currency}`;
      const next = sign_ > 0 ? money.add(balances.get(k), amount) : money.subtract(balances.get(k), amount);
      if (next < 0n) throw Object.assign(new Error('Insufficient funds'), { code: 'WALLET_INSUFFICIENT_FUNDS' });
      balances.set(k, money.toDecimalString(next));
      const movement = { newBalance: balances.get(k) };
      applied.set(key, movement);
      return movement;
    },
    credit(args) { return this.move(1, args); },
    debit(args) { return this.move(-1, args); },
  };

  const wagers = [];
  const reversals = [];
  let upstream = null;
  const provider = new OriginalGamesClient({
    baseUrl: 'https://og.test',
    apiKey: 'ak_test',
    apiSecret: 'api-secret',
    webhookSecret: WEBHOOK_SECRET,
    fetchImpl: async (url, init) => {
      upstream = { url, init };
      if (String(url).endsWith('/v1/games')) {
        return { ok: true, status: 200, json: async () => ({ games: [{ game_code: 'crash', name: 'Crash' }, { game_code: 'mines', name: 'Mines', image_url: 'https://x/m.png' }] }) };
      }
      return { ok: true, status: 201, json: async () => ({ session_id: crypto.randomUUID(), launch_url: 'https://games.test/crash?token=lt_x' }) };
    },
  });
  const service = new OriginalGamesService({
    db: connection,
    models,
    logger,
    wallet,
    provider,
    config: { OG_ENV: 'sandbox' },
    games: {
      async recordActivity(entry) { wagers.push(entry); },
      async reverseActivity(entry) { reversals.push(entry); },
    },
  });

  const player = async (inr = '100', usdt = '0') => {
    const uid = newUid();
    made.push(uid);
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name: `og-${uid}`, password: 'x', status: 'active' });
    balances.set(`${uid}:INR`, inr);
    balances.set(`${uid}:USDT`, usdt);
    return uid;
  };

  /** A callback exactly as the aggregator signs it. */
  const call = (action, body, { secret = WEBHOOK_SECRET, at = Math.floor(Date.now() / 1000), nonce } = {}) => {
    const raw = Buffer.from(JSON.stringify(body));
    const n = nonce ?? crypto.randomBytes(16).toString('hex');
    const path = `${PATH}/${action}`;
    const headers = {
      'x-timestamp': String(at),
      'x-nonce': n,
      'x-signature': sign(secret, { method: 'POST', path, query: '', timestamp: String(at), nonce: n, body: raw }),
    };
    return service.callback(action, { body, rawBody: raw, headers, method: 'POST', path, query: '' });
  };

  await t.test('wallet.verifies_signature / clock / replay', async () => {
    const uid = await player();
    const body = { player_id: String(uid), currency: 'INR' };
    assert.strictEqual((await call('balance', body, { secret: 'wrong' })).status, 401);
    assert.strictEqual((await call('balance', body, { at: Math.floor(Date.now() / 1000) - 120 })).body.error_code, 'REQUEST_EXPIRED');
    const nonce = crypto.randomBytes(16).toString('hex');
    assert.strictEqual((await call('balance', body, { nonce })).status, 200);
    assert.strictEqual((await call('balance', body, { nonce })).body.error_code, 'REPLAY_DETECTED');
  });

  await t.test('wallet.balance is integer minor units at each exponent', async () => {
    const uid = await player('12.5', '3.25');
    assert.deepStrictEqual((await call('balance', { player_id: String(uid), currency: 'INR' })).body, { status: 'OK', balance: 1250, currency: 'INR' });
    assert.deepStrictEqual((await call('balance', { player_id: String(uid), currency: 'USDT' })).body, { status: 'OK', balance: 3_250_000, currency: 'USDT' });
    assert.strictEqual((await call('balance', { player_id: '1', currency: 'BTC' })).body.error_code, 'CURRENCY_MISMATCH');
  });

  await t.test('the validation player answers as OG_VALIDATION_USER_ID, and only when it is set', async () => {
    const uid = await player('5');
    const body = { player_id: '__aggregator_validation__', currency: 'INR' };
    assert.strictEqual((await call('balance', body)).body.error_code, 'PLAYER_NOT_FOUND');
    service.config.OG_VALIDATION_USER_ID = String(uid);
    try {
      assert.deepStrictEqual((await call('balance', body)).body, { status: 'OK', balance: 500, currency: 'INR' });
      const bet = { ...body, transaction_id: newTx(), amount: 1 };
      const first = await call('bet', bet);
      assert.deepStrictEqual(await call('bet', bet), first);
      assert.strictEqual(balances.get(`${uid}:INR`), '4.99000000');
    } finally {
      delete service.config.OG_VALIDATION_USER_ID;
    }
  });

  await t.test('wallet.bet_dedupe — a repeat returns the original answer and debits once', async () => {
    const uid = await player('100');
    const bet = { player_id: String(uid), currency: 'INR', transaction_id: newTx(), round_id: 'r1', game_code: 'crash', amount: 5000 };
    const first = await call('bet', bet);
    const again = await call('bet', bet);
    assert.strictEqual(first.body.balance, 5000);
    assert.deepStrictEqual(again.body, first.body);
    assert.strictEqual(balances.get(`${uid}:INR`), '50.00000000');
    assert.deepStrictEqual(wagers.at(-1), { userId: uid, gameRef: null, wagered: '50.00000000', currency: 'INR', source: 'original-games', ref: bet.transaction_id, category: 'originals', provider: 'BC Originals', catalogueRef: 'crash' });
  });

  await t.test('bet_id — the round\'s bet, win and rollback all carry the bet row\'s og_transactions id', async () => {
    const uid = await player('100');
    const round = `r-${newTx()}`;
    const bet = { player_id: String(uid), currency: 'INR', transaction_id: newTx(), round_id: round, game_code: 'crash', amount: 1000 };
    const win = { ...bet, transaction_id: newTx(), amount: 500 };
    await call('bet', bet);
    await call('win', win);
    await call('rollback', { player_id: String(uid), currency: 'INR', transaction_id: newTx(), reference_transaction_id: win.transaction_id, amount: 500 });
    const [{ id }] = await connection.sequelize.query('SELECT id FROM og_transactions WHERE transaction_id = :tx', { replacements: { tx: bet.transaction_id }, type: 'SELECT' });
    assert.deepStrictEqual(moves.slice(-3).map((m) => [m.reason, m.betId]), [['BET_STAKE', Number(id)], ['BET_PAYOUT', Number(id)], ['BET_ROLLBACK', Number(id)]]);
  });

  await t.test('wallet.insufficient_funds — refused, nothing debited', async () => {
    const uid = await player('1');
    const res = await call('bet', { player_id: String(uid), currency: 'INR', transaction_id: newTx(), amount: 1_000_000 });
    assert.deepStrictEqual(res.body, { status: 'ERROR', error_code: 'INSUFFICIENT_FUNDS', balance: 100, currency: 'INR' });
    assert.strictEqual(balances.get(`${uid}:INR`), '1');
  });

  await t.test('wallet.zero_win and win credit', async () => {
    const uid = await player('10');
    const zero = await call('win', { player_id: String(uid), currency: 'INR', transaction_id: newTx(), amount: 0, is_round_end: true });
    assert.deepStrictEqual(zero.body.status, 'OK');
    const win = await call('win', { player_id: String(uid), currency: 'INR', transaction_id: newTx(), amount: 250 });
    assert.strictEqual(win.body.balance, 1250);
  });

  await t.test('wallet.rollback_unknown → 200, and the late bet is refused', async () => {
    const uid = await player('10');
    const betId = newTx();
    const rb = await call('rollback', { player_id: String(uid), currency: 'INR', transaction_id: newTx(), reference_transaction_id: betId, amount: 500 });
    assert.deepStrictEqual(rb.body, { status: 'OK', balance: 1000, currency: 'INR' });
    const late = await call('bet', { player_id: String(uid), currency: 'INR', transaction_id: betId, amount: 500 });
    assert.strictEqual(late.body.status, 'ERROR');
    assert.strictEqual(balances.get(`${uid}:INR`), '10');
  });

  await t.test('rollback of a bet refunds OUR amount once; wager nets out', async () => {
    const uid = await player('0', '10');
    const betId = newTx();
    await call('bet', { player_id: String(uid), currency: 'USDT', transaction_id: betId, amount: 2_000_000 });
    const rollback = { player_id: String(uid), currency: 'USDT', transaction_id: newTx(), reference_transaction_id: betId, amount: 9_000_000 };
    assert.strictEqual((await call('rollback', rollback)).body.balance, 10_000_000);
    assert.strictEqual((await call('rollback', rollback)).body.balance, 10_000_000);
    const other = await call('rollback', { ...rollback, transaction_id: newTx() });
    assert.strictEqual(other.body.balance, 10_000_000);
    assert.strictEqual(balances.get(`${uid}:USDT`), '10.00000000');
    assert.strictEqual(reversals.at(-1).ref, betId);

    const bet2 = newTx();
    await call('bet', { player_id: String(uid), currency: 'USDT', transaction_id: bet2, amount: 1_500_000 });
    const { wagered } = await withdrawalCapFigures.createCapFigures({ db: connection }).figures(uid, 'USDT');
    assert.strictEqual(wagered, '1.50000000');
  });

  await t.test('rollback of a spent win is acknowledged, never negative', async () => {
    const uid = await player('0');
    const winId = newTx();
    await call('win', { player_id: String(uid), currency: 'INR', transaction_id: winId, amount: 1000 });
    balances.set(`${uid}:INR`, '0');
    const res = await call('rollback', { player_id: String(uid), currency: 'INR', transaction_id: newTx(), reference_transaction_id: winId });
    assert.deepStrictEqual(res.body, { status: 'OK', balance: 0, currency: 'INR' });
  });

  await t.test('one Original switched off leaves the list, refuses its launch, and survives a sync', async () => {
    await service.syncGames();
    await service.setGameEnabled({ gameCode: 'mines', enabled: false });
    try {
      assert.deepStrictEqual((await service.listGames()).map((g) => g.game_code), ['crash']);
      assert.strictEqual((await service.adminGames()).find((g) => g.gameCode === 'mines').enabled, false);
      const uid = await player('100');
      await assert.rejects(service.launch({ userId: uid, gameCode: 'mines', currency: 'INR' }), { code: 'ORIGINAL_GAMES_GAME_DISABLED' });
      await service.syncGames();
      assert.deepStrictEqual((await service.listGames()).map((g) => g.game_code), ['crash'], 'the sync keeps the switch');
      await assert.rejects(service.setGameEnabled({ gameCode: 'nope', enabled: true }), { status: 404 });
    } finally {
      await service.setGameEnabled({ gameCode: 'mines', enabled: true });
    }
  });

  await t.test('catalogue sync, and the admin switch closes list, launch and new bets', async () => {
    const out = await service.syncGames();
    assert.deepStrictEqual(out.codes, ['crash', 'mines']);
    assert.deepStrictEqual(await service.listGames(), [
      { game_code: 'crash', name: 'Crash', image: null },
      { game_code: 'mines', name: 'Mines', image: 'https://x/m.png' },
    ]);

    const uid = await player('100');
    const [[before]] = await connection.sequelize.query('SELECT originals FROM siteconfig LIMIT 1');
    if (before) await connection.sequelize.query('UPDATE siteconfig SET originals = false');
    else await connection.sequelize.query('INSERT INTO siteconfig (originals, registerbonus, createdat, updatedat) VALUES (false, 0, NOW(), NOW())');
    try {
      assert.deepStrictEqual(await service.listGames(), []);
      await assert.rejects(service.launch({ userId: uid, gameCode: 'crash', currency: 'INR' }), { status: 403 });
      const bet = await call('bet', { player_id: String(uid), currency: 'INR', transaction_id: newTx(), amount: 100 });
      assert.strictEqual(bet.body.error_code, 'MAINTENANCE');
      assert.strictEqual(balances.get(`${uid}:INR`), '100');
    } finally {
      if (before) await connection.sequelize.query('UPDATE siteconfig SET originals = :v', { replacements: { v: before.originals } });
      else await connection.sequelize.query('DELETE FROM siteconfig');
    }
  });

  await t.test('launch is signed, demo on a sandbox key, and the session pins its currency', async () => {
    const uid = await player('100');
    const out = await service.launch({ userId: uid, gameCode: 'crash', currency: 'INR', device: 'desktop' });
    assert.strictEqual(out.mode, 'demo');
    const sent = JSON.parse(upstream.init.body);
    assert.strictEqual(sent.player.id, String(uid));
    assert.match(upstream.init.headers['X-Signature'], /^sha256=[0-9a-f]{64}$/);
    assert.ok(upstream.init.headers['Idempotency-Key']);
    const res = await call('balance', { player_id: String(uid), currency: 'USDT', session_id: out.sessionId });
    assert.strictEqual(res.body.error_code, 'CURRENCY_MISMATCH');
  });

  await t.test('the Original Games lock refuses launch and bets; the casino lock alone does not', async () => {
    const locked = await player('100');
    await models.Users.update({ originals_locked: true }, { where: { id: locked } });
    await assert.rejects(service.launch({ userId: locked, gameCode: 'crash', currency: 'INR' }), { status: 403, code: 'ORIGINAL_GAMES_ORIGINALS_LOCKED' });
    const refused = await call('bet', { player_id: String(locked), currency: 'INR', transaction_id: newTx(), amount: 100 });
    assert.strictEqual(refused.body.error_code, 'PLAYER_BLOCKED');
    assert.strictEqual(balances.get(`${locked}:INR`), '100');

    const casinoOnly = await player('100');
    await models.Users.update({ casino_locked: true }, { where: { id: casinoOnly } });
    assert.ok((await service.launch({ userId: casinoOnly, gameCode: 'crash', currency: 'INR' })).sessionId);
    const placed = await call('bet', { player_id: String(casinoOnly), currency: 'INR', transaction_id: newTx(), amount: 100 });
    assert.strictEqual(placed.body.status, 'OK');
    assert.strictEqual(balances.get(`${casinoOnly}:INR`), '99.00000000');
  });
});
