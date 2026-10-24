'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');
const { EVENTS, LITERAL_EVENTS, AUDIENCE } = require('@ibitplay/socket');

const { SocialService } = require('../social.service');
const socialSockets = require('../sockets');

/**
 * Chat moderation — the four handlers from `legacy/Admin/index.js`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THEIR AUTHORISATION WAS A FIELD IN THE CLIENT'S OWN MESSAGE
 *
 *     client.on(C.ADMIN_SET_MUTE, (data) => {
 *       let { name, privates } = data;
 *       if (!privates) return;
 *       Rule.changeMute(name, ...)
 *
 * `privates` is destructured out of `data`. Sending `{name, privates: true}`
 * satisfied it. All five handlers in that file use the identical check —
 * including `new_query`, which runs arbitrary SQL and is not ported.
 * ═════════════════════════════════════════════════════════════════════════
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 890_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('chat moderation', async (t) => {
  const logger = createLogger({ name: 'moderation-test', level: 'silent' });

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
      await models.ChatGlobal.destroy({ where: { uid: users } });
      await models.Users.destroy({ where: { id: users } });
    }
  });
  t.after(async () => {
    if (connection) await connection.close();
  });

  const service = new SocialService({
    models,
    db: connection,
    logger,
    config: { AVATAR_BASE_URL: 'https://cdn.test/avatars' },
  });

  const STAFF = { id: 6001, name: 'operator' };

  const seed = async (overrides = {}) => {
    const id = newUid();
    users.push(id);
    await models.Users.create({
      id,
      name: `mod${id}`,
      password: 'x',
      status: 'active',
      level: 1,
      ...overrides,
    });
    return id;
  };

  const nameOf = async (id) => (await models.Users.findByPk(id, { attributes: ['name'], raw: true })).name;

  // ── Mute ──────────────────────────────────────────────────────────────

  await t.test('mute sets, rather than toggling', async () => {
    const userId = await seed();
    const name = await nameOf(userId);

    await service.setMute({ staff: STAFF, name, muted: true });
    assert.strictEqual((await models.Users.findByPk(userId, { raw: true })).muted, true);

    /**
     * Legacy read the current value and flipped it. Asking for "muted" twice
     * left the player UNMUTED — and two operators acting at once on a player
     * they both want silenced achieve nothing.
     */
    await service.setMute({ staff: STAFF, name, muted: true });
    assert.strictEqual((await models.Users.findByPk(userId, { raw: true })).muted, true);

    await service.setMute({ staff: STAFF, name, muted: false });
    assert.strictEqual((await models.Users.findByPk(userId, { raw: true })).muted, false);
  });

  await t.test('an unknown name is a 404, not a crash', async () => {
    /**
     * `UserRule.getUserInfoByName(name, (result, error) => { let id =
     * _.toNumber(result.id); ...` — the `error` parameter is destructured and
     * never read, so an unknown name reaches `.id` on `undefined` and throws
     * inside a pg callback. Unhandled, which takes the process down.
     */
    await assert.rejects(
      () => service.setMute({ staff: STAFF, name: `nobody-${process.pid}`, muted: true }),
      (error) => error.code === 'SOCIAL_PLAYER_NOT_FOUND'
    );
  });

  await t.test('a muted player cannot post', async () => {
    const userId = await seed();
    const name = await nameOf(userId);
    await service.setMute({ staff: STAFF, name, muted: true });

    await assert.rejects(
      () => service.postChat({ userId, room: 'global', message: 'hello' }),
      (error) => error.code === 'SOCIAL_MUTED'
    );
  });

  // ── Avatar ────────────────────────────────────────────────────────────

  await t.test('an avatar is a filename, prefixed by configuration', async () => {
    const userId = await seed();
    const name = await nameOf(userId);

    const result = await service.setAvatar({ staff: STAFF, name, avatar: 'cat.png' });
    assert.strictEqual(result.avatar, 'https://cdn.test/avatars/cat.png');
  });

  await t.test('a traversal or a foreign origin is refused', async () => {
    const userId = await seed();
    const name = await nameOf(userId);

    /**
     * Legacy did `UPLOAD_URL + avatar` with no validation, so all of these
     * survived the concatenation onto a value rendered on every chat message
     * that player sends.
     */
    for (const attack of [
      '../../etc/passwd',
      'https://evil.test/x.png',
      '//evil.test/x.png',
      'a b.png',
      '<script>x</script>',
    ]) {
      await assert.rejects(
        () => service.setAvatar({ staff: STAFF, name, avatar: attack }),
        (error) => error.code === 'SOCIAL_INVALID_AVATAR',
        `"${attack}" must be refused`
      );
    }
  });

  // ── Post-as ───────────────────────────────────────────────────────────

  await t.test('an operator can post as a named player', async () => {
    const userId = await seed();
    const name = await nameOf(userId);

    const posted = await service.postChatAs({ staff: STAFF, name, room: 'global', message: 'house notice' });

    assert.strictEqual(posted.name, name);
    assert.strictEqual(posted.message, 'house notice');

    // Written, not just broadcast. Legacy emitted first and inserted second.
    const rows = await models.ChatGlobal.findAll({ where: { uid: userId }, raw: true });
    assert.strictEqual(rows.length, 1);
  });

  await t.test('posting as an unknown player is a 404', async () => {
    /**
     * `if (results === 'undefined') return;` — a comparison against the STRING
     * `'undefined'`, which is never true for a pg result object. So an unknown
     * player fell through to `results.rows[0].avatar` and threw.
     */
    await assert.rejects(
      () => service.postChatAs({ staff: STAFF, name: `ghost-${process.pid}`, room: 'global', message: 'x' }),
      (error) => error.code === 'SOCIAL_PLAYER_NOT_FOUND'
    );
  });

  await t.test('post-as goes through the same length limit as a player', async () => {
    const userId = await seed();
    const name = await nameOf(userId);

    // Legacy had no limit anywhere on this path.
    await assert.rejects(
      () => service.postChatAs({ staff: STAFF, name, room: 'global', message: 'x'.repeat(50_000) }),
      (error) => error.code === 'SOCIAL_MESSAGE_TOO_LONG'
    );
  });

  await t.test('an unknown room is refused rather than concatenated', async () => {
    const userId = await seed();
    const name = await nameOf(userId);

    await assert.rejects(
      () => service.postChatAs({ staff: STAFF, name, room: 'global; DROP TABLE users', message: 'x' }),
      (error) => error.code === 'SOCIAL_UNKNOWN_ROOM'
    );
  });

  // ── The audience ──────────────────────────────────────────────────────

  await t.test('all four moderation events are staff-only', () => {
    const registered = new Map();
    socialSockets.register({
      on: (event, spec) => registered.set(event, spec),
      deps: { models, db: connection, logger, config: {} },
    });

    /**
     * The structural half. Legacy's check was `if (!privates) return;` on all
     * four — a boolean the caller put in their own message.
     */
    for (const event of [EVENTS.ADMIN_SET_MUTE, EVENTS.ADMIN_ADD_AVATAR, EVENTS.ADMIN_ADD_CHAT]) {
      assert.strictEqual(registered.get(event).audience, AUDIENCE.STAFF, `${event} must be staff-only`);
    }
    assert.strictEqual(registered.get(LITERAL_EVENTS.ADMIN_NOTIFY).audience, AUDIENCE.STAFF);

    // And the player events are still player events.
    assert.strictEqual(registered.get(EVENTS.ADD_CHAT).audience, AUDIENCE.USER);
    assert.strictEqual(registered.get(EVENTS.CHATS).audience, AUDIENCE.PUBLIC);
  });

  await t.test('new_query is not registered at all', () => {
    const registered = new Map();
    socialSockets.register({
      on: (event, spec) => registered.set(event, spec),
      deps: { models, db: connection, logger, config: {} },
    });

    /**
     * `client.on('new_query', ({query, privates}) => { if (!privates) return;
     * Rule.runQuery(query, ...) })` — arbitrary SQL over a socket, authorised
     * by the caller's own boolean. It is the socket twin of `POST /pedramx`,
     * and there is no version of it that is safe.
     */
    assert.ok(!registered.has('new_query'));
    assert.ok(!Object.values(LITERAL_EVENTS).includes('new_query'), 'and it is not even in the event table');
  });

  await t.test('admin_notify preserves the misspelled key clients read', async () => {
    const registered = new Map();
    socialSockets.register({
      on: (event, spec) => registered.set(event, spec),
      deps: { models, db: connection, logger, config: {} },
    });

    let emitted = null;
    const context = {
      staff: STAFF,
      socket: { server: { emit: (_event, payload) => { emitted = payload; } } },
    };

    await registered.get(LITERAL_EVENTS.ADMIN_NOTIFY).handle({ content: 'maintenance at 02:00' }, context);

    /**
     * `io.emit('admin_notify', {mesage: content})` — one `s`. That typo is the
     * wire protocol: shipped clients read `mesage`, so fixing it alone would
     * silence the notice on every existing client.
     */
    const decoded = JSON.parse(Buffer.from(emitted, 'base64').toString('utf8'));
    assert.strictEqual(decoded.mesage, 'maintenance at 02:00');
    assert.strictEqual(decoded.message, 'maintenance at 02:00', 'and the correct spelling alongside');
  });
});
