'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { JsGamesService } = require('../jsGames.service');
const { HuiduClient } = require('../providers/huidu');
const { XGamesApiClient } = require('../providers/xgamesApi');
const { CODE } = require('../jsGames.constants');
const v = require('../jsGames.validators');

/**
 * The two LAUNCH paths, against a mocked provider.
 *
 * The callbacks are covered in `jsGames.test.js`; this file proves the other half — the exact
 * request we send when a player presses Play, and what we do with the URL that comes back — so
 * the day the keys are set the only unknown left is the provider itself. The bodies asserted here
 * are the ones a live SmartBet launch was checked against on 2026-10-12 (201, a bgaming-asia /
 * Pragmatic / Evolution URL; USDT refused upstream with HTTP 400).
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const AES_KEY = 'b'.repeat(32);
const API_KEY = 'launch-api-key';
const API_SECRET = 'launch-api-secret';

let nextUid = 981_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('jsGames launch', async (t) => {
  const logger = createLogger({ name: 'jsgames-launch-test', level: 'silent' });

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
  const created = { users: [], jsGames: [] };
  t.after(async () => {
    try {
      // Only what this run created.
      await models.GameSession.destroy({ where: { user_id: created.users } });
      await models.JsGameSessions.destroy({ where: { user_id: created.users } });
      await models.JsGames.destroy({ where: { game_uid: created.jsGames } });
      await models.Users.destroy({ where: { id: created.users } });
    } finally {
      await connection.close();
    }
  });

  /** A fetch that records each call and answers with `reply(url, init)`. */
  const mockFetch = (reply) => {
    const calls = [];
    const impl = async (url, init) => {
      calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
      const { status = 200, json } = await reply(url, init);
      return { ok: status >= 200 && status < 300, status, json: async () => json };
    };
    return { calls, impl };
  };

  const wallet = (balances) => ({
    async balance(userId, currency) {
      return { balance: balances[`${userId}:${currency}`] ?? null };
    },
  });

  const seedPlayer = async () => {
    const uid = newUid();
    created.users.push(uid);
    await models.Users.destroy({ where: { id: uid } });
    await models.Users.create({ id: uid, name: `launch-${uid}`, password: 'x', status: 'active' });
    return uid;
  };

  const service = ({ v1, v2, balances = {}, config = {} }) =>
    new JsGamesService({
      models,
      db: connection,
      logger,
      wallet: wallet(balances),
      clients: {},
      v1,
      v2,
      config: { SERVICE_NAME: 'casino-service', ...config },
    });

  const v2Client = (fetchImpl, overrides = {}) =>
    new XGamesApiClient({
      baseUrl: 'https://games.test/api/game',
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      logger,
      fetchImpl,
      ...overrides,
    });

  // ── v2 — the catalogue games ─────────────────────────────────────────────────────────────

  await t.test('v2 sends the signed launch the provider expects and returns its URL', async () => {
    const uid = await seedPlayer();
    const { calls, impl } = mockFetch(() => ({
      status: 200,
      json: { success: true, data: { game_launch_url: 'https://bgaming.test/games/X/INR?launch_token=t', session_token: `sess-${uid}` } },
    }));
    const v2 = v2Client(impl);
    const result = await service({ v2, balances: { [`${uid}:INR`]: '925.5' } }).launchV2({
      userId: uid,
      gameUid: '0ff664578bfb50141faf64a66c348c7e',
      currencyCode: 'INR',
      language: 'en',
    });

    assert.deepStrictEqual(result, { gameLaunchUrl: 'https://bgaming.test/games/X/INR?launch_token=t', sessionToken: `sess-${uid}` });
    assert.strictEqual(calls.length, 1);
    const [call] = calls;
    assert.strictEqual(call.url, 'https://games.test/api/game/launch');
    assert.strictEqual(call.init.method, 'POST');
    // The player comes from the token, the credit from the real balance — never from the request.
    assert.deepStrictEqual(call.body, {
      game_uid: '0ff664578bfb50141faf64a66c348c7e',
      user_id: String(uid),
      credit_amount: money.toDecimalString(money.toMinor('925.5')),
      currency_code: 'INR',
      language: 'en',
      name: `launch-${uid}`,
    });
    const h = call.init.headers;
    assert.strictEqual(h['x-api-key'], API_KEY);
    assert.strictEqual(h['x-signature'], v2.sign({ ...call.body, timestamp: h['x-timestamp'] }));

    const row = await models.GameSession.findOne({ where: { user_id: uid, session_token: `sess-${uid}` }, raw: true });
    assert.ok(row, 'the launch is recorded');
    assert.strictEqual(row.launch_url, result.gameLaunchUrl);
  });

  await t.test('v2 sends a player with no wallet row as a zero credit, in the asked currency', async () => {
    const uid = await seedPlayer();
    const { calls, impl } = mockFetch(() => ({ json: { success: true, data: { game_launch_url: 'https://p.test/u', session_token: `s2-${uid}` } } }));
    await service({ v2: v2Client(impl) }).launchV2({ userId: uid, gameUid: 'g-1', currencyCode: 'usdt' });
    assert.strictEqual(calls[0].body.credit_amount, '0');
    assert.strictEqual(calls[0].body.currency_code, 'USDT');
    assert.strictEqual(calls[0].body.language, 'en', 'language defaults to en');
  });

  await t.test('v2 without keys refuses by name and calls nothing', async () => {
    const uid = await seedPlayer();
    const { calls, impl } = mockFetch(() => ({ json: {} }));
    const v2 = v2Client(impl, { apiKey: '', apiSecret: '' });
    await assert.rejects(
      service({ v2 }).launchV2({ userId: uid, gameUid: 'g-1', currencyCode: 'INR' }),
      (error) => error.code === 'JSGAMES_NOT_CONFIGURED' && error.status === 503,
    );
    assert.strictEqual(calls.length, 0);
  });

  await t.test('v2 reports an HTTP-200 refusal as REJECTED with the provider code, not as unreachable', async () => {
    const uid = await seedPlayer();
    const { impl } = mockFetch(() => ({ status: 200, json: { success: false, error: { code: 10004, message: 'Game launch failed' } } }));
    await assert.rejects(
      service({ v2: v2Client(impl) }).launchV2({ userId: uid, gameUid: 'g-1', currencyCode: 'USDT' }),
      (error) => error.code === 'JSGAMES_UPSTREAM_REJECTED' && error.details?.upstreamCode === 10004,
    );
  });

  await t.test('v2 reports an HTTP-400 refusal as REJECTED (what USDT gets on the live operator)', async () => {
    const uid = await seedPlayer();
    const { impl } = mockFetch(() => ({ status: 400, json: { success: false, error: { code: 10004, message: 'Unsupported currency' } } }));
    await assert.rejects(
      service({ v2: v2Client(impl) }).launchV2({ userId: uid, gameUid: 'g-1', currencyCode: 'USDT' }),
      (error) => error.code === 'JSGAMES_UPSTREAM_REJECTED' && error.details?.status === 400,
    );
  });

  await t.test('v2 reports a network failure as UPSTREAM_FAILED', async () => {
    const uid = await seedPlayer();
    const impl = async () => {
      throw new TypeError('fetch failed');
    };
    await assert.rejects(
      service({ v2: v2Client(impl) }).launchV2({ userId: uid, gameUid: 'g-1', currencyCode: 'INR' }),
      (error) => error.code === 'JSGAMES_UPSTREAM_FAILED',
    );
  });

  await t.test('v2 refuses a success that carries no URL', async () => {
    const uid = await seedPlayer();
    const { impl } = mockFetch(() => ({ json: { success: true, data: { session_token: 's' } } }));
    await assert.rejects(
      service({ v2: v2Client(impl) }).launchV2({ userId: uid, gameUid: 'g-1', currencyCode: 'INR' }),
      (error) => error.code === 'JSGAMES_UPSTREAM_REJECTED',
    );
  });

  // ── v1 — the in-house games (huidu) ──────────────────────────────────────────────────────

  await t.test('v1 sends the encrypted launch with the return URL and returns the URL', async () => {
    const uid = await seedPlayer();
    const gameUid = `launch-test-${uid}`;
    created.jsGames.push(gameUid);
    await models.JsGames.create({ game_uid: gameUid, game_name: 'Launch Test', vendor: 'in-house', game_type: 'Originals', is_active: true });

    const { calls, impl } = mockFetch(() => ({
      json: { code: CODE.SUCCESS, payload: { game_launch_url: 'https://huidu.test/play?t=1' } },
    }));
    const v1 = new HuiduClient({ baseUrl: 'https://huidu.test', agencyUid: 'agency-9', aesKey: AES_KEY, playerPrefix: 'h24e9e', logger, fetchImpl: impl });
    const result = await service({ v1, balances: { [`${uid}:INR`]: '12.34' } }).launchV1({
      userId: uid,
      gameUid,
      currencyCode: 'INR',
      language: 'en',
      homeUrl: 'https://site.test/game/crash',
    });

    assert.strictEqual(result.gameLaunchUrl, 'https://huidu.test/play?t=1');
    assert.match(result.sessionToken, /^[0-9a-f]{32}$/);
    assert.strictEqual(calls[0].url, 'https://huidu.test/game/v1');
    assert.strictEqual(calls[0].body.agency_uid, 'agency-9');
    const payload = v1.decrypt(calls[0].body.payload);
    assert.strictEqual(payload.member_account, `h24e9e_INR_${uid}`);
    assert.strictEqual(payload.game_uid, gameUid);
    assert.strictEqual(payload.credit_amount, money.toDecimalString(money.toMinor('12.34')));
    assert.strictEqual(payload.currency_code, 'INR');
    assert.strictEqual(payload.language, 'en');
    assert.strictEqual(payload.home_url, 'https://site.test/game/crash');
  });

  await t.test('v1 without a 32-byte key refuses by name', async () => {
    const uid = await seedPlayer();
    const v1 = new HuiduClient({ baseUrl: 'https://huidu.test', agencyUid: 'a', aesKey: 'short', playerPrefix: 'p', logger });
    await assert.rejects(
      service({ v1 }).launchV1({ userId: uid, gameUid: 'crash', currencyCode: 'INR' }),
      (error) => error.code === 'JSGAMES_NOT_CONFIGURED',
    );
  });

  // ── the request bodies the frontend may send ─────────────────────────────────────────────

  await t.test('the v2 body takes gameUid, currencyCode and language, and nothing else', () => {
    const ok = v.launchV2.body.safeParse({ gameUid: 'g', currencyCode: 'INR', language: 'en' });
    assert.ok(ok.success);
    // No return URL and no demo flag on v2: the frontend must not send them (422 otherwise).
    assert.strictEqual(v.launchV2.body.safeParse({ gameUid: 'g', currencyCode: 'INR', homeUrl: 'https://x.test/' }).success, false);
    assert.strictEqual(v.launchV2.body.safeParse({ gameUid: 'g', currencyCode: 'INR', demo: true }).success, false);
    assert.strictEqual(v.launchV2.body.safeParse({ gameUid: 'g', currencyCode: 'BTC' }).success, false);
  });

  await t.test('the v1 body also takes a return URL', () => {
    assert.ok(v.launchV1.body.safeParse({ gameUid: 'crash', currencyCode: 'INR', language: 'en', homeUrl: 'http://localhost:5190/game/crash' }).success);
    assert.strictEqual(v.launchV1.body.safeParse({ gameUid: 'crash', currencyCode: 'INR', homeUrl: 'not a url' }).success, false);
  });
});
