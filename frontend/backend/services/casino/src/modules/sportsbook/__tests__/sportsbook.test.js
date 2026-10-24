'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { SportsbookService } = require('../sportsbook.service');
const { SlotegratorClient } = require('../../gis/provider/slotegrator');
const { SESSION_STATUS, SESSION_TTL_MS } = require('../sportsbook.constants');

/**
 * Third-party sportsbook aggregator.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * This module was NEVER MOUNTED in legacy, so unlike every other test file in
 * this port there is no production behaviour to pin down. What the tests below
 * assert is that the four defects in the unmounted source are closed:
 *
 *   1. `init` took `player_id` from the request body — a real-money session on
 *      any account. There is no way to name a player here at all.
 *   2. `logout` ended whatever session a body token named.
 *   3. `refresh-token` opened a NEW session instead of refreshing one.
 *   4. `launch` fetched any URL the caller gave it. Not ported — the test for
 *      that is that no route exists.
 * ═════════════════════════════════════════════════════════════════════════
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 940_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

const BOOK = 'book-uuid-1';

test('sportsbook', async (t) => {
  const logger = createLogger({ name: 'sportsbook-test', level: 'silent' });

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
  const created = [];

  // Rows first, connection last — node:test runs `after` hooks in registration
  // order, so closing the connection first would strand the cleanup.
  t.after(async () => {
    if (created.length) {
      await models.SportsbookSession.destroy({ where: { user_id: created } });
      await models.Users.destroy({ where: { id: created } });
    }
  });
  t.after(async () => {
    if (connection) await connection.close();
  });

  /** A player who exists and is not locked. */
  const makePlayer = async (overrides = {}) => {
    const id = newUid();
    created.push(id);
    await models.Users.create({
      id,
      name: `sb${id}`,
      email: `sb${id}@test.local`,
      password: 'x',
      ...overrides,
    });
    return id;
  };

  /**
   * A provider that records what it was asked and answers with a fixture.
   *
   * The signing is real — a `SlotegratorClient` with a test key — so the params
   * the service builds go through the same path they would in production.
   */
  const makeProvider = ({ reply = { url: 'https://book.test/play', token: 'tok-1' }, fail = null } = {}) => {
    const calls = [];
    const client = new SlotegratorClient({
      baseUrl: 'https://sb.test/v1',
      merchantId: 'sb-merchant',
      merchantKey: 'sb-key',
      rateLimitMs: 0,
      logger,
      fetchImpl: async (url, options) => {
        calls.push({ url: String(url), body: options?.body ?? null });
        if (fail) throw Object.assign(new Error('upstream'), { status: fail });
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => reply,
          text: async () => JSON.stringify(reply),
        };
      },
    });
    return { client, calls };
  };

  const build = (provider, config = {}) =>
    new SportsbookService({
      models,
      logger,
      provider,
      config: { SERVICE_NAME: 'casino-service', ...config },
    });

  // ── 1. The session belongs to the caller ──────────────────────────────

  await t.test('init opens a session against the authenticated player only', async () => {
    const userId = await makePlayer();
    const { client } = makeProvider();
    const service = build(client);

    const result = await service.init({ userId, sportsbookUuid: BOOK, currency: 'USDT' });

    assert.ok(result.sessionId, 'a session id is returned');
    assert.strictEqual(result.url, 'https://book.test/play');

    const row = await models.SportsbookSession.findOne({ where: { session_id: result.sessionId } });
    assert.strictEqual(String(row.user_id), String(userId));
    assert.strictEqual(row.status, SESSION_STATUS.OPEN);
  });

  await t.test('init has no parameter that could name another player', () => {
    /**
     * The legacy defect, stated as a property of the interface rather than of
     * one call: `player_id` was a body field. A validator with `.strict()` and
     * no such key means there is no request that carries one.
     */
    const v = require('../sportsbook.validators');
    const keys = Object.keys(v.init.body.shape);

    assert.ok(!keys.includes('player_id'));
    assert.ok(!keys.includes('playerId'));
    assert.ok(!keys.includes('userId'));

    // And an attempt to send one is rejected rather than ignored.
    const parsed = v.init.body.safeParse({ sportsbookUuid: BOOK, currency: 'USDT', player_id: '1' });
    assert.strictEqual(parsed.success, false);
  });

  await t.test('the player id reaches the provider from the token, not the body', async () => {
    const userId = await makePlayer();
    const { client, calls } = makeProvider();
    const service = build(client);

    await service.init({ userId, sportsbookUuid: BOOK, currency: 'USDT' });

    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].body, new RegExp(`player_id=${userId}`));
  });

  // ── 2. Logout ends only your own session ──────────────────────────────

  await t.test("logout cannot end another player's session", async () => {
    const owner = await makePlayer();
    const stranger = await makePlayer();
    const { client } = makeProvider();
    const service = build(client);

    const { sessionId } = await service.init({ userId: owner, sportsbookUuid: BOOK, currency: 'USDT' });

    await assert.rejects(
      () => service.logout({ userId: stranger, sessionId }),
      (error) => error.code === 'SPORTSBOOK_SESSION_NOT_FOUND',
      'a stranger gets the same answer as for a session that does not exist'
    );

    const row = await models.SportsbookSession.findOne({ where: { session_id: sessionId } });
    assert.strictEqual(row.status, SESSION_STATUS.OPEN, 'and the session is untouched');
  });

  await t.test('logout closes the row even when the provider does not confirm', async () => {
    const userId = await makePlayer();
    const { client } = makeProvider();
    const service = build(client);
    const { sessionId } = await service.init({ userId, sportsbookUuid: BOOK, currency: 'USDT' });

    // The provider now fails. A player asking to be logged out should be.
    service.provider = makeProvider({ fail: 500 }).client;

    const result = await service.logout({ userId, sessionId });
    assert.strictEqual(result.status, SESSION_STATUS.CLOSED);

    const row = await models.SportsbookSession.findOne({ where: { session_id: sessionId } });
    assert.strictEqual(row.status, SESSION_STATUS.CLOSED);
    assert.ok(row.closed_at, 'and it records when');
  });

  await t.test('a closed session cannot be closed again', async () => {
    const userId = await makePlayer();
    const { client } = makeProvider();
    const service = build(client);
    const { sessionId } = await service.init({ userId, sportsbookUuid: BOOK, currency: 'USDT' });

    await service.logout({ userId, sessionId });
    await assert.rejects(
      () => service.logout({ userId, sessionId }),
      (error) => error.code === 'SPORTSBOOK_SESSION_CLOSED'
    );
  });

  // ── 3. Refresh refreshes ──────────────────────────────────────────────

  await t.test('refresh keeps the session id instead of opening a second session', async () => {
    const userId = await makePlayer();
    const { client } = makeProvider({ reply: { url: 'https://book.test/play', token: 'tok-1' } });
    const service = build(client);

    const opened = await service.init({ userId, sportsbookUuid: BOOK, currency: 'USDT' });

    service.provider = makeProvider({ reply: { url: 'https://book.test/play2', token: 'tok-2' } }).client;
    const refreshed = await service.refresh({ userId, sessionId: opened.sessionId });

    assert.strictEqual(refreshed.sessionId, opened.sessionId, 'the SAME session');
    assert.strictEqual(refreshed.token, 'tok-2', 'with a new token');

    /**
     * Legacy's version generated a fresh uuid and called init, so this count
     * would have been 2 — a second real-money session with the first abandoned.
     */
    const count = await models.SportsbookSession.count({ where: { user_id: userId } });
    assert.strictEqual(count, 1);
  });

  await t.test("refresh cannot resume another player's session", async () => {
    const owner = await makePlayer();
    const stranger = await makePlayer();
    const { client } = makeProvider();
    const service = build(client);

    const { sessionId } = await service.init({ userId: owner, sportsbookUuid: BOOK, currency: 'USDT' });

    await assert.rejects(
      () => service.refresh({ userId: stranger, sessionId }),
      (error) => error.code === 'SPORTSBOOK_SESSION_NOT_FOUND'
    );
  });

  // ── 4. The URL proxy is gone ──────────────────────────────────────────

  await t.test('there is no endpoint that fetches a caller-supplied URL', () => {
    /**
     * `GET /sportsbooks/launch?url=…` fetched whatever it was given and
     * returned the body — cloud metadata, anything bound to localhost, any
     * internal service. The test is structural because the fix is structural:
     * the capability does not exist.
     */
    const userRoutes = require('../routes/user.routes');
    const publicRoutes = require('../routes/public.routes');
    const service = new SportsbookService({ models, logger, config: {}, provider: null });

    for (const factory of [userRoutes, publicRoutes]) {
      const router = factory({ models, logger, config: { RATE_LIMIT_ENABLED: false }, provider: service.provider });
      const paths = router.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
      assert.ok(!paths.includes('/launch'), 'no /launch route');
    }

    assert.strictEqual(typeof service.launch, 'undefined', 'and no service method behind one');
  });

  // ── Session hygiene ───────────────────────────────────────────────────

  await t.test('a second session on the same book is refused while one is open', async () => {
    const userId = await makePlayer();
    const { client } = makeProvider();
    const service = build(client);

    await service.init({ userId, sportsbookUuid: BOOK, currency: 'USDT' });

    await assert.rejects(
      () => service.init({ userId, sportsbookUuid: BOOK, currency: 'USDT' }),
      (error) => error.code === 'SPORTSBOOK_SESSION_ALREADY_OPEN'
    );
  });

  await t.test('an abandoned session expires so the player is not locked out forever', async () => {
    const userId = await makePlayer();
    const { client } = makeProvider();
    const service = build(client);

    const stale = await service.init({ userId, sportsbookUuid: BOOK, currency: 'USDT' });

    // The unique partial index would otherwise make a crashed browser a
    // permanent lockout from that book.
    const later = new Date(Date.now() + SESSION_TTL_MS + 60_000);
    const fresh = await service.init({ userId, sportsbookUuid: BOOK, currency: 'USDT', now: later });

    assert.notStrictEqual(fresh.sessionId, stale.sessionId);

    const old = await models.SportsbookSession.findOne({ where: { session_id: stale.sessionId } });
    assert.strictEqual(old.status, SESSION_STATUS.CLOSED);
  });

  await t.test('a failed init does not strand an open session', async () => {
    const userId = await makePlayer();
    const service = build(makeProvider({ fail: 500 }).client);

    await assert.rejects(
      () => service.init({ userId, sportsbookUuid: BOOK, currency: 'USDT' }),
      (error) => error.code === 'SPORTSBOOK_UPSTREAM_FAILED'
    );

    const open = await models.SportsbookSession.count({
      where: { user_id: userId, status: SESSION_STATUS.OPEN },
    });
    assert.strictEqual(open, 0, 'the row is closed, so the player can retry at once');
  });

  await t.test('the session row is written before the provider is called', async () => {
    /**
     * Order matters: if the provider opened a session and we then failed to
     * record it, the player would have a live real-money session upstream that
     * we cannot see or close. Writing first inverts the failure into a row with
     * no session, which the sweep cleans up.
     *
     * Proved by a provider that fails — a row must still exist, closed.
     */
    const userId = await makePlayer();
    const service = build(makeProvider({ fail: 500 }).client);

    await assert.rejects(() => service.init({ userId, sportsbookUuid: BOOK, currency: 'USDT' }));

    const rows = await models.SportsbookSession.findAll({ where: { user_id: userId } });
    assert.strictEqual(rows.length, 1, 'the row was written before the call that failed');
    assert.strictEqual(rows[0].status, SESSION_STATUS.CLOSED);
  });

  // ── Guards ────────────────────────────────────────────────────────────

  await t.test('a locked account cannot open a session', async () => {
    const userId = await makePlayer({ casino_locked: true });
    const service = build(makeProvider().client);

    await assert.rejects(
      () => service.init({ userId, sportsbookUuid: BOOK, currency: 'USDT' }),
      (error) => error.code === 'SPORTSBOOK_SPORTSBOOK_LOCKED'
    );
  });

  await t.test('an unconfigured integration refuses rather than signing with nothing', async () => {
    const service = build(
      new SlotegratorClient({ baseUrl: '', merchantId: '', merchantKey: '', logger, fetchImpl: async () => {} })
    );

    await assert.rejects(
      () => service.list(),
      (error) => error.code === 'SPORTSBOOK_NOT_CONFIGURED'
    );
  });

  await t.test('an unsupported currency is refused before any upstream call', async () => {
    const userId = await makePlayer();
    const { client, calls } = makeProvider();
    const service = build(client);

    await assert.rejects(
      () => service.init({ userId, sportsbookUuid: BOOK, currency: 'GBP' }),
      (error) => error.code === 'SPORTSBOOK_UNSUPPORTED_CURRENCY'
    );
    assert.strictEqual(calls.length, 0);
  });

  // ── Reads ─────────────────────────────────────────────────────────────

  await t.test('the book list is cached, because the provider rate-limits us', async () => {
    const { client, calls } = makeProvider({ reply: { items: [{ uuid: BOOK }] } });
    const service = build(client);

    const first = await service.list({ now: 1000 });
    const second = await service.list({ now: 2000 });

    assert.deepStrictEqual(first, second);
    assert.strictEqual(calls.length, 1, 'one upstream call for two reads');
  });

  await t.test('the session list never returns the token or the launch URL', async () => {
    const userId = await makePlayer();
    const service = build(makeProvider().client);
    await service.init({ userId, sportsbookUuid: BOOK, currency: 'USDT' });

    const [session] = await service.sessions({ userId });

    /**
     * Both are bearer credentials for the session — on some books the token
     * rides in the launch URL's query string, so returning the URL returns the
     * token.
     */
    assert.ok(!('token' in session));
    assert.ok(!('launch_url' in session));
    assert.strictEqual(session.status, SESSION_STATUS.OPEN);
  });
});
