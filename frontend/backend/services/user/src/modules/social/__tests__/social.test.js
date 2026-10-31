'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { SocialService, parseFriends, roomKey } = require('../social.service');
const { MAX_MESSAGE_LENGTH } = require('../social.constants');

/**
 * Chat, friends and private messages.
 *
 * The one that matters: a message reaches the room only if it reached the
 * table. Legacy broadcast to every connected client and inserted afterwards.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;
let nextId = 500_500_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('friend list parsing', async (t) => {
  await t.test('the trailing comma does not become an empty friend', () => {
    // A new account starts as `"Support,"` and the column grows by
    // concatenation, so every list ends with a separator.
    assert.deepEqual(parseFriends('Support,'), ['Support']);
    assert.deepEqual(parseFriends('a,b,c,'), ['a', 'b', 'c']);
    assert.deepEqual(parseFriends(''), []);
    assert.deepEqual(parseFriends(null), []);
    assert.deepEqual(parseFriends(' a , b '), ['a', 'b']);
  });
});

test('conversation keys', async (t) => {
  await t.test('both directions produce the SAME key', () => {
    /**
     * Otherwise a reply starts a second thread and neither party ever sees the
     * whole conversation.
     */
    assert.equal(roomKey(7, 42), roomKey(42, 7));
  });

  await t.test('sorted numerically, not as strings', () => {
    // `[9, 10].sort()` is `[10, 9]` — string ordering would give two different
    // keys for the same pair depending on who wrote first.
    assert.equal(roomKey(9, 10), roomKey(10, 9));
    assert.equal(roomKey(9, 10), '9:10');
  });
});

