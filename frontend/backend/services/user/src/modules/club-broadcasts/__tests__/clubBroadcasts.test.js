'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { ClubBroadcastsService } = require('../clubBroadcasts.service');
const { BannerImageStore, detectType } = require('../imageStore');

/**
 * Club banners and notifications.
 *
 * The first block is the important one: `GET /clubs/banner-image/:imagePath(*)`
 * joined a wildcard path parameter onto a storage root with no containment
 * check, unauthenticated.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;
let root;

let nextId = 950_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

/** A real 1×1 PNG, so magic-byte detection has something genuine to accept. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test('club banners and notifications', async (t) => {
  const logger = createLogger({ name: 'clubcast-test', level: 'silent' });

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

  root = await fs.mkdtemp(path.join(os.tmpdir(), 'clubcast-'));

  t.after(async () => {
    if (connection) await connection.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  const { models } = connection;

  const service = new ClubBroadcastsService({
    models,
    db: connection,
    logger,
    config: { CLUB_BANNER_STORAGE_DIR: root },
  });

  const store = new BannerImageStore({ root, logger });

  /** An owner, a club, and a member. */
  const seedClub = async () => {
    const ownerId = newId();
    const memberId = newId();
    const clubId = newId();

    for (const id of [ownerId, memberId]) {
      await models.Users.destroy({ where: { id } });
      await models.Users.create({ id, name: `cc-${id}`, password: 'x', status: 'active' });
    }

    await models.ClubMembership.destroy({ where: { club_id: clubId } });
    await models.Clubs.destroy({ where: { id: clubId } });
    await models.Clubs.create({
      id: clubId,
      name: `Club ${clubId}`,
      code: `C${clubId}`,
      unique_club_id: `u${clubId}`,
      owner_id: ownerId,
      is_active: true,
    });

    for (const [userId, role] of [[ownerId, 'owner'], [memberId, 'member']]) {
      await models.ClubMembership.create({ club_id: clubId, user_id: userId, role });
    }

    return { ownerId, memberId, clubId };
  };

  // ══════════════════════════════════════════════════════════════════════
  //  The path traversal
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a path that escapes the storage root is refused', async () => {
    /**
     * The legacy handler:
     *
     *     const fullPath = path.join(ROOT, req.params.imagePath);
     *     res.send(await fs.readFile(fullPath));
     *
     * with `:imagePath(*)` — a wildcard that matches slashes — and no check.
     */
    const secret = path.join(root, '..', `clubcast-secret-${process.pid}.txt`);
    await fs.writeFile(secret, 'DATABASE_PASSWORD=hunter2');

    try {
      for (const attempt of [
        `../clubcast-secret-${process.pid}.txt`,
        `../../${path.basename(root)}/../clubcast-secret-${process.pid}.txt`,
        '/etc/passwd',
        '../../../../../../etc/passwd',
        'a/../../etc/passwd',
      ]) {
        assert.throws(
          () => store.resolve(attempt),
          (err) => err.code === 'CLUBCAST_IMAGE_NOT_FOUND',
          `${attempt} must be refused`
        );
      }
    } finally {
      await fs.rm(secret, { force: true });
    }
  });

  await t.test('a NUL byte in the path is refused', async () => {
    // A NUL truncates the path at the filesystem layer, which is a way to make
    // a suffix check pass and then open something else entirely.
    assert.throws(
      () => store.resolve('club/image.png\0/../../etc/passwd'),
      (err) => err.code === 'CLUBCAST_IMAGE_NOT_FOUND'
    );
  });

  await t.test('a sibling directory sharing the root prefix is refused', async () => {
    // `/srv/images-evil` starts with `/srv/images`, so a bare `startsWith`
    // without the separator lets it through.
    const evil = new BannerImageStore({ root: path.join(root, 'images'), logger });
    assert.throws(
      () => evil.resolve('../images-evil/x.png'),
      (err) => err.code === 'CLUBCAST_IMAGE_NOT_FOUND'
    );
  });

  await t.test('a path inside the root resolves', async () => {
    const resolved = store.resolve('u123/abc.png');
    assert.equal(resolved, path.join(root, 'u123', 'abc.png'));
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Upload validation
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the image type comes from the CONTENT, not an extension', async () => {
    // A file called `x.png` that is actually HTML is served as HTML by anything
    // that trusts the extension — a stored cross-site script.
    assert.equal(detectType(PNG), 'image/png');
    assert.equal(detectType(Buffer.from('<html><script>alert(1)</script>')), null);
    assert.equal(detectType(Buffer.from('GIF89a')), null, 'GIF is not on the allow-list');
  });

  await t.test('a non-image upload is refused', async () => {
    await assert.rejects(
      () => store.write({ clubKey: 'u1', buffer: Buffer.from('<svg onload=alert(1)>') }),
      (err) => err.code === 'CLUBCAST_IMAGE_TYPE_NOT_ALLOWED'
    );
  });

  await t.test('an oversized upload is refused', async () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
    await assert.rejects(
      () => store.write({ clubKey: 'u1', buffer: huge }),
      (err) => err.code === 'CLUBCAST_IMAGE_TOO_LARGE'
    );
  });

  await t.test('the stored filename is generated, never taken from the caller', async () => {
    // Legacy used `${uniqueClubId}/${imageName}` with the name from the request,
    // which is the other half of a traversal.
    const a = await store.write({ clubKey: 'u1', buffer: PNG });
    const b = await store.write({ clubKey: 'u1', buffer: PNG });

    assert.notEqual(a.storedPath, b.storedPath);
    assert.match(a.storedPath, /^u1\/[0-9a-f]{32}\.png$/);
  });

  await t.test('a club key with path characters cannot escape', async () => {
    const written = await store.write({ clubKey: '../../evil', buffer: PNG });
    assert.match(written.storedPath, /^evil\//, 'the separators are stripped, not honoured');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Ownership comes from the token
  // ══════════════════════════════════════════════════════════════════════

  await t.test('only the owner can create a banner', async () => {
    /**
     * `WHERE id = $1 AND owner_id = $2` reads like an authorisation check, but
     * `$2` came from the request body — so naming the real owner passed it.
     */
    const { clubId, ownerId, memberId } = await seedClub();

    await assert.rejects(
      () => service.createBanner({ clubId, actorId: memberId, title: 'Mine now', image: PNG }),
      (err) => err.code === 'CLUBCAST_NOT_CLUB_OWNER' && err.status === 403
    );

    const banner = await service.createBanner({ clubId, actorId: ownerId, title: 'Welcome', image: PNG });
    assert.equal(banner.title, 'Welcome');
    assert.match(banner.image_path, new RegExp(`^u${clubId}/`));
  });

  await t.test('a non-member cannot read a club\'s banners', async () => {
    const { clubId, ownerId } = await seedClub();
    const stranger = newId();
    await models.Users.create({ id: stranger, name: `s-${stranger}`, password: 'x', status: 'active' });

    await service.createBanner({ clubId, actorId: ownerId, title: 'Private', image: PNG });

    await assert.rejects(
      () => service.listBanners({ clubId, actorId: stranger }),
      (err) => err.code === 'CLUBCAST_NOT_A_MEMBER'
    );

    const mine = await service.listBanners({ clubId, actorId: ownerId });
    assert.equal(mine.length, 1);
  });

  await t.test('a non-member cannot read a banner image either', async () => {
    const { clubId, ownerId, memberId } = await seedClub();
    const stranger = newId();
    await models.Users.create({ id: stranger, name: `s-${stranger}`, password: 'x', status: 'active' });

    const banner = await service.createBanner({ clubId, actorId: ownerId, title: 'Private', image: PNG });

    await assert.rejects(
      () => service.readImage({ storedPath: banner.image_path, actorId: stranger }),
      (err) => err.code === 'CLUBCAST_NOT_A_MEMBER'
    );

    const image = await service.readImage({ storedPath: banner.image_path, actorId: memberId });
    assert.equal(image.contentType, 'image/png');
  });

  await t.test('deleting a banner deactivates it rather than erasing it', async () => {
    // A notification already sent about the banner still refers to it.
    const { clubId, ownerId } = await seedClub();
    const banner = await service.createBanner({ clubId, actorId: ownerId, title: 'Old', image: PNG });

    await service.removeBanner({ clubId, bannerId: banner.id, actorId: ownerId });

    const row = await models.ClubBanner.findOne({ where: { id: banner.id }, raw: true });
    assert.ok(row, 'the row survives');
    assert.equal(row.is_active, false);
    assert.deepEqual(await service.listBanners({ clubId, actorId: ownerId }), []);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Broadcasts
  // ══════════════════════════════════════════════════════════════════════

  await t.test('sending reaches every member exactly once', async () => {
    const { clubId, ownerId } = await seedClub();

    const sent = await service.send({
      channel: 'club',
      clubId,
      actorId: ownerId,
      title: 'Tournament tonight',
      body: 'Doors at eight',
    });

    assert.equal(sent.recipients, 2);
    assert.equal(await models.ClubNotificationStatus.count({ where: { notification_id: sent.id } }), 2);
  });

  await t.test('re-sending the same notification does NOT duplicate delivery rows', async () => {
    /**
     * Legacy looped and inserted per member with no constraint, so a resend
     * produced a second row per member and the read receipt then updated
     * whichever one it found.
     */
    const { clubId, ownerId, memberId } = await seedClub();

    const first = await service.send({ channel: 'club', clubId, actorId: ownerId, title: 'Ping' });
    await service.markRead({ channel: 'club', notificationId: first.id, actorId: memberId });

    // Re-deliver the SAME notification to the same members.
    await models.ClubNotificationStatus.bulkCreate(
      [{ notification_id: first.id, user_id: memberId, is_sent: true, sent_at: new Date() }],
      { updateOnDuplicate: ['is_sent', 'sent_at'] }
    );

    assert.equal(
      await models.ClubNotificationStatus.count({ where: { notification_id: first.id, user_id: memberId } }),
      1
    );

    const row = await models.ClubNotificationStatus.findOne({
      where: { notification_id: first.id, user_id: memberId },
      raw: true,
    });
    assert.equal(row.is_read, true, 'and the read state survived the resend');
  });

  await t.test('only the owner can broadcast', async () => {
    const { clubId, memberId } = await seedClub();

    await assert.rejects(
      () => service.send({ channel: 'club', clubId, actorId: memberId, title: 'Spam' }),
      (err) => err.code === 'CLUBCAST_NOT_CLUB_OWNER'
    );
  });

  await t.test('a member sees the club\'s notifications with THEIR own read state', async () => {
    // Legacy returned the raw notification rows with no per-member state, so
    // "unread" was unanswerable from the endpoint meant to answer it.
    const { clubId, ownerId, memberId } = await seedClub();

    const one = await service.send({ channel: 'club', clubId, actorId: ownerId, title: 'One' });
    await service.send({ channel: 'club', clubId, actorId: ownerId, title: 'Two' });

    await service.markRead({ channel: 'club', notificationId: one.id, actorId: memberId });

    const listed = await service.list({ channel: 'club', clubId, actorId: memberId, limit: 10, offset: 0 });

    assert.equal(listed.total, 2);
    const read = listed.rows.find((r) => Number(r.id) === Number(one.id));
    assert.equal(read.is_read, true);
    assert.ok(read.read_at, 'and WHEN they read it — legacy stored only the boolean');
    assert.equal(listed.rows.find((r) => Number(r.id) !== Number(one.id)).is_read, false);
  });

  await t.test('a player can only mark their OWN copy read', async () => {
    // Legacy took `userId` from the body.
    const { clubId, ownerId, memberId } = await seedClub();
    const stranger = newId();
    await models.Users.create({ id: stranger, name: `s-${stranger}`, password: 'x', status: 'active' });

    const sent = await service.send({ channel: 'club', clubId, actorId: ownerId, title: 'Hi' });

    await assert.rejects(
      () => service.markRead({ channel: 'club', notificationId: sent.id, actorId: stranger }),
      (err) => err.code === 'CLUBCAST_NOTIFICATION_NOT_FOUND'
    );

    const member = await models.ClubNotificationStatus.findOne({
      where: { notification_id: sent.id, user_id: memberId },
      raw: true,
    });
    assert.equal(member.is_read, false, "and the member's copy is untouched");
  });

  await t.test('read_at records the FIRST time it was seen', async () => {
    const { clubId, ownerId, memberId } = await seedClub();
    const sent = await service.send({ channel: 'club', clubId, actorId: ownerId, title: 'Hi' });

    await service.markRead({ channel: 'club', notificationId: sent.id, actorId: memberId });
    const first = await models.ClubNotificationStatus.findOne({
      where: { notification_id: sent.id, user_id: memberId },
      raw: true,
    });

    await service.markRead({ channel: 'club', notificationId: sent.id, actorId: memberId });
    const second = await models.ClubNotificationStatus.findOne({
      where: { notification_id: sent.id, user_id: memberId },
      raw: true,
    });

    assert.deepEqual(second.read_at, first.read_at, 'not overwritten by a later poll');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Both channels share one implementation
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a banner notification behaves identically to a club one', async () => {
    /**
     * Legacy implemented the sender, the fan-out, the listing and the read
     * receipt separately for each kind, and the copies had drifted — the banner
     * sender required an active club, the plain one did not.
     */
    const { clubId, ownerId, memberId } = await seedClub();
    const banner = await service.createBanner({ clubId, actorId: ownerId, title: 'New season', image: PNG });

    const sent = await service.send({
      channel: 'banner',
      clubId,
      bannerId: banner.id,
      actorId: ownerId,
      title: 'Look at this',
    });

    assert.equal(sent.recipients, 2);
    assert.equal(Number(sent.banner_id), Number(banner.id));

    await service.markRead({ channel: 'banner', notificationId: sent.id, actorId: memberId });

    const listed = await service.list({ channel: 'banner', clubId, actorId: memberId, limit: 10, offset: 0 });
    assert.equal(listed.rows[0].is_read, true);
  });

  await t.test('notifying about a banner from another club is refused', async () => {
    const a = await seedClub();
    const b = await seedClub();

    const banner = await service.createBanner({ clubId: b.clubId, actorId: b.ownerId, title: 'Theirs', image: PNG });

    await assert.rejects(
      () =>
        service.send({
          channel: 'banner',
          clubId: a.clubId,
          bannerId: banner.id,
          actorId: a.ownerId,
          title: 'Not mine',
        }),
      (err) => err.code === 'CLUBCAST_BANNER_NOT_FOUND'
    );
  });
});
