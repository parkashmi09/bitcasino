'use strict';

// These cases exercise the SEPARATE transaction password (`staff.transaction_password`);
// login mode (the default) is covered in staff-auth/__tests__/txnPasswordMode.test.js.
process.env.TXN_PASSWORD_MODE = 'separate';

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
      image: attrs.image ?? null,
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

  await t.test('sort=popular ranks by distinct players, after the curated block and before the rest', async () => {
    const provider = `${TAG}-Popular`;
    const uuids = {};
    for (const name of ['Alpha quiet', 'Bravo busy', 'Charlie single', 'Delta curated']) {
      uuids[name] = await seedGame({ provider, name });
    }
    await service.setVendorPriority({ vendor: provider, uuids: [uuids['Delta curated']], actor: staff });

    // Three players opened "Bravo"; one player opened "Charlie" five times.
    const base = 950_000_000 + (process.pid % 100_000) * 10;
    const launches = [
      ...[0, 1, 2].map((n) => ({ user: base + n, game: uuids['Bravo busy'] })),
      ...[0, 1, 2, 3, 4].map(() => ({ user: base, game: uuids['Charlie single'] })),
    ];
    await models.GameSession.bulkCreate(
      launches.map((l, i) => ({ user_id: l.user, game_uid: l.game, session_token: `${TAG}-pop-${i}` }))
    );

    // A fresh service: the ranking is cached per instance for a minute.
    const fresh = new GamesService({ models, db: connection, logger, config: {}, clients: {} });
    const popular = await fresh.browse({ page: 1, limit: 10, provider, sort: 'popular' }).finally(() =>
      models.GameSession.destroy({ where: { game_uid: Object.values(uuids) } })
    );
    assert.deepEqual(
      popular.rows.map((g) => g.name),
      ['Delta curated', 'Bravo busy', 'Charlie single', 'Alpha quiet'],
      'curated first, then distinct players (not launches), then the unplayed by name'
    );

    const az = await fresh.browse({ page: 1, limit: 10, provider, sort: 'az' });
    assert.deepEqual(az.rows.map((g) => g.name), ['Alpha quiet', 'Bravo busy', 'Charlie single', 'Delta curated']);

    const unsorted = await fresh.browse({ page: 1, limit: 10, provider });
    assert.deepEqual(
      unsorted.rows.map((g) => g.name),
      ['Delta curated', 'Alpha quiet', 'Bravo busy', 'Charlie single'],
      'no sort keeps the curated order, then name'
    );
  });

  await t.test('the lobby order lists games with artwork first, by name, the same on every read', async () => {
    const provider = `${TAG}-Artwork`;
    const art = (n) => `https://cdn.example.com/${n}.png`;
    // Two "Bravo" rows with art: equal names, so the uuid decides and a page edge never moves.
    await seedGame({ uuid: `${TAG}-art-b2`, provider, name: 'Bravo', image: art('b2') });
    await seedGame({ uuid: `${TAG}-art-b1`, provider, name: 'Bravo', image: art('b1') });
    await seedGame({ uuid: `${TAG}-art-a0`, provider, name: 'Alpha bare' });
    await seedGame({ uuid: `${TAG}-art-a1`, provider, name: 'Alpha empty', image: '' });
    await seedGame({ uuid: `${TAG}-art-z1`, provider, name: 'Zulu', image: art('z1') });

    const expected = [`${TAG}-art-b1`, `${TAG}-art-b2`, `${TAG}-art-z1`, `${TAG}-art-a0`, `${TAG}-art-a1`];
    const all = await service.browse({ page: 1, limit: 10, provider });
    assert.deepEqual(all.rows.map((g) => g.uuid), expected, 'art first (by name, then uuid), art-less after');
    assert.equal(all.total, 5, 'an art-less game is still listed');

    const paged = [];
    for (let page = 1; page <= 3; page += 1) {
      paged.push(...(await service.browse({ page, limit: 2, provider })).rows.map((g) => g.uuid));
    }
    assert.deepEqual(paged, expected, 'paging walks the same order, each game once');

    const again = await service.browse({ page: 1, limit: 10, provider });
    assert.deepEqual(again.rows.map((g) => g.uuid), expected, 'deterministic');

    const az = await service.browse({ page: 1, limit: 10, provider, sort: 'az' });
    assert.deepEqual(
      az.rows.map((g) => g.name),
      ['Alpha bare', 'Alpha empty', 'Bravo', 'Bravo', 'Zulu'],
      'a chosen A–Z stays strictly alphabetical'
    );

    // A curated list keeps its order within each half.
    await service.setCollection({
      collection: 'hot',
      uuids: [`${TAG}-art-a0`, `${TAG}-art-z1`, `${TAG}-art-a1`, `${TAG}-art-b2`],
      actor: staff,
    });
    const hot = await service.collection({ collection: 'hot', page: 1, limit: 10 });
    assert.deepEqual(hot.rows.map((g) => g.uuid), [`${TAG}-art-z1`, `${TAG}-art-b2`, `${TAG}-art-a0`, `${TAG}-art-a1`]);

    // So does a vendor's priority block.
    await service.setVendorPriority({ vendor: provider, uuids: [`${TAG}-art-a0`, `${TAG}-art-z1`], actor: staff });
    const prioritized = await service.browse({ page: 1, limit: 10, provider });
    assert.deepEqual(
      prioritized.rows.map((g) => g.uuid),
      [`${TAG}-art-z1`, `${TAG}-art-a0`, `${TAG}-art-b1`, `${TAG}-art-b2`, `${TAG}-art-a1`]
    );
  });

  await t.test('a game listed twice is shown once, and both rows stay readable', async () => {
    const provider = `${TAG}-Twins`;
    const first = await seedGame({ uuid: `${TAG}-twin-a`, provider, name: '777 FRUIT' });
    const second = await seedGame({ uuid: `${TAG}-twin-b`, provider, name: '777 FRUIT' });
    // Same name, a different kind of game: two games, not one twice.
    const other = await seedGame({ uuid: `${TAG}-twin-c`, provider, name: '777 FRUIT', type: 'live' });

    const listed = await service.browse({ page: 1, limit: 10, provider });
    assert.equal(listed.total, 2);
    assert.deepEqual(listed.rows.map((g) => g.uuid).sort(), [first, other].sort(), 'the later twin is hidden');

    const found = await service.search({ q: `${TAG}-twin`, limit: 10 });
    assert.deepEqual(found.map((g) => g.uuid).sort(), [first, other].sort(), 'the lobby search hides it too');

    assert.equal((await service.byUuid(second)).uuid, second, 'a favourite naming the twin still resolves');
  });

  await t.test('two games sharing a slug get distinct slugs, and each slug opens its own game', async () => {
    const provider = `${TAG}-Slugs`;
    // The suffix is the uuid's first eight letters and digits, so these differ there.
    const plain = await seedGame({ uuid: `aa${TAG}-slug`, provider, name: 'DRAGON & TIGER' });
    const later = await seedGame({ uuid: `bb${TAG}-slug`, provider, name: 'DRAGON TIGER', type: 'Multiplayer' });
    const fresh = new GamesService({ models, db: connection, logger, config: {}, clients: {} });

    const base = `dragon-tiger-by-${provider.toLowerCase()}`;
    const rows = (await fresh.browse({ page: 1, limit: 10, provider })).rows;
    const slugOf = (uuid) => rows.find((g) => g.uuid === uuid).slug;
    assert.equal(slugOf(plain), base, 'the earlier uuid keeps the plain slug, so old links still open it');
    const suffix = later.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
    assert.equal(slugOf(later), `${base}-${suffix}`, 'the later one is suffixed from its own uuid');

    assert.equal((await fresh.bySlug(base)).uuid, plain);
    assert.equal((await fresh.bySlug(`${base}-${suffix}`)).uuid, later);
    assert.equal((await fresh.bySlug(`${base}-${suffix}`)).slug, `${base}-${suffix}`, 'the read carries its slug');
    assert.equal((await fresh.byUuid(later)).slug, `${base}-${suffix}`);
    await assert.rejects(() => fresh.bySlug(`${base}-zzzzzzzz`), (err) => err.code === 'GAMES_NOT_FOUND');
  });

  /**
   * The game screen's read. It exists because nothing else could answer it:
   * `browse` pages a filtered list and `search` matches a name, so a page
   * opened from a link had no way to turn the uuid in its URL into a game.
   */
  await t.test('one game is readable by its uuid', async () => {
    const uuid = await seedGame({ name: `${TAG} Reachable`, provider: `${TAG}-Spribe` });

    const row = await service.byUuid(uuid);
    assert.equal(row.uuid, uuid);
    assert.equal(row.name, `${TAG} Reachable`);
    // The screen renders artwork and a provider from this one read — a
    // narrower projection would send it back for a second.
    assert.ok('image' in row && 'provider' in row && 'type' in row, 'the full lobby projection');
  });

  /**
   * The regression that made this route `/detail/:uuid`.
   *
   * A bare `/:uuid` matches any single segment, and the module mounts its
   * public routes ahead of its player routes on the same base — so it also
   * answered `/favourites` and `/recently-played`, both as "Game not found".
   * This pins the shape of the route rather than the mounting, which is the
   * part a future edit could quietly undo.
   */
  await t.test('the by-uuid route cannot shadow the player routes', async () => {
    const routes = require('../routes/public.routes');
    const router = routes({ models, db: connection, logger, config: { SERVICE_NAME: 'casino-service' }, clients: {} });
    const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);

    assert.ok(paths.includes('/detail/:uuid'), 'by-uuid is namespaced');
    assert.ok(!paths.includes('/:uuid'), 'a bare /:uuid would shadow /favourites and /recently-played');
  });

  await t.test('a uuid that names no game is a 404, not an empty object', async () => {
    await assert.rejects(
      () => service.byUuid(`${TAG}-no-such-game`),
      (error) => error.status === 404 && error.code === 'GAMES_NOT_FOUND'
    );
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

  await t.test('a lobby category: created from its name, games picked in order, switched off, deleted', async () => {
    const name = `Cat ${TAG} Games`;
    const created = await service.createCategory({ name, actor: staff });
    assert.equal(created.slug, `cat-${TAG}-games`);
    await assert.rejects(() => service.createCategory({ name, actor: staff }), (err) => err.code === 'GAMES_CATEGORY_EXISTS');
    await assert.rejects(() => service.createCategory({ name: 'Brand', actor: staff }), (err) => err.code === 'GAMES_CATEGORY_EXISTS');

    // Names no other case uses: a same-named game of the same provider is a twin and hidden.
    const [a, b] = [await seedGame({ name: 'Zz category game' }), await seedGame({ name: 'Aa category game' })];
    await service.updateCategory({ slug: created.slug, uuids: [a, b], actor: staff });
    const page = await service.categoryGames({ slug: created.slug, page: 1, limit: 10 });
    assert.deepEqual(page.rows.map((g) => g.uuid), [a, b], 'curated order');
    const az = await service.categoryGames({ slug: created.slug, page: 1, limit: 10, sort: 'az' });
    assert.deepEqual(az.rows.map((g) => g.uuid), [b, a]);
    assert.equal((await service.categories()).find((c) => c.slug === created.slug).count, 2);

    await service.updateCategory({ slug: created.slug, active: false, actor: staff });
    assert.ok(!(await service.categories()).some((c) => c.slug === created.slug), 'the site no longer lists it');
    await assert.rejects(() => service.categoryGames({ slug: created.slug, page: 1, limit: 10 }), (err) => err.code === 'GAMES_UNKNOWN_CATEGORY');
    assert.ok((await service.categories({ includeInactive: true })).some((c) => c.slug === created.slug), 'the admin still does');

    await service.deleteCategory({ slug: created.slug, actor: staff });
    assert.ok(!(await service.categories({ includeInactive: true })).some((c) => c.slug === created.slug));
  });

  await t.test('an uncurated seeded category opens in the admin on the list the site shows', async () => {
    // `hot` (migration 158) has no picks; the site then reads the Hot collection.
    const shown = await seedGame({ name: 'Hh automatic hot game' });
    await service.setCollection({ collection: 'hot', uuids: [shown], actor: staff });
    const admin = await service.categoryGames({ slug: 'hot', page: 1, limit: 10, includeInactive: true, automatic: true });
    assert.deepEqual(admin.rows.map((g) => g.uuid), [shown]);
    const site = await service.categoryGames({ slug: 'hot', page: 1, limit: 10 });
    assert.deepEqual(site.rows, [], 'the public read still answers only picks');
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

  await t.test('an uploaded tile image is stored, served and becomes the game image', async () => {
    const uuid = await seedGame({ name: 'Uu uploaded art game', image: 'https://cdn.example/old.png' });
    // A real PNG head (signature + IHDR 300x400) so the size is read, padded past the minimum.
    const ihdr = Buffer.alloc(25);
    ihdr.writeUInt32BE(13, 0);
    ihdr.write('IHDR', 4);
    ihdr.writeUInt32BE(300, 8);
    ihdr.writeUInt32BE(400, 12);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, Buffer.alloc(200, 1)]);

    const out = await service.putGameImage({ uuid, file: { buffer: png, size: png.length, originalname: 'a.png', mimetype: 'image/png' }, actor: staff });
    assert.match(out.image, /^\/api\/v1\/casino\/games\/image\/[a-z0-9]+\.png\?v=\d+$/);
    const name = out.image.split('/').pop().split('?')[0];
    const served = await service.artwork({ name });
    assert.ok(served.data.equals(png));
    const row = await models.Gisgamesnew.findOne({ where: { uuid }, raw: true });
    assert.equal(row.image, out.image);

    await assert.rejects(
      () => service.putGameImage({ uuid, file: { buffer: Buffer.alloc(300, 0x41), size: 300, originalname: 'x.png' }, actor: staff }),
      (err) => err.code === 'GAMES_NOT_AN_IMAGE'
    );
  });

  await t.test('a vendor with nothing pinned opens on its games in lobby order, pinned first once saved', async () => {
    const vendor = `${TAG}-OpenVendor`;
    const a = await seedGame({ provider: vendor, name: 'Oo first open game' });
    const b = await seedGame({ provider: vendor, name: 'Oo second open game' });

    const before = await service.vendorPriority({ vendor });
    assert.equal(before.pinned, 0);
    assert.deepEqual(new Set(before.games.map((g) => g.uuid)), new Set([a, b]), 'not an empty table');

    await service.setVendorPriority({ vendor, uuids: [b, a], actor: staff });
    const after = await service.vendorPriority({ vendor });
    assert.deepEqual(after.games.map((g) => g.uuid), [b, a]);
    assert.equal(after.pinned, 2);

    // Switched off, it is out of the lobby but the admin still sees and orders its games.
    const c = await seedGame({ provider: vendor, name: 'Oo third open game' });
    await service.updateProviderSetting({ name: vendor, enabled: false, actor: staff });
    const off = await service.vendorPriority({ vendor });
    assert.deepEqual(off.games.map((g) => g.uuid), [b, a, c]);
    await service.updateProviderSetting({ name: vendor, enabled: true, actor: staff });
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

    const key = name.toLowerCase();
    const setting = await models.CasinoProviderSetting.findOne({ where: { provider: key }, raw: true });
    assert.equal(setting?.enabled, false, 'it writes the switch the lobby honours');
    const listed = (await service.upstreamProviders()).find((p) => p.name === name);
    assert.equal(listed.enabled, false, 'and reads it back from there');
    await models.CasinoProviderSetting.destroy({ where: { provider: key } });
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
