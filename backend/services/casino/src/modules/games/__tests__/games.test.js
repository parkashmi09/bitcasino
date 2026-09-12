'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { GamesService } = require('../games.service');

/**
 * The game catalogue.
 *
 * Each of these is a legacy behaviour written down as the thing it did wrong —
 * a duplicated game, an unverified uuid, an image URL that is not a URL.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

// Namespaced per process so concurrent runs never collide on a uuid.
const TAG = `t${process.pid % 100000}`;
let nextGame = 0;
const newUuid = () => `${TAG}-game-${(nextGame += 1)}`;

test('game catalogue', async (t) => {
  const logger = createLogger({ name: 'games-test', level: 'silent' });

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

  /** An upstream provider verifying a transaction password, for the one route that needs it. */
  const adminClient = {
    calls: [],
    async post(path, body) {
      adminClient.calls.push({ path, body });
      if (body.transactionPassword !== 'correct-horse') {
        const err = new Error('Invalid transaction password');
        err.status = 403;
        throw err;
      }
      return { staffId: body.staffId, verified: true };
    },
  };

  const service = new GamesService({
    models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'casino-service' },
    clients: { admin: adminClient },
  });

  const staff = { id: 1 };

  /** Put a game in the catalogue and hand back its uuid. */
  const seedGame = async (attrs = {}) => {
    const uuid = attrs.uuid || newUuid();
    await models.Gisgamesnew.destroy({ where: { uuid } });
    await models.Gisgamesnew.create({
      uuid,
      name: attrs.name || `Game ${uuid}`,
      provider: attrs.provider || `${TAG}-Evolution`,
      type: attrs.type || 'slots',
      is_mobile: attrs.is_mobile ?? false,
      has_lobby: attrs.has_lobby ?? false,
      has_freespins: attrs.has_freespins ?? false,
      technology: attrs.technology || 'html5',
    });
    return uuid;
  };

  // ══════════════════════════════════════════════════════════════════════
  //  Browsing
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a provider filter matches regardless of case', async () => {
    const provider = `${TAG}-PragmaticPlay`;
    await seedGame({ provider });

    const result = await service.browse({ page: 1, limit: 10, provider: provider.toLowerCase() });
    assert.equal(result.total, 1, 'a vendor stored capitalised must match a lowercase filter');
  });

  await t.test('is_mobile sorts, it does not filter', async () => {
    // Legacy had this both ways in two branches of the same function. The sort
    // is what shipped, and a player filtering "mobile" still expects to be able
    // to scroll to the rest.
    const provider = `${TAG}-MobileSort`;
    await seedGame({ provider, name: 'AAA desktop', is_mobile: false });
    await seedGame({ provider, name: 'ZZZ mobile', is_mobile: true });

    const result = await service.browse({ page: 1, limit: 10, provider, is_mobile: true });

    assert.equal(result.total, 2, 'both games are still in the result set');
    assert.equal(result.rows[0].name, 'ZZZ mobile', 'the mobile one floats despite sorting last by name');
  });

  await t.test('a prioritized game appears ONCE, not on page 1 and again later', async () => {
    // The bug: the priority overlay ran only for page 1, and later pages were a
    // plain `ORDER BY name` with no exclusion — so a promoted game showed at the
    // top of page 1 and again in its alphabetical position further in.
    const provider = `${TAG}-Duplicates`;
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
    const uuids = [];
    for (const name of names) uuids.push(await seedGame({ provider, name }));

    // Promote the LAST one alphabetically, so a duplicate would be obvious.
    const promoted = uuids[3];
    await service.setVendorPriority({ vendor: provider, uuids: [promoted], actor: staff });

    const page1 = await service.browse({ page: 1, limit: 2, provider });
    const page2 = await service.browse({ page: 2, limit: 2, provider });

    assert.equal(page1.prioritizedApplied, true);
    assert.equal(page1.rows[0].uuid, promoted, 'the promoted game leads');

    const seen = [...page1.rows, ...page2.rows].map((g) => g.uuid);
    assert.equal(new Set(seen).size, seen.length, 'no game appears on two pages');
    assert.equal(seen.length, 4, 'and every game is reachable across the pages');
  });

  await t.test('a priority entry hidden by a filter does not hold a slot', async () => {
    const provider = `${TAG}-FilteredPriority`;
    const html5 = await seedGame({ provider, name: 'Kept', technology: 'html5' });
    const flash = await seedGame({ provider, name: 'Hidden', technology: 'flash' });

    await service.setVendorPriority({ vendor: provider, uuids: [flash, html5], actor: staff });

    const result = await service.browse({ page: 1, limit: 10, provider, technology: 'html5' });
    assert.deepEqual(result.rows.map((g) => g.uuid), [html5]);
  });

  await t.test('browsing by provider reports a real 404 rather than throwing', async () => {
    // `GET /gamesgis/provider/:provider` called a bare `getGamesgis(...)`, which
    // is a property of the exported object and not a binding in scope. Every
    // request was a ReferenceError.
    await assert.rejects(
      () => service.browseByProvider({ provider: `${TAG}-nobody-has-this`, page: 1, limit: 10 }),
      (err) => err.code === 'GAMES_PROVIDER_NOT_FOUND' && err.status === 404
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Collections
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a collection keeps the order it was curated in', async () => {
    const a = await seedGame({ name: 'Zulu' });
    const b = await seedGame({ name: 'Alpha' });
    const c = await seedGame({ name: 'Mike' });

    await service.setCollection({ collection: 'hot', uuids: [a, b, c], actor: staff });

    const result = await service.collection({ collection: 'hot', page: 1, limit: 10 });
    assert.deepEqual(result.rows.map((g) => g.uuid), [a, b, c], 'curated order, not alphabetical');
  });

  await t.test('a uuid that is not a game is refused, not silently dropped', async () => {
    // Legacy stored whatever it was handed and the JOIN that read it back
    // dropped the ones that did not exist — the list looked saved and came back
    // short with nothing to explain it.
    const real = await seedGame();

    await assert.rejects(
      () => service.setCollection({ collection: 'hot', uuids: [real, 'not-a-game'], actor: staff }),
      (err) => err.code === 'GAMES_UNKNOWN_GAMES' && err.details?.unknown?.includes('not-a-game')
    );
  });

  await t.test('a repeated uuid is stored once', async () => {
    const uuid = await seedGame();
    const result = await service.setCollection({ collection: 'crash', uuids: [uuid, uuid, uuid], actor: staff });
    assert.deepEqual(result.uuids, [uuid]);
  });

  await t.test('an unknown collection is a 404, not a query against a table named by the caller', async () => {
    await assert.rejects(
      () => service.collection({ collection: 'jackpots', page: 1, limit: 10 }),
      (err) => err.code === 'GAMES_UNKNOWN_COLLECTION'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Priority lists
  // ══════════════════════════════════════════════════════════════════════

  await t.test('two simultaneous saves of the same vendor leave ONE row', async () => {
    // Legacy ran `UPDATE ... WHERE LOWER(vendor) = LOWER($1)` and inserted when
    // it touched zero rows. Both requests updated nothing and both inserted, and
    // from then on which list applied was decided by `ORDER BY updated_at DESC`.
    const vendor = `${TAG}-Race`;
    const a = await seedGame({ provider: vendor });
    const b = await seedGame({ provider: vendor });

    await Promise.allSettled([
      service.setVendorPriority({ vendor, uuids: [a], actor: staff }),
      service.setVendorPriority({ vendor, uuids: [b], actor: staff }),
    ]);

    const rows = await models.GisPrioritizedGames.findAll({ where: { vendor }, raw: true });
    assert.equal(rows.length, 1, 'the unique key decides, not the application');
  });

  await t.test('a vendor saved capitalised is found by a lowercase lookup', async () => {
    const vendor = `${TAG}-CaseVendor`;
    const uuid = await seedGame({ provider: vendor });

    await service.setVendorPriority({ vendor, uuids: [uuid], actor: staff });

    const read = await service.vendorPriority({ vendor: vendor.toUpperCase() });
    assert.deepEqual(read.games.map((g) => g.uuid), [uuid]);
  });

  await t.test('a type priority is matched with surrounding whitespace trimmed', async () => {
    const type = `${TAG}-live`;
    const uuid = await seedGame({ type });

    await service.setTypePriority({ type: `  ${type}  `, uuids: [uuid], actor: staff });

    const read = await service.typePriority({ type });
    assert.deepEqual(read.games.map((g) => g.uuid), [uuid]);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Search
  // ══════════════════════════════════════════════════════════════════════

  await t.test('an exact name outranks a prefix, and a prefix outranks a substring', async () => {
    const provider = `${TAG}-Ranking`;
    await seedGame({ provider, name: `${TAG}zeus of olympus` });
    await seedGame({ provider, name: `gates of ${TAG}zeus` });
    await seedGame({ provider, name: `${TAG}zeus` });

    const rows = await service.searchWithinVendor({ vendor: provider, q: `${TAG}zeus`, limit: 10 });

    assert.equal(rows[0].name, `${TAG}zeus`, 'exact first');
    assert.equal(rows[1].name, `${TAG}zeus of olympus`, 'then prefix');
    assert.equal(rows[2].name, `gates of ${TAG}zeus`, 'then anywhere');
  });

  await t.test('an empty search returns nothing rather than the whole catalogue', async () => {
    assert.deepEqual(await service.search({ q: '   ', limit: 10 }), []);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Editing
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a game image must be an absolute http(s) URL', async () => {
    // Rendered in every player's lobby. Legacy accepted any non-empty string.
    const uuid = await seedGame();

    for (const image of ['javascript:alert(1)', 'data:text/html;base64,PHN2Zz4=', '/relative.png', 'evil.com/x.png']) {
      await assert.rejects(
        () => service.updateImage({ uuid, image, actor: staff }),
        (err) => err.code === 'GAMES_IMAGE_URL_INVALID',
        `${image} must be refused`
      );
    }

    const ok = await service.updateImage({ uuid, image: 'https://cdn.example.com/a.png', actor: staff });
    assert.equal(ok.image, 'https://cdn.example.com/a.png');
  });

  await t.test('editing the image of a game that does not exist is a 404', async () => {
    await assert.rejects(
      () => service.updateImage({ uuid: 'no-such-game', image: 'https://x.test/a.png', actor: staff }),
      (err) => err.code === 'GAMES_NOT_FOUND'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Providers
  // ══════════════════════════════════════════════════════════════════════

  await t.test('toggling providers needs the transaction password, and it is checked upstream', async () => {
    const name = `${TAG}-Toggle`;
    await models.GisProvidersNew.destroy({ where: { name } });
    await models.GisProvidersNew.create({ name, enabled: true });

    await assert.rejects(
      () =>
        service.setUpstreamProviders({
          updates: [{ name, enabled: false }],
          transactionPassword: 'wrong',
          actor: staff,
        }),
      (err) => err.status === 403
    );

    const untouched = await models.GisProvidersNew.findOne({ where: { name }, raw: true });
    assert.equal(untouched.enabled, true, 'a refused second factor must not have changed anything');

    await service.setUpstreamProviders({
      updates: [{ name, enabled: false }],
      transactionPassword: 'correct-horse',
      actor: staff,
    });

    const after = await models.GisProvidersNew.findOne({ where: { name }, raw: true });
    assert.equal(after.enabled, false);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Recently played
  // ══════════════════════════════════════════════════════════════════════

  await t.test('recently played is capped and newest-first', async () => {
    const userId = 940_000_000 + (process.pid % 100_000);
    await models.GisRecentlyPlayed.destroy({ where: { user_id: userId } });

    const uuids = [];
    for (let i = 0; i < 18; i += 1) uuids.push(await seedGame());

    for (const [index, uuid] of uuids.entries()) {
      await service.recordPlay({ userId, gameUuid: uuid });

      /**
       * Backdate each play to a distinct moment, immediately, so the NEXT
       * call's trim has an unambiguous "oldest" to drop. Without this every row
       * lands in the same millisecond and which three get trimmed is arbitrary
       * — the assertion below would then be testing the database's row order.
       *
       * The offsets run backwards from now so the row just written stays the
       * newest, which is what a real sequence of plays looks like.
       */
      await models.GisRecentlyPlayed.update(
        { played_at: new Date(Date.now() - (uuids.length - index) * 1000) },
        { where: { user_id: userId, game_uuid: uuid } }
      );
    }

    const rows = await service.recentlyPlayed({ userId, limit: 50 });
    assert.equal(rows.length, 15, 'the cap holds even when asked for more');
    assert.equal(rows[0].game_uuid, uuids[17], 'newest first');
  });

  await t.test('replaying a game moves it up rather than adding a second row', async () => {
    const userId = 941_000_000 + (process.pid % 100_000);
    await models.GisRecentlyPlayed.destroy({ where: { user_id: userId } });

    const uuid = await seedGame();
    await service.recordPlay({ userId, gameUuid: uuid });
    await service.recordPlay({ userId, gameUuid: uuid });

    assert.equal(await models.GisRecentlyPlayed.count({ where: { user_id: userId } }), 1);
  });
});
