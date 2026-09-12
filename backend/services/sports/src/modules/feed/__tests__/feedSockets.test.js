'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createLogger } = require('@ibitplay/common');
const { EVENTS, AUDIENCE } = require('@ibitplay/socket');

const feedSockets = require('../sockets');
const { parseOrigins } = require('../../../sockets');

/**
 * `C.SPORT_GAME` — the one socket event the sports service owns.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * IT POINTED AT LOCALHOST
 *
 *     // url: `http://api.b365api.com/v3/events/inplay?&token=${TOKEN}&sport_id=${sportId}`,
 *     url: `http://localhost/inplay_event.json`,
 *
 * The provider URL is commented out and the live code fetches a JSON file from
 * port 80 of the API server itself. No such file exists in the repository and
 * no route serves one, so this returned whatever the web server answers for a
 * missing path — an HTML 404 body, handed to the client as a fixture list.
 *
 * And the sport id came from a `switch` with five cases and NO DEFAULT, so
 * anything else left `sportId` undefined and built the URL with it anyway.
 * ═════════════════════════════════════════════════════════════════════════
 */

const logger = createLogger({ name: 'feed-sockets-test', level: 'silent' });

/** A feed client that records what it was asked, and answers with fixtures. */
function makeFeed(rows) {
  const calls = [];
  return {
    calls,
    async get(path) {
      calls.push(path);
      return rows;
    },
  };
}

const MATCHES = [
  { id: '1', name: 'Soccer', matches: [] },
  { id: '18', name: 'Basketball', matches: [] },
];

/**
 * `SportsConfig` is the operator's enable/disable list — the feed filters every
 * board through it, so a sport an operator turned off is not offered. Legacy's
 * socket path had no such filter: it went straight to the provider.
 */
const models = {
  SportsConfig: {
    async findAll() {
      return MATCHES.map((m) => ({ game_id: m.id }));
    },
  },
};

test('sport events over the socket', async (t) => {
  const register = (deps) => {
    const registered = new Map();
    feedSockets.register({ on: (event, spec) => registered.set(event, spec), deps });
    return registered.get(EVENTS.SPORT_GAME);
  };

  await t.test('the handler builds its service the way the transport will', () => {
    /**
     * THE BUG THIS TEST EXISTS FOR.
     *
     * The first version of `sockets.js` did `new FeedService(deps)`. The
     * container carries no `feed` client — the HTTP router constructs one from
     * config — so `this.feed` was undefined and every `SPORT_GAME` answered
     * `SOCKET_HANDLER_FAILED` on a `TypeError`, while the identical HTTP route
     * worked.
     *
     * The tests below inject a stubbed `feed`, so they could never have caught
     * it. This one goes through the REAL factory with only what the container
     * actually provides, which is the thing that was wrong.
     */
    const { buildFeedService } = require('../feed.factory');

    const service = buildFeedService({
      models,
      logger,
      config: {
        SPORTS_FEED_URL: 'https://feed.test/api',
        SPORTS_FEED_KEY: 'k',
      },
    });

    assert.ok(service.feed, 'the odds client is constructed');
    assert.strictEqual(typeof service.feed.get, 'function');
    // The two secondary providers are unset here, and that is not fatal.
    assert.strictEqual(service.live, null);
    assert.strictEqual(service.media, null);
  });

  await t.test('a fixture list is public, by declaration', () => {
    const handler = register({ models, feed: makeFeed(MATCHES), logger, config: {} });

    /**
     * Legacy's handler had no `if (!id) return;` — one of the nineteen
     * unguarded ones. That is DEFENSIBLE here: a fixture list names no player
     * and moves no money, and a visitor deciding whether to sign up is exactly
     * who reads it. The difference is that it is now a decision.
     */
    assert.strictEqual(handler.audience, AUDIENCE.PUBLIC);
    // Each miss is an upstream call against a rate-limited provider.
    assert.ok(handler.limit.max <= 60);
  });

  await t.test('no game means the whole board rather than sport_id=undefined', async () => {
    const feed = makeFeed(MATCHES);
    const handler = register({ models, feed, logger, config: {} });

    const result = await handler.handle({});

    assert.strictEqual(result.status, true);
    assert.strictEqual(result.game, null);
    // `switch (game) { ...five cases... }` with no default left `sportId`
    // undefined and interpolated it into the URL regardless.
    assert.ok(Array.isArray(result.events));
  });

  await t.test('an unknown sport is refused, not requested', async () => {
    const feed = makeFeed(MATCHES);
    const handler = register({ models, feed, logger, config: {} });

    const result = await handler.handle({ game: 'quidditch' });

    assert.strictEqual(result.status, false);
    assert.strictEqual(result.error.code, 'FEED_GAME_NOT_FOUND');
  });

  await t.test('the feed client is the one the HTTP routes use', async () => {
    const feed = makeFeed(MATCHES);
    const handler = register({ models, feed, logger, config: {} });

    await handler.handle({ game: '1' });

    /**
     * One provider client, one cache, one place the upstream URL is
     * configured — rather than the socket path having its own hardcoded URL,
     * which is how legacy ended up pointing at localhost in one place and at
     * b365api in a comment.
     */
    assert.deepStrictEqual(feed.calls, ['/inplay']);
  });
});

test('the sports socket transport', async (t) => {
  await t.test('the origin allowlist accepts the array the config provides', () => {
    /**
     * `SOCKET_ALLOWED_ORIGINS` is a `coercers.list`, so it arrives ALREADY
     * split. It was read by three transports before it was declared in any
     * config shape — and `loadEnv` parses through a zod object, which strips
     * unknown keys, so every allowlist was empty and no browser could connect.
     */
    assert.deepStrictEqual(parseOrigins(['https://a.test', ' https://b.test ']), [
      'https://a.test',
      'https://b.test',
    ]);
    assert.deepStrictEqual(parseOrigins('https://a.test, https://b.test'), [
      'https://a.test',
      'https://b.test',
    ]);
  });

  await t.test('an unset value allows nothing, which fails visibly', () => {
    // Legacy hardcoded eight origins mid-file and then only consulted the list
    // when `config.developer` was true, so production accepted every origin.
    assert.deepStrictEqual(parseOrigins(undefined), []);
    assert.deepStrictEqual(parseOrigins(''), []);
  });
});