test('social against a database', async (t) => {
  const logger = createLogger({ name: 'social-test', level: 'silent' });

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
  const service = new SocialService({ models, db: connection, logger });

  const talker = newId();
  const muted = newId();
  const friend = newId();
  const everyone = [talker, muted, friend];

  t.before(async () => {
    await models.ChatGlobal.destroy({ where: { uid: everyone } });
    await models.Messages.destroy({ where: { from_uid: everyone } });
    await models.Users.destroy({ where: { id: everyone } });

    await models.Users.bulkCreate([
      { id: talker, name: `s${talker}`, password: 'x', status: 'active', friends: 'Support,' },
      { id: muted, name: `s${muted}`, password: 'x', status: 'active', muted: true },
      { id: friend, name: `s${friend}`, password: 'x', status: 'active' },
    ]);
  });

  t.after(async () => {
    await models.ChatGlobal.destroy({ where: { uid: everyone } });
    await models.Messages.destroy({ where: { from_uid: everyone } });
    await models.Users.destroy({ where: { id: everyone } });
    if (connection) await connection.close();
  });

  // ══════════════════════════════════════════════════════════════════════

  await t.test('A MESSAGE IS STORED BEFORE IT IS RETURNED', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * Legacy called back — which the handler turned into `io.emit` to every
     * connected client — and THEN ran the INSERT. A failed insert meant every
     * player had already seen a message that does not exist, and the error
     * path called the callback a SECOND time.
     * ═══════════════════════════════════════════════════════════════════
     */
    const posted = await service.postChat({ userId: talker, room: 'global', message: 'hello room' });

    assert.equal(posted.message, 'hello room');

    const stored = await models.ChatGlobal.findOne({ where: { uid: talker }, raw: true });
    assert.ok(stored, 'the row exists by the time the caller has the payload');
    assert.equal(stored.message, 'hello room');
  });

  await t.test('the Brazil room is broadcast as `spam`', async () => {
    // Legacy renamed it on the way out and nowhere else. The clients filter
    // on that label, so it is kept.
    const posted = await service.postChat({ userId: talker, room: 'brazil', message: 'olá' });
    assert.equal(posted.country, 'spam');
    assert.equal(posted.room, 'brazil');

    await models.ChatBrazil.destroy({ where: { uid: talker } });
  });

  await t.test('a MUTED player is REFUSED, not silently dropped', async () => {
    /**
     * Legacy did `if (muted === true) return;` after having already called
     * back — so a muted player saw their own message broadcast and only the
     * database write was skipped.
     */
    await assert.rejects(
      () => service.postChat({ userId: muted, room: 'global', message: 'let me in' }),
      (err) => err.code === 'SOCIAL_MUTED'
    );

    assert.equal(await models.ChatGlobal.count({ where: { uid: muted } }), 0);
  });

  await t.test('an empty or whitespace message is refused', async () => {
    // Legacy compared against `""` and `" "` as literals, twice each, and
    // still missed a tab.
    for (const message of ['', '   ', '\t', '\n']) {
      await assert.rejects(
        () => service.postChat({ userId: talker, room: 'global', message }),
        (err) => err.code === 'SOCIAL_EMPTY_MESSAGE'
      );
    }
  });

  await t.test('AN OVERLONG MESSAGE IS REFUSED', async () => {
    // Legacy had no bound: socket to table to every connected client.
    await assert.rejects(
      () => service.postChat({ userId: talker, room: 'global', message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }),
      (err) => err.code === 'SOCIAL_MESSAGE_TOO_LONG'
    );
  });

  await t.test('an unknown room is refused rather than concatenated', async () => {
    await assert.rejects(
      () => service.postChat({ userId: talker, room: 'nowhere', message: 'hi' }),
      (err) => err.code === 'SOCIAL_UNKNOWN_ROOM'
    );
  });

  await t.test('the room read comes back oldest first', async () => {
    const result = await service.listChat({ room: 'global', limit: 10 });
    assert.ok(result.rows.length >= 1);

    const sorters = result.rows.map((r) => r.sorter);
    assert.deepEqual(sorters, [...sorters].sort((a, b) => a - b), 'ascending, as a chat window renders');
  });

  // ══════════════════════════════════════════════════════════════════════

  await t.test('a friend is added once, not twice', async () => {
    const first = await service.addFriend({ userId: talker, name: `s${friend}` });
    assert.equal(first.added, true);

    const second = await service.addFriend({ userId: talker, name: `s${friend}` });
    assert.equal(second.added, false, 'a duplicate add is a no-op, not a second entry');

    const row = await models.Users.findOne({ where: { id: talker }, raw: true });
    assert.equal(parseFriends(row.friends).filter((n) => n === `s${friend}`).length, 1);
  });

  await t.test('you cannot friend yourself', async () => {
    await assert.rejects(
      () => service.addFriend({ userId: talker, name: `s${talker}` }),
      (err) => err.code === 'SOCIAL_CANNOT_FRIEND_SELF'
    );
  });

  await t.test('the friend list resolves to real accounts', async () => {
    const result = await service.listFriends({ userId: talker });
    assert.ok(result.friends.some((f) => f.name === `s${friend}`));
    // `Support` is in the seed string but is not a real account — it is
    // dropped rather than returned as a null-shaped entry.
    assert.equal(result.friends.some((f) => f.name === 'Support'), false);
  });

  // ══════════════════════════════════════════════════════════════════════

  await t.test('a private message is stored under a stable key', async () => {
    const sent = await service.sendMessage({ userId: talker, toName: `s${friend}`, message: 'hi there' });
    assert.equal(sent.toName, `s${friend}`);

    const stored = await models.Messages.findOne({ where: { from_uid: talker }, raw: true });
    assert.equal(stored.room_key, roomKey(talker, friend));
  });

  await t.test('BOTH PARTIES SEE ONE THREAD', async () => {
    // The key is derived from the two ids, sorted — so a reply lands in the
    // same conversation rather than starting a second one.
    await service.sendMessage({ userId: friend, toName: `s${talker}`, message: 'hi back' });

    const mine = await service.listMessages({ userId: talker, withName: `s${friend}` });
    const theirs = await service.listMessages({ userId: friend, withName: `s${talker}` });

    assert.equal(mine.rows.length, 2);
    assert.deepEqual(
      mine.rows.map((r) => r.message),
      theirs.rows.map((r) => r.message),
      'the same conversation from either side'
    );
  });

  await t.test('you cannot message yourself', async () => {
    await assert.rejects(
      () => service.sendMessage({ userId: talker, toName: `s${talker}`, message: 'note to self' }),
      (err) => err.code === 'SOCIAL_CANNOT_MESSAGE_SELF'
    );
  });

  await t.test('messaging a name that does not exist is refused', async () => {
    await assert.rejects(
      () => service.sendMessage({ userId: talker, toName: 'nobody-at-all', message: 'hello' }),
      (err) => err.code === 'SOCIAL_PLAYER_NOT_FOUND'
    );
  });
});
