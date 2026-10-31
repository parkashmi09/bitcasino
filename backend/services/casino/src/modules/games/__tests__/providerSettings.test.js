'use strict';

// These cases exercise the SEPARATE transaction password (`staff.transaction_password`);
// login mode (the default) is covered in staff-auth/__tests__/txnPasswordMode.test.js.
process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { GamesService } = require('../games.service');
const { requireGameEntitled } = require('../gameEntitlement');
const migration = require('../../../../../../packages/db/migrations/067-casino-provider-settings');

/**
 * The site admin's provider switch and logos (migration 067).
 *
 * The flag it replaces in practice — `gis_providers_new.enabled` — was written
 * by the admin and read by nothing, so "switched off" meant "still in the
 * lobby". Each test here is a place the lobby or a launch could leak a
 * switched-off provider back to a player.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

// Namespaced per process so concurrent runs never collide on a provider or uuid.
const TAG = `p${process.pid % 100000}`;
let nextGame = 0;

/** Smallest thing the sniffer accepts as a PNG: the 8-byte signature, padded past MIN_UPLOAD_BYTES. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120)]);
const SVG = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script>${' '.repeat(80)}</svg>`);

test('lobby provider settings', async (t) => {
  const logger = createLogger({ name: 'provider-settings-test', level: 'silent' });

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

  // The table, whether or not the test database has been migrated this far.
  // `up` is idempotent, so a migrated database is untouched.
  await migration.up({ sequelize: connection.sequelize, logger });

  const service = new GamesService({
    models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'casino-service' },
    clients: {},
  });
  const staff = { id: 7 };

  const player = 942_000_000 + (process.pid % 100_000);
  const on = `${TAG}-alpha`;
  const off = `${TAG}-bravo`;

  const seedGame = async (provider, name) => {
    const uuid = `${TAG}-g${(nextGame += 1)}`;
    await models.Gisgamesnew.create({ uuid, name: name ?? `${TAG} Game ${nextGame}`, provider, type: 'slots' });
    return uuid;
  };

  const cleanUp = async () => {
    await models.Gisgamesnew.destroy({ where: { provider: [on, off] } });
    await models.GisProviders.destroy({ where: { name: [on, off] } });
    await models.CasinoProviderSetting.destroy({ where: { provider: [on, off] } });
    await models.GisProvidersNew.destroy({ where: { name: [on, off] } });
    await models.UserFavouriteGames.destroy({ where: { user_id: player } });
    await models.GisRecentlyPlayed.destroy({ where: { user_id: player } });
  };

  await cleanUp();
  t.after(async () => {
    await cleanUp();
    if (connection) await connection.close();
  });

  await models.GisProviders.bulkCreate([{ name: on }, { name: off }]);
  const onGame = await seedGame(on, `${TAG} Shared Name One`);
  const offGame = await seedGame(off, `${TAG} Shared Name Two`);

  // ══════════════════════════════════════════════════════════════════════
  //  The switch
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a provider nobody has touched is on, with no logo', async () => {
    const list = await service.providerSettingsList();
    const row = list.find((p) => p.key === on);
    assert.ok(row, 'every lobby provider is listed, settings row or not');
    assert.equal(row.enabled, true);
    assert.equal(row.hasLogo, false);
    assert.equal(row.games, 1, 'the game count comes from the catalogue');
  });

  await t.test('switching a provider off takes it out of the public providers list', async () => {
    const result = await service.updateProviderSetting({ name: off, enabled: false, actor: staff });
    assert.equal(result.enabled, false);
    assert.equal(result.updatedBy, '7', 'who switched it is recorded');

    const { rows } = await service.listProviders({ search: TAG });
    const names = rows.map((r) => r.name);
    assert.ok(names.includes(on));
    assert.ok(!names.includes(off), 'a switched-off provider is not offered to players');
    assert.ok('logoUrl' in rows[0] && 'displayName' in rows[0], 'the new fields are always present');
  });

  await t.test('its games leave the lobby, the search and the stats', async () => {
    const all = await service.browse({ page: 1, limit: 50, search: TAG });
    assert.deepEqual(all.rows.map((r) => r.uuid), [onGame], 'browse keeps only the enabled provider');

    const filtered = await service.browse({ page: 1, limit: 50, provider: off });
    assert.equal(filtered.total, 0, 'filtering by the disabled provider by name does not bring it back');

    const found = await service.search({ q: `${TAG} Shared`, limit: 10 });
    assert.deepEqual(found.map((r) => r.uuid), [onGame], 'the lobby search leaves it out');

    const adminFound = await service.search({ q: `${TAG} Shared`, limit: 10, includeDisabled: true });
    assert.equal(adminFound.length, 2, 'the admin search still sees it, to curate it while it is off');

    const stats = await service.stats();
    assert.ok(!stats.topProviders.some((p) => p.provider === off));
  });

  await t.test('its game screen and provider page say it is not available', async () => {
    await assert.rejects(() => service.byUuid(offGame), (err) => err.code === 'GAMES_PROVIDER_DISABLED');
    await assert.rejects(
      () => service.browseByProvider({ provider: off, page: 1, limit: 10 }),
      (err) => err.code === 'GAMES_PROVIDER_DISABLED'
    );
    assert.equal((await service.byUuid(onGame)).uuid, onGame, 'the enabled provider is untouched');
  });

  await t.test('a launch of its game is refused before any upstream call', async () => {
    const guard = requireGameEntitled({ models, config: {} }, (req) => ({ uid: req.body.gameUid }));
    const run = (gameUid) =>
      new Promise((resolve) => {
        guard({ body: { gameUid } }, {}, (err) => resolve(err ?? null));
      });

    const refused = await run(offGame);
    assert.equal(refused?.code, 'GAMES_PROVIDER_DISABLED');
    assert.equal(refused?.status, 403);
    assert.equal(await run(onGame), null, 'a game of an enabled provider passes');
  });

  await t.test("its games leave the player's favourites and recently played, and come back with it", async () => {
    const unknownRef = `${TAG}-not-in-any-catalogue`;
    for (const uuid of [onGame, offGame]) {
      await service.addFavourite({ userId: player, gameRef: uuid, source: 'aggregator' });
      await service.recordPlay({ userId: player, gameUuid: uuid });
    }
    await service.addFavourite({ userId: player, gameRef: unknownRef, source: 'slug' });

    const favourites = async () => (await service.favourites({ userId: player, limit: 50 })).map((r) => r.game_ref);
    const recent = async () => (await service.recentlyPlayed({ userId: player, limit: 15 })).map((r) => r.game_uuid);

    let favs = await favourites();
    assert.ok(favs.includes(onGame));
    assert.ok(!favs.includes(offGame), 'a switched-off provider is not in Favourites');
    assert.ok(favs.includes(unknownRef), 'an unresolved reference has no provider to judge, so it stays');
    assert.deepEqual(await recent(), [onGame], 'nor in Recently played');
    assert.equal(
      await models.UserFavouriteGames.count({ where: { user_id: player, game_ref: offGame } }),
      1,
      'hidden, not deleted'
    );

    await service.updateProviderSetting({ name: off, enabled: true, actor: staff });
    favs = await favourites();
    assert.ok(favs.includes(offGame), 'switched back on, the star is back');
    assert.equal((await recent()).length, 2);
    await service.updateProviderSetting({ name: off, enabled: false, actor: staff });
  });

  await t.test('switching it back on restores everything', async () => {
    await service.updateProviderSetting({ name: off, enabled: true, actor: staff });
    const all = await service.browse({ page: 1, limit: 50, search: TAG });
    assert.equal(all.total, 2);
    assert.equal((await service.byUuid(offGame)).uuid, offGame);
  });

  await t.test('a provider the catalogue does not know cannot be given a row', async () => {
    await assert.rejects(
      () => service.updateProviderSetting({ name: `${TAG}-nobody`, enabled: false, actor: staff }),
      (err) => err.code === 'GAMES_PROVIDER_NOT_FOUND'
    );
    assert.equal(await models.CasinoProviderSetting.count({ where: { provider: `${TAG}-nobody` } }), 0);
  });

  await t.test('display name and order are set, and an empty name clears it', async () => {
    let row = await service.updateProviderSetting({ name: on, displayName: 'Alpha Gaming', sortOrder: 1, actor: staff });
    assert.equal(row.displayName, 'Alpha Gaming');
    assert.equal(row.sortOrder, 1);

    row = await service.updateProviderSetting({ name: on, displayName: '', actor: staff });
    assert.equal(row.displayName, null);
    assert.equal(row.sortOrder, 1, 'a PATCH changes only what it names');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Logos
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a PNG is stored, typed by its bytes, and served at a versioned URL', async () => {
    const row = await service.putProviderLogo({
      name: on,
      file: { buffer: PNG, mimetype: 'image/jpeg', originalname: 'logo.jpg' },
      actor: staff,
    });
    assert.equal(row.hasLogo, true);
    assert.equal(row.logoContentType, 'image/png', 'the sniffed type, not the declared one');
    assert.match(row.logoUrl, new RegExp(`/api/v1/casino/games/providers/${on}/logo\\?v=\\d+$`));

    const { rows } = await service.listProviders({ search: on });
    assert.equal(rows[0].logoUrl, row.logoUrl, 'the public list carries the same URL');

    const image = await service.providerLogo({ name: on });
    assert.ok(image.data.equals(PNG));
  });

  await t.test('replacing the logo changes its URL', async () => {
    const before = (await service.providerSettingsList()).find((p) => p.key === on).logoUrl;
    await new Promise((r) => setTimeout(r, 5));
    const after = await service.putProviderLogo({ name: on, file: { buffer: PNG, originalname: 'b.png' }, actor: staff });
    assert.notEqual(after.logoUrl, before, 'a cached old logo cannot stand in for the new one');
  });

  await t.test('an SVG is refused, and so is anything that is not an image', async () => {
    await assert.rejects(
      () => service.putProviderLogo({ name: on, file: { buffer: SVG, mimetype: 'image/svg+xml', originalname: 'x.svg' }, actor: staff }),
      (err) => err.code === 'GAMES_FORMAT_REFUSED'
    );
    await assert.rejects(
      () => service.putProviderLogo({ name: on, file: { buffer: Buffer.alloc(200, 0x41), mimetype: 'image/png', originalname: 'x.png' }, actor: staff }),
      (err) => err.code === 'GAMES_NOT_AN_IMAGE'
    );
    await assert.rejects(() => service.putProviderLogo({ name: on, file: null, actor: staff }), (err) => err.code === 'GAMES_NO_FILE');
  });

  await t.test('a switched-off provider\'s logo is not public, but the admin can still see it', async () => {
    await service.putProviderLogo({ name: off, file: { buffer: PNG, originalname: 'o.png' }, actor: staff });
    await service.updateProviderSetting({ name: off, enabled: false, actor: staff });

    await assert.rejects(() => service.providerLogo({ name: off }), (err) => err.code === 'GAMES_LOGO_NOT_FOUND');
    const admin = await service.providerLogo({ name: off, includeDisabled: true });
    assert.ok(admin.data.length > 0);
  });

  await t.test('removing a logo falls back to the name', async () => {
    const row = await service.removeProviderLogo({ name: on, actor: staff });
    assert.equal(row.hasLogo, false);
    assert.equal(row.logoUrl, null);
    await assert.rejects(() => service.providerLogo({ name: on }), (err) => err.code === 'GAMES_LOGO_NOT_FOUND');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The upstream providers screen
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the upstream providers screen is the same switch, behind the transaction password', async () => {
    const admin = {
      async post(_path, body) {
        if (body.transactionPassword === 'correct-horse') return { verified: true };
        const err = new Error('Invalid transaction password');
        err.status = 403;
        throw err;
      },
    };
    const upstream = new GamesService({ models, db: connection, logger, config: {}, clients: { admin } });
    // The legacy column says on for both; only the lobby's switch is believed.
    await models.GisProvidersNew.bulkCreate([{ name: on, enabled: true }, { name: off, enabled: true }]);
    await service.updateProviderSetting({ name: on, enabled: true, actor: staff });
    await service.updateProviderSetting({ name: off, enabled: false, actor: staff });

    const read = async () => Object.fromEntries((await upstream.upstreamProviders()).map((p) => [p.name, p.enabled]));
    assert.deepEqual(await read().then((m) => [m[on], m[off]]), [true, false], 'the GET reads Casino → Providers');

    await assert.rejects(
      () => upstream.setUpstreamProviders({ updates: [{ name: on, enabled: false }], transactionPassword: 'x', actor: staff }),
      (err) => err.status === 403
    );
    assert.equal((await read())[on], true, 'a refused second factor changed nothing');

    await upstream.setUpstreamProviders({
      updates: [{ name: on, enabled: false }, { name: off, enabled: true }],
      transactionPassword: 'correct-horse',
      actor: staff,
    });
    const settings = await service.providerSettingsList();
    assert.equal(settings.find((p) => p.key === on).enabled, false, 'the PUT writes Casino → Providers');
    assert.equal(settings.find((p) => p.key === off).enabled, true);
    const all = await service.browse({ page: 1, limit: 50, search: TAG });
    assert.deepEqual(all.rows.map((r) => r.uuid), [offGame], 'and the lobby follows it');
    const legacy = await models.GisProvidersNew.findOne({ where: { name: on }, raw: true });
    assert.equal(legacy.enabled, false, 'the legacy column is kept in step');

    await assert.rejects(
      () =>
        upstream.setUpstreamProviders({
          updates: [{ name: on, enabled: true }, { name: `${TAG}-nobody`, enabled: true }],
          transactionPassword: 'correct-horse',
          actor: staff,
        }),
      (err) => err.code === 'GAMES_PROVIDER_NOT_FOUND'
    );
    assert.equal((await read())[on], false, 'one unknown name refuses the whole batch');
  });
});
