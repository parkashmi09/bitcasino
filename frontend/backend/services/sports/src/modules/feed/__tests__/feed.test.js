'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { FeedClient } = require('../feedClient');
const { FeedService } = require('../feed.service');
const v = require('../feed.validators');

/**
 * The odds feed.
 *
 * Two things are being defended here. One is the transport: match results
 * arrived over `http://46.202.164.63:6565/api` — cleartext, to a bare IP — so
 * anyone on the network path could decide who won. The other is the fancy
 * filter, which has never run because its table did not exist.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

/**
 * The client tests below are about CLIENT MECHANICS — where the credential
 * goes, what the cache keys on, what a timeout produces — and those are the
 * same whichever provider is behind the url. `scoreswift` is the passthrough
 * dialect, so one logical call is one upstream request and the assertions can
 * name a single `calls[0]`.
 *
 * ── AND IT HAS TO BE SAID OUT LOUD ──────────────────────────────────────
 *
 * It was omitted, and `FeedClient` defaults to `diamond`. Under that dialect
 * `/inplay` fans out across nineteen sports and `/highlighthomePrivate` is an
 * upstream path rather than a logical call, so twelve tests here stopped
 * testing anything the day the dialect layer landed — including the two that
 * cover the credential. They failed with `FEED_CAPABILITY_MISSING` and
 * `19 == 1`, which reads as a broken feed rather than a stale test.
 *
 * The diamond block at the end of this file covers what the dialect itself
 * changes, since diamond is what production runs.
 */
const baseConfig = {
  SERVICE_NAME: 'sports-service',
  SPORTS_FEED_URL: 'https://feed.test/api',
  SPORTS_FEED_KEY: 'feed-key',
  SPORTS_FEED_TIMEOUT_MS: 500,
  SPORTS_FEED_DIALECT: 'scoreswift',
};

