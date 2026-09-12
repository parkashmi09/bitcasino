'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const { LITERAL_EVENTS, AUDIENCE } = require('@ibitplay/socket');

const { PreferencesService } = require('../preferences.service');
const { DEFAULTS } = require('../preferences.constants');
const preferenceSockets = require('../sockets');

/**
 * Player settings.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * Both legacy socket events took the player id from the client's message:
 *
 *     socket.on("identify", async (raw) => {
 *       const uid = Number(raw);          // the only validation
 *       socket.join(ROOM.u(uid));
 *       socket.emit("userConfigUpdated", await userModel.get(uid));
 *     });
 *
 *     socket.on('subscribeUserConfig', id => socket.join(ROOM.u(id)));
 *
 * The tests below are about what the ported events CANNOT be asked to do.
 * ═════════════════════════════════════════════════════════════════════════
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 900_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('preferences', async (t) => {
  const logger = createLogger({ name: 'prefs-test', level: 'silent' });

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
      service: 'user-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const { models } = connection;
  const users = [];

  t.after(async () => {
    if (users.length) {
      await models.Userconfig.destroy({ where: { uid: users } });
      await models.Users.destroy({ where: { id: users } });
    }
  });
  t.after(async () => {
    if (connection) await connection.close();
  });

  const service = new PreferencesService({ models, logger });

  const seed = async () => {
    const id = newUid();
    users.push(id);
    await models.Users.create({ id, name: `pf${id}`, password: 'x', status: 'active' });
    return id;
  };

  // ── Defaults ──────────────────────────────────────────────────────────

  await t.test('a player who has never saved a setting gets real defaults', async () => {
    const userId = await seed();

    /**
     * Legacy's fallback was `rows[0] || { uid: uid, /* Add default user config
     * values here *\/ }` — the comment IS the implementation, so every client
     * read `undefined` and invented its own fallback.
     */
    const config = await service.get({ userId });

    assert.strictEqual(config.theme, DEFAULTS.theme);
    assert.strictEqual(config.language, DEFAULTS.language);
    assert.strictEqual(config.emailNotifications, DEFAULTS.emailNotifications);
    assert.strictEqual(config.hideBalance, DEFAULTS.hideBalance);
  });

  await t.test('the provably-fair seeds are never in the payload', async () => {
    const userId = await seed();
    await models.Userconfig.upsert({ uid: userId, theme: 'light', fair_server_seed: 'SECRET-SEED' });

    const config = await service.get({ userId });

    /**
     * Those columns were added to `userconfig` by THIS port, so legacy's
     * `SELECT *` never returned them — it would now. The server seed of an
     * unrevealed round is the one value that must stay secret: knowing it means
     * knowing the outcome in advance.
     */
    assert.ok(!('fair_server_seed' in config));
    assert.ok(!('fairServerSeed' in config));
    assert.ok(!JSON.stringify(config).includes('SECRET-SEED'));
  });

  // ── Updates ───────────────────────────────────────────────────────────

  await t.test('settings are created on first save and read back', async () => {
    const userId = await seed();

    // Legacy's UPDATE matched no row for a player who had never saved, and
    // returned `rows[0]` — undefined — as the new config.
    const saved = await service.update({ userId, theme: 'light', language: 'hi' });

    assert.strictEqual(saved.theme, 'light');
    assert.strictEqual(saved.language, 'hi');
    assert.strictEqual((await service.get({ userId })).theme, 'light');
  });

  await t.test('only the named fields change', async () => {
    const userId = await seed();
    await service.update({ userId, theme: 'light', hideBalance: true });

    const after = await service.update({ userId, language: 'pt' });

    assert.strictEqual(after.language, 'pt');
    assert.strictEqual(after.theme, 'light', 'untouched');
    assert.strictEqual(after.hideBalance, true, 'untouched');
  });

  await t.test('an unknown theme or language is refused', async () => {
    const userId = await seed();

    // Legacy stored whatever string arrived, so the column holds values no
    // client has a translation for.
    await assert.rejects(
      () => service.update({ userId, theme: 'neon' }),
      (error) => error.code === 'PREFERENCES_UNKNOWN_THEME'
    );
    await assert.rejects(
      () => service.update({ userId, language: 'xx' }),
      (error) => error.code === 'PREFERENCES_UNKNOWN_LANGUAGE'
    );
  });

  await t.test('an empty update is a 400, not a broken SQL statement', async () => {
    const userId = await seed();

    /**
     * `buildUpdate({})` produced an empty SET clause, so legacy's
     * `UPDATE userconfig SET , updatedat=now()` was a syntax error returned
     * as a 500.
     */
    await assert.rejects(
      () => service.update({ userId }),
      (error) => error.code === 'PREFERENCES_NOTHING_TO_UPDATE'
    );
  });

  await t.test('a field the shape does not name cannot reach a column', async () => {
    const userId = await seed();

    /**
     * Legacy's `buildUpdate(f)` assembled the SET clause from the KEYS of
     * whatever object it was handed and interpolated the result — one careless
     * call site from column-name injection. The service takes named parameters,
     * so an extra key is simply not read.
     */
    await assert.rejects(
      () => service.update({ userId, fair_server_seed: 'attacker-chosen' }),
      (error) => error.code === 'PREFERENCES_NOTHING_TO_UPDATE'
    );

    const row = await models.Userconfig.findOne({ where: { uid: userId }, raw: true });
    assert.notStrictEqual(row?.fair_server_seed, 'attacker-chosen');
  });

  // ── The socket surface ────────────────────────────────────────────────

  await t.test('identify takes no player id, and the preview is staff-only', () => {
    const registered = new Map();
    preferenceSockets.register({
      on: (event, spec) => registered.set(event, spec),
      deps: { models, logger },
    });

    /**
     * The structural half of the fix. `identify`'s uid parameter WAS the
     * vulnerability — it made you whichever player you named, for the life of
     * the connection.
     */
    assert.strictEqual(registered.get(LITERAL_EVENTS.IDENTIFY).audience, AUDIENCE.USER);

    /**
     * And `subscribeUserConfig` — one line with no check at all, whose own
     * comment calls it an "admin preview" — now requires an operator.
     */
    assert.strictEqual(
      registered.get(LITERAL_EVENTS.SUBSCRIBE_USER_CONFIG).audience,
      AUDIENCE.STAFF
    );
  });

  await t.test('identify reads the connection’s own player, not the payload', async () => {
    const mine = await seed();
    const theirs = await seed();
    await service.update({ userId: theirs, theme: 'light' });

    const registered = new Map();
    preferenceSockets.register({
      on: (event, spec) => registered.set(event, spec),
      deps: { models, logger },
    });

    const joined = [];
    const context = {
      userId: mine,
      socket: { join: (room) => joined.push(room), emit: () => {} },
    };

    // The payload names the OTHER player. Legacy would have returned their
    // config and joined their room.
    const result = await registered.get(LITERAL_EVENTS.IDENTIFY).handle({ uid: theirs }, context);

    assert.strictEqual(result.config.uid, String(mine));
    assert.deepStrictEqual(joined, [`room:user:${mine}`]);
  });
});
