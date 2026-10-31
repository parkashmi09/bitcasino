'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { NotificationsService } = require('../notifications.service');
const v = require('../notifications.validators');

/**
 * Push notifications.
 *
 * `POST /firebase/send-bulk` had no middleware and reached every registered
 * device on the platform. Five of the seven routes also never worked, because
 * `user_notifications` was created by nothing.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

const STAFF_ID = 790_000 + (process.pid % 1000);
let nextUid = 780_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

let seq = 0;
const newToken = () => `fcm-token-${process.pid}-${(seq += 1)}-${'x'.repeat(20)}`;

test('admin notifications', async (t) => {
  const logger = createLogger({ name: 'notifications-test', level: 'silent' });

  // ══════════════════════════════════════════════════════════════════════
  //  The schemas — no database needed
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a broadcast takes no recipient list', async () => {
    // It reaches the caller's tree by definition. Legacy reached everyone, from
    // a route with no authentication.
    const ok = { title: 'Maintenance tonight' };
    assert.equal(v.broadcast.body.safeParse(ok).success, true);
    assert.equal(v.broadcast.body.safeParse({ ...ok, userIds: [1, 2] }).success, false);
    assert.equal(v.broadcast.body.safeParse({ ...ok, tokens: ['x'] }).success, false);
  });

  await t.test('registering a device cannot name the player', async () => {
    // Legacy took `userId` from the body, so anyone could register their device
    // against anyone's account and receive that player's notifications.
    const ok = { token: 'a'.repeat(30) };
    assert.equal(v.registerDevice.body.safeParse(ok).success, true);
    assert.equal(v.registerDevice.body.safeParse({ ...ok, userId: 5 }).success, false);
  });

  await t.test('the message is bounded', async () => {
    // It renders on a lock screen, and legacy accepted whatever arrived.
    const body = (title) => v.broadcast.body.safeParse({ title });
    assert.equal(body('a'.repeat(200)).success, true);
    assert.equal(body('a'.repeat(201)).success, false);
    assert.equal(body('').success, false);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Against a real database
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
      service: 'admin-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  t.after(async () => {
    if (connection) await connection.close();
  });

  /** A transport that records what it was asked to send. */
  const makePush = ({ dead = [] } = {}) => {
    const sent = [];
    return {
      sent,
      async sendMulticast({ tokens, notification, data }) {
        sent.push({ tokens, notification, data });
        return {
          successCount: tokens.filter((tk) => !dead.includes(tk)).length,
          responses: tokens.map((tk) =>
            dead.includes(tk)
              ? { error: { code: 'messaging/registration-token-not-registered' } }
              : { success: true }
          ),
        };
      },
    };
  };

  const build = (push) =>
    new NotificationsService({
      models: connection.models,
      db: connection,
      logger,
      config: { SERVICE_NAME: 'admin-service' },
      push,
    });

  const roleId = 9600 + (process.pid % 100);

  const seedStaff = async () => {
    await connection.sequelize.query(
      `INSERT INTO roles (id, name, level) VALUES (:roleId, :name, 3) ON CONFLICT (id) DO NOTHING`,
      { replacements: { roleId, name: `notif-role-${roleId}` } }
    );
    await connection.sequelize.query(
      `INSERT INTO staff (id, name, email, password, role_id)
       VALUES (:id, :name, :email, 'x', :roleId) ON CONFLICT (id) DO NOTHING`,
      {
        replacements: {
          id: STAFF_ID, name: `notif-staff-${STAFF_ID}`,
          email: `notif-${STAFF_ID}@test.invalid`, roleId,
        },
      }
    );
    await connection.models.StaffHierarchy.findOrCreate({
      where: { ancestor_id: STAFF_ID, descendant_id: STAFF_ID },
      defaults: { ancestor_id: STAFF_ID, descendant_id: STAFF_ID, depth: 0 },
    });
    await connection.sequelize.query(
      `SELECT setval('staff_id_seq', GREATEST((SELECT MAX(id) FROM staff), 1))`
    );
  };

  const seedPlayer = async (uid, { staffId = STAFF_ID, tokens = 1 } = {}) => {
    await seedStaff();
    await connection.models.UserNotifications.destroy({ where: { user_id: uid } });
    await connection.models.UserFcmToken.destroy({ where: { user_id: uid } });
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({
      id: uid, name: `notif-${uid}`, password: 'x', status: 'active', parent_staff_id: staffId,
    });

    const created = [];
    for (let i = 0; i < tokens; i += 1) {
      const token = newToken();
      await connection.models.UserFcmToken.create({
        user_id: uid, token, platform: 'android', is_active: true,
        created_at: new Date(), updated_at: new Date(),
      });
      created.push(token);
    }
    return created;
  };

  const staff = { id: STAFF_ID };

  await t.test('a send records the notification AND pushes it', async () => {
    // Five routes over `user_notifications` returned "relation does not exist"
    // for the life of the platform — the table was created by nothing.
    const uid = newUid();
    await seedPlayer(uid);
    const push = makePush();

    const result = await build(push).sendToUser({
      staff, userId: uid, title: 'Deposit received', body: 'Your 500 has landed', type: 'deposit',
    });

    assert.equal(result.recorded, 1);
    assert.equal(result.delivered, 1);
    assert.equal(push.sent.length, 1);
    assert.equal(push.sent[0].notification.title, 'Deposit received');

    const rows = await connection.models.UserNotifications.findAll({ where: { user_id: uid }, raw: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].delivered, true);
  });

  await t.test('a player with no device still gets a record', async () => {
    // The push cannot land, but the history is what support reads.
    const uid = newUid();
    await seedPlayer(uid, { tokens: 0 });

    const result = await build(makePush()).sendToUser({ staff, userId: uid, title: 'Hello' });

    assert.equal(result.recorded, 1);
    assert.equal(result.devices, 0);
    assert.equal(result.delivered, 0);
  });

  await t.test('a broadcast reaches only the caller’s tree', async () => {
    /**
     * Legacy's `send-bulk` had no middleware and no scoping — every registered
     * device on the platform, from a request anyone could make.
     */
    const mine = newUid();
    const theirs = newUid();
    await seedPlayer(mine);

    // A player under nobody, which a non-owner tree must not include.
    await connection.models.UserFcmToken.destroy({ where: { user_id: theirs } });
    await connection.models.Users.destroy({ where: { id: theirs } });
    await connection.models.Users.create({
      id: theirs, name: `notif-out-${theirs}`, password: 'x', status: 'active', parent_staff_id: null,
    });
    await connection.models.UserFcmToken.create({
      user_id: theirs, token: newToken(), platform: 'ios', is_active: true,
      created_at: new Date(), updated_at: new Date(),
    });

    const result = await build(makePush()).broadcast({ staff, title: 'Maintenance tonight' });

    const reached = await connection.models.UserNotifications.count({ where: { user_id: theirs } });
    assert.equal(reached, 0, 'a player outside the tree must not be reached');
    assert.ok(result.players >= 1);
  });

  await t.test('a player outside the tree cannot be sent to directly', async () => {
    const uid = newUid();
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({
      id: uid, name: `notif-x-${uid}`, password: 'x', status: 'active', parent_staff_id: null,
    });

    await assert.rejects(
      () => build(makePush()).sendToUser({ staff, userId: uid, title: 'Hello' }),
      (err) => err.code === 'NOTIFICATIONS_NOT_IN_YOUR_TREE' && err.status === 404
    );
  });

  await t.test('a dead token is deactivated, not retried forever', async () => {
    // Firebase reports `registration-token-not-registered` for a device that
    // uninstalled. Legacy never read the per-token results, so every future
    // broadcast paid for them again.
    const uid = newUid();
    const [good, bad] = await seedPlayer(uid, { tokens: 2 });
    const push = makePush({ dead: [bad] });

    await build(push).sendToUser({ staff, userId: uid, title: 'Hello' });

    const rows = await connection.models.UserFcmToken.findAll({ where: { user_id: uid }, raw: true });
    const byToken = new Map(rows.map((r) => [r.token, r]));
    assert.equal(byToken.get(good).is_active, true);
    assert.equal(byToken.get(bad).is_active, false);
  });

  await t.test('a device listing masks the token', async () => {
    /**
     * `GET /allToken` returned every token on the platform. A push token is a
     * capability — whoever holds it can send to that device through Firebase
     * directly, without this API.
     */
    const uid = newUid();
    const [token] = await seedPlayer(uid);

    const list = await build(makePush()).listDevices({ staff, userId: uid });
    assert.equal(list.rows.length, 1);
    assert.notEqual(list.rows[0].token, token);
    assert.match(list.rows[0].token, /…/);
  });

  await t.test('a device listing names its owner', async () => {
    /**
     * A bare `user_id` is unreadable in the one place this list is used. The
     * admin panel searches and sorts on `name`/`email`, so their absence is
     * what a row looks like when the panel shows blanks.
     */
    const uid = newUid();
    await seedPlayer(uid);

    const list = await build(makePush()).listDevices({ staff, userId: uid });
    assert.equal(list.rows[0].name, `notif-${uid}`);
    // `Users.email` is nullable, so the key must exist even when the value
    // does not — `undefined` and `null` read differently on the wire.
    assert.ok('email' in list.rows[0]);
  });

  await t.test('marking read records WHEN, and only once', async () => {
    // Legacy stored `is_read` as a bare boolean, so "when did they see it" had
    // no answer.
    const uid = newUid();
    await seedPlayer(uid);
    const service = build(makePush());

    await service.sendToUser({ staff, userId: uid, title: 'One' });
    const first = await service.markRead({ userId: uid });
    assert.equal(first.marked, 1);

    const row = await connection.models.UserNotifications.findOne({ where: { user_id: uid }, raw: true });
    const readAt = row.read_at;
    assert.ok(readAt);

    // A second call must not move the timestamp.
    const second = await service.markRead({ userId: uid });
    assert.equal(second.marked, 0);
    const again = await connection.models.UserNotifications.findOne({ where: { user_id: uid }, raw: true });
    assert.equal(new Date(again.read_at).getTime(), new Date(readAt).getTime());
  });

  await t.test('the unread count follows', async () => {
    const uid = newUid();
    await seedPlayer(uid);
    const service = build(makePush());

    await service.sendToUser({ staff, userId: uid, title: 'One' });
    await service.sendToUser({ staff, userId: uid, title: 'Two' });
    assert.equal((await service.unreadCount({ userId: uid })).unread, 2);

    await service.markRead({ userId: uid });
    assert.equal((await service.unreadCount({ userId: uid })).unread, 0);
  });

  await t.test('a re-registered token moves to the new owner rather than duplicating', async () => {
    // A shared phone, or a reinstall. Two rows would mean the previous owner
    // keeps receiving the new owner's notifications.
    const first = newUid();
    const second = newUid();
    const [token] = await seedPlayer(first);
    await seedPlayer(second, { tokens: 0 });

    await build(makePush()).registerDevice({ userId: second, token, platform: 'android' });

    const rows = await connection.models.UserFcmToken.findAll({ where: { token }, raw: true });
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].user_id), second);
  });

  await t.test('with no transport configured, the notification is still recorded', async () => {
    // A deployment without the Firebase credential should keep a history
    // rather than fail at boot or silently do nothing.
    const uid = newUid();
    await seedPlayer(uid);

    const result = await build(null).sendToUser({ staff, userId: uid, title: 'Recorded only' });

    assert.equal(result.recorded, 1);
    assert.equal(result.delivered, 0);
    const rows = await connection.models.UserNotifications.findAll({ where: { user_id: uid }, raw: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].delivered, false);
  });
});