test('sports feed', async (t) => {
  const logger = createLogger({ name: 'feed-test', level: 'silent' });

  // ══════════════════════════════════════════════════════════════════════
  //  The client — no database needed
  // ══════════════════════════════════════════════════════════════════════

  /** A fetch that records what it was asked for and answers with `body`. */
  const stubFetch = (body, { status = 200 } = {}) => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(typeof body === 'function' ? body(url) : body),
      };
    };
    return { fetchImpl, calls };
  };

  await t.test('a plain-http feed url is refused at construction', async () => {
    /**
     * The legacy base url. Odds, in-play scores and match RESULTS travelled
     * over it in cleartext with no certificate to validate — an attacker on the
     * path rewrites a result and decides who won.
     *
     * At CONSTRUCTION, not per request: a misconfigured deployment must fail at
     * boot, not on the first bet.
     */
    assert.throws(
      () => new FeedClient({ config: { ...baseConfig, SPORTS_FEED_URL: 'http://46.202.164.63:6565/api' }, logger }),
      /plain http/i
    );
  });

  await t.test('plain http is allowed only when somebody opts in explicitly', async () => {
    const client = new FeedClient({
      config: {
        ...baseConfig,
        SPORTS_FEED_URL: 'http://46.202.164.63:6565/api',
        SPORTS_FEED_ALLOW_INSECURE: true,
      },
      logger,
    });
    assert.equal(client.baseUrl, 'http://46.202.164.63:6565/api');
  });

  await t.test('a missing key stops the service — there is no fallback', async () => {
    // Legacy: `process.env.SCORESWIFT_KEY || 'bit_wyusjkwiyu'`. A deployment
    // that forgot the variable worked anyway, using the committed key.
    assert.throws(
      () => new FeedClient({ config: { ...baseConfig, SPORTS_FEED_KEY: '' }, logger }),
      /SPORTS_FEED_KEY is required/
    );
  });

  await t.test('the key goes where THIS provider expects it', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * THIS TEST USED TO ASSERT AN `X-ScoreSwift-Key` HEADER, AND IT WAS WRONG
     *
     * The client was first written against ScoreSwift
     * (`legacy/sportsapi/`, `http://46.202.164.63:6565/api`), which does take
     * that header — and the header was hardcoded, so every provider got one.
     *
     * The provider this platform actually runs on (`legacy/sportsmain/`, the
     * diamond feed) authenticates with a `key=` QUERY PARAMETER and ignores
     * headers. Every call therefore arrived anonymous and the feed answered
     * 404 — which surfaced as `FEED_UPSTREAM_ERROR` on every board.
     *
     * A hardcoded credential mechanism is the same class of bug as a hardcoded
     * credential: it is right until there are two providers.
     * ═══════════════════════════════════════════════════════════════════
     */
    const { fetchImpl, calls } = stubFetch([]);
    const client = new FeedClient({ config: baseConfig, logger, fetchImpl });

    await client.get('/highlighthomePrivate', { etid: 4 });

    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('key'), 'feed-key');
    assert.equal(url.searchParams.get('etid'), '4');
    assert.ok(!calls[0].init.headers['X-ScoreSwift-Key'], 'no ScoreSwift header for a query-key provider');
  });

  await t.test('a caller cannot displace the credential with its own `key`', async () => {
    // The credential is applied AFTER the caller's parameters, so a query
    // named `key` cannot overwrite it — accidentally or otherwise.
    const { fetchImpl, calls } = stubFetch([]);
    const client = new FeedClient({ config: baseConfig, logger, fetchImpl });

    await client.get('/highlighthomePrivate', { key: 'attacker-chosen', etid: 4 });

    assert.equal(new URL(calls[0].url).searchParams.get('key'), 'feed-key');
  });

  await t.test('a header-auth provider still sends a header and keeps the url clean', async () => {
    /**
     * The other mode still works, and is still the better one — a query-string
     * key lands in access logs, proxy logs and `Referer` headers along the way.
     * That is the provider's choice, not ours.
     */
    const { AUTH } = require('../feedClient');
    const { fetchImpl, calls } = stubFetch([]);
    const client = new FeedClient({ config: baseConfig, logger, fetchImpl });
    client.auth = AUTH.HEADER('X-ScoreSwift-Key');

    await client.get('/inplay');

    assert.equal(calls[0].init.headers['X-ScoreSwift-Key'], 'feed-key');
    assert.ok(!calls[0].url.includes('feed-key'), 'the key must not appear in the url');
  });

  await t.test('a burst for one url makes ONE upstream call', async () => {
    // Five legacy endpoints each fetched `/home` fresh per request, and one
    // handler fetched it twice by itself.
    const { fetchImpl, calls } = stubFetch([{ id: '4' }]);
    const client = new FeedClient({ config: baseConfig, logger, fetchImpl });

    await Promise.all([client.get('/home'), client.get('/home'), client.get('/home')]);
    assert.equal(calls.length, 1);

    // And a later call inside the TTL is served from the cache.
    await client.get('/home');
    assert.equal(calls.length, 1);
  });

  await t.test('different query parameters are different cache entries', async () => {
    const { fetchImpl, calls } = stubFetch({ ok: true });
    const client = new FeedClient({ config: baseConfig, logger, fetchImpl });

    await client.get('/GetMarketOdds', { market_id: '1' });
    await client.get('/GetMarketOdds', { market_id: '2' });
    assert.equal(calls.length, 2);

    // Parameter ORDER is not a difference — the key is sorted.
    await client.get('/GetMarketIdsV1', { a: '1', b: '2' });
    await client.get('/GetMarketIdsV1', { b: '2', a: '1' });
    assert.equal(calls.length, 3);
  });

  await t.test('a hung provider produces a 504, not a hang', async () => {
    // Thirteen of the fourteen legacy upstream calls set no timeout at all.
    const fetchImpl = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });

    const client = new FeedClient({ config: { ...baseConfig, SPORTS_FEED_TIMEOUT_MS: 30 }, logger, fetchImpl });

    await assert.rejects(
      () => client.get('/inplay'),
      (err) => err.code === 'FEED_UNREACHABLE' && err.status === 504
    );
  });

  await t.test('a non-2xx from the provider is a 502, not a cached empty board', async () => {
    const { fetchImpl } = stubFetch({}, { status: 500 });
    const client = new FeedClient({ config: baseConfig, logger, fetchImpl });

    await assert.rejects(
      () => client.get('/inplay'),
      (err) => err.code === 'FEED_UPSTREAM_ERROR' && err.status === 502
    );
  });

  await t.test('a failed fetch is not cached', async () => {
    let attempt = 0;
    const fetchImpl = async () => {
      attempt += 1;
      if (attempt === 1) return { ok: false, status: 502, text: async () => '' };
      return { ok: true, status: 200, text: async () => JSON.stringify([{ id: '4' }]) };
    };
    const client = new FeedClient({ config: baseConfig, logger, fetchImpl });

    await assert.rejects(() => client.get('/inplay'));
    const second = await client.get('/inplay');
    assert.deepEqual(second, [{ id: '4' }]);
  });

  await t.test('provider ids that could rewrite the upstream query are refused', async () => {
    // Every one of these lands in a URL sent to the provider.
    const parse = (id) => v.byMarket.query.safeParse({ marketId: id });
    assert.equal(parse('1.234567').success, true);
    assert.equal(parse('abc-DEF_12').success, true);
    assert.equal(parse('1&key=stolen').success, false);
    assert.equal(parse('1#frag').success, false);
    assert.equal(parse('../result/event-result').success, false);
  });

  await t.test('an unknown date range is refused, not treated as "no filter"', async () => {
    // Legacy's `getRange` returned null for anything it did not recognise and
    // the caller read null as "no filter" — so `/matches-by-date/yesterday`
    // answered 200 with the entire board.
    assert.equal(v.byDate.params.safeParse({ dateType: 'today' }).success, true);
    assert.equal(v.byDate.params.safeParse({ dateType: 'tomorrow' }).success, true);
    assert.equal(v.byDate.params.safeParse({ dateType: 'yesterday' }).success, false);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The diamond dialect — what PRODUCTION runs
  // ══════════════════════════════════════════════════════════════════════

  /**
   * `SPORTS_FEED_DIALECT` is unset in every deployment so far, and
   * `FeedClient` falls back to `diamond`. Everything above deliberately opts
   * out of it to test the client rather than the translation; these three
   * pin the translation itself.
   */
  const diamondConfig = { ...baseConfig, SPORTS_FEED_DIALECT: 'diamond' };

  await t.test('diamond drops a caller-supplied `key` before the url is built', async () => {
    /**
     * The SECOND credential guard, and the stronger one.
     *
     * Above, the url builder appends the real key last so a caller's `key`
     * cannot win. Here the dialect never forwards it at all — it names the
     * parameters this provider takes, and `key` is not one of them. Two
     * independent reasons an attacker-chosen credential cannot reach the
     * feed, which is what you want on the parameter that authenticates you.
     */
    const { fetchImpl, calls } = stubFetch([]);
    const client = new FeedClient({ config: diamondConfig, logger, fetchImpl });

    await client.get('/GetLineMarket', { key: 'attacker-chosen', etid: 4 });

    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get('key'), 'feed-key');
    assert.equal(url.searchParams.get('etid'), '4');
  });

  await t.test('a whole-board read fans out across the configured sports', async () => {
    /**
     * The diamond feed serves one sport per request, so `/inplay` is N calls,
     * not one. A test that assumes otherwise reports a working feed as broken
     * — which is exactly what happened to `a burst for one url` above.
     */
    const { fetchImpl, calls } = stubFetch([]);
    const client = new FeedClient({ config: diamondConfig, logger, fetchImpl });

    await client.get('/inplay');

    assert.ok(calls.length > 1, `expected a fan-out, got ${calls.length} call(s)`);
    for (const call of calls) {
      assert.ok(call.url.includes('/highlighthomePrivate'), 'every leg hits the one endpoint');
      assert.equal(new URL(call.url).searchParams.get('key'), 'feed-key', 'every leg carries the credential');
    }
  });

  await t.test('a capability this provider lacks is a named 501, not an empty board', async () => {
    /**
     * The failure mode this dialect exists to prevent: returning `[]` for
     * something the provider cannot serve looks like a quiet day, forever.
     */
    const { fetchImpl, calls } = stubFetch([]);
    const client = new FeedClient({ config: diamondConfig, logger, fetchImpl });

    await assert.rejects(
      () => client.get('/GetResult', { etid: 4 }),
      (err) => err.code === 'FEED_CAPABILITY_MISSING' && err.status === 501
    );
    assert.equal(calls.length, 0, 'and it does not call upstream to find out');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The service — against a real database
  // ══════════════════════════════════════════════════════════════════════

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
      service: 'sports-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  t.after(async () => {
    if (connection) await connection.close();
  });

  const build = (body) => {
    const { fetchImpl, calls } = stubFetch(body);
    const feed = new FeedClient({ config: baseConfig, logger, fetchImpl });
    const service = new FeedService({ models: connection.models, feed, logger, config: baseConfig });
    return { service, calls };
  };

  /** A sport that is on the board, and one that is not. */
  const seedSports = async () => {
    await connection.models.SportsConfig.destroy({ where: { game_id: ['4', '2'] } });
    await connection.models.SportsConfig.create({ game_id: '4', game_name: 'Cricket', enabled: true });
    await connection.models.SportsConfig.create({ game_id: '2', game_name: 'Tennis', enabled: false });
  };

  await t.test('a disabled sport does not reach the player', async () => {
    await seedSports();
    const { service } = build([{ id: 4, name: 'Cricket' }, { id: 2, name: 'Tennis' }]);

    const games = await service.allInplay();
    assert.equal(games.length, 1);
    assert.equal(String(games[0].id), '4');
  });

  await t.test('the sport id is compared as text, not as a number', async () => {
    // The provider sends ids as numbers in some payloads and strings in others,
    // and `sports_config.game_id` is text. The legacy filter did `.toString()`
    // on both sides for exactly this reason.
    await seedSports();
    const { service } = build([{ id: '4', name: 'Cricket' }]);
    assert.equal((await service.allInplay()).length, 1);
  });

  await t.test('a closed fancy market is filtered out of the feed response', async () => {
    /**
     * THE FILTER THIS TEST COVERS HAS NEVER RUN IN PRODUCTION.
     *
     * `admin_fancy_control` was not in the schema and no migration created it,
     * so the five endpoints that maintain it returned "relation does not
     * exist" and there was nothing to filter against. Every fancy market the
     * provider sent reached the player — including the ones somebody had
     * explicitly tried to close.
     */
    const eventId = `evt-${process.pid}`;
    await connection.models.AdminFancyControl.destroy({ where: { event_id: eventId } });
    await connection.models.AdminFancyControl.create({
      event_id: eventId,
      market_id: `${eventId}-closed`,
      market_name: 'Closed session',
      show_fancy: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    const { service } = build({
      data: [
        { marketId: `${eventId}-open`, name: 'Open session' },
        { marketId: `${eventId}-closed`, name: 'Closed session' },
      ],
    });

    const result = await service.bookmakerFancy({ eventId });
    assert.equal(result.data.length, 1);
    assert.equal(result.data[0].marketId, `${eventId}-open`);
  });

  await t.test('an event with nothing closed passes through untouched', async () => {
    const eventId = `evt-none-${process.pid}`;
    await connection.models.AdminFancyControl.destroy({ where: { event_id: eventId } });

    const payload = { data: [{ marketId: 'a' }, { marketId: 'b' }] };
    const { service } = build(payload);

    const result = await service.bookmakerFancy({ eventId });
    assert.deepEqual(result, payload);
  });

  await t.test('a fancy control for ANOTHER event does not hide this one', async () => {
    const mine = `evt-mine-${process.pid}`;
    const theirs = `evt-theirs-${process.pid}`;
    await connection.models.AdminFancyControl.destroy({ where: { event_id: [mine, theirs] } });
    await connection.models.AdminFancyControl.create({
      event_id: theirs, market_id: `${theirs}-m`, show_fancy: false,
      created_at: new Date(), updated_at: new Date(),
    });

    const { service } = build({ data: [{ marketId: `${theirs}-m` }] });
    const result = await service.bookmakerFancy({ eventId: mine });
    assert.equal(result.data.length, 1, 'the control belongs to a different event');
  });

  await t.test('a sport nobody has configured is a 404, not an empty 200', async () => {
    await seedSports();
    const { service } = build([{ id: 4 }]);

    await assert.rejects(
      () => service.inplayByGame({ gameId: '999999' }),
      (err) => err.code === 'FEED_GAME_NOT_FOUND' && err.status === 404
    );
  });

  await t.test('the fixture list is fetched ONCE for a date-and-game query', async () => {
    // Legacy's `getMatchesByDateGame` called `/home` twice in one handler.
    await seedSports();
    const { service, calls } = build([
      { id: 4, markets: [{ marketStartTime: new Date().toISOString() }] },
    ]);

    await service.matchesByDateAndGame({ dateType: 'today', gameId: '4' });
    assert.equal(calls.length, 1);
  });
});
