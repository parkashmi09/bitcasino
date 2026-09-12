'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { ClubService } = require('../club.service');

/**
 * Clubs.
 *
 * These are the first tests this feature has ever had, and the first time its
 * tables have existed — see migration 014.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextUid = 920_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

test('clubs', async (t) => {
  const logger = createLogger({ name: 'club-test', level: 'silent' });

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

  t.after(async () => {
    if (connection) await connection.close();
  });

  const service = new ClubService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service' },
  });

  const seed = async (uid) => {
    await connection.models.ClubMembership.destroy({ where: { user_id: uid } });
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({ id: uid, name: `club-${uid}`, password: 'x', status: 'active' });
    return uid;
  };

  /** An owner with a club, and its agent code. */
  const withClub = async (options = {}) => {
    const ownerId = await seed(newUid());
    const club = await service.create({ ownerId, name: `Club ${ownerId}`, ...options });
    const ownerMembership = await connection.models.ClubMembership.findOne({
      where: { user_id: ownerId }, raw: true,
    });
    return { ownerId, club, agentCode: ownerMembership.unique_agent_code };
  };

  // ══════════════════════════════════════════════════════════════════════
  //  Creation
  // ══════════════════════════════════════════════════════════════════════

  await t.test('creating a club makes the owner a member of it', async () => {
    const { ownerId, club } = await withClub();

    const membership = await connection.models.ClubMembership.findOne({
      where: { user_id: ownerId }, raw: true,
    });
    assert.equal(membership.role, 'owner');
    assert.equal(Number(membership.club_id), Number(club.id));
    assert.ok(membership.unique_agent_code, 'an owner recruits too, so they get a code');
  });

  await t.test('a club gets a code that avoids look-alike characters', async () => {
    const { club } = await withClub();
    // No 0/O or 1/I/L — these codes are typed by hand off a screen, and a
    // member joining the wrong downline is a support ticket about money.
    assert.match(club.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
  });

  await t.test('a player who is already in a club cannot found another', async () => {
    const { ownerId } = await withClub();
    await assert.rejects(
      () => service.create({ ownerId, name: 'Second club' }),
      (err) => err.code === 'CLUB_ALREADY_IN_CLUB'
    );
  });

  await t.test('a sub-club inherits its parent chain in the hierarchy', async () => {
    // Legacy never wrote these closure rows for a sub-club, so asking for a
    // parent's hierarchy returned only the parent.
    const parent = await withClub();
    const childOwner = await seed(newUid());
    const child = await service.create({
      ownerId: childOwner, name: 'Child', parentClubId: parent.club.id,
    });

    const fromParent = await service.hierarchy({ clubId: parent.club.id });
    const ids = fromParent.map((c) => Number(c.id));

    assert.ok(ids.includes(Number(parent.club.id)), 'a club is its own ancestor at depth 0');
    assert.ok(ids.includes(Number(child.id)), 'and the child appears below it');
    assert.equal(fromParent.find((c) => Number(c.id) === Number(child.id)).depth, 1);
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Joining
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a player joins by club code', async () => {
    const { club } = await withClub();
    const member = await seed(newUid());

    const membership = await service.join({ userId: member, clubCode: club.code });
    assert.equal(Number(membership.clubId), Number(club.id));
    assert.equal(membership.role, 'member');
  });

  await t.test('a player joins by AGENT code and is attributed to that agent', async () => {
    const { club, ownerId, agentCode } = await withClub();
    const member = await seed(newUid());

    const membership = await service.join({ userId: member, agentCode });
    assert.equal(Number(membership.clubId), Number(club.id));
    assert.equal(Number(membership.agentId), Number(ownerId), 'the recruiter earns on this member');
  });

  await t.test('a player belongs to ONE club', async () => {
    const first = await withClub();
    const second = await withClub();
    const member = await seed(newUid());

    await service.join({ userId: member, clubCode: first.club.code });
    await assert.rejects(
      () => service.join({ userId: member, clubCode: second.club.code }),
      (err) => err.code === 'CLUB_ALREADY_IN_CLUB'
    );
  });

  await t.test('two simultaneous joins produce ONE membership', async () => {
    // The legacy check was a read; the uniqueness is now the database's.
    const { club } = await withClub();
    const member = await seed(newUid());

    const results = await Promise.allSettled([
      service.join({ userId: member, clubCode: club.code }),
      service.join({ userId: member, clubCode: club.code }),
    ]);

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await connection.models.ClubMembership.count({ where: { user_id: member } }), 1);
  });

  await t.test('a full club refuses further members', async () => {
    const { club } = await withClub({ maxMembers: 1 });

    await service.join({ userId: await seed(newUid()), clubCode: club.code });

    const extra = await seed(newUid());
    await assert.rejects(
      () => service.join({ userId: extra, clubCode: club.code }),
      (err) => err.code === 'CLUB_CLUB_FULL'
    );
  });

  await t.test('an inactive club refuses members', async () => {
    const { club, ownerId } = await withClub();
    await service.update({ clubId: club.id, actorId: ownerId, isActive: false });

    const joiner = await seed(newUid());
    await assert.rejects(
      () => service.join({ userId: joiner, clubCode: club.code }),
      (err) => err.code === 'CLUB_CLUB_INACTIVE'
    );
  });

  await t.test('an unknown agent code is refused', async () => {
    const joiner = await seed(newUid());
    await assert.rejects(
      () => service.join({ userId: joiner, agentCode: 'ZZZZZZZZ' }),
      (err) => err.code === 'CLUB_AGENT_NOT_FOUND'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Roles
  // ══════════════════════════════════════════════════════════════════════

  await t.test('only the club owner can promote a member', async () => {
    // Legacy took the player, club and new role from the body with no
    // authentication — so a member could promote themselves to agent, mint a
    // recruitment code, and take a share of the earnings split.
    const { club, ownerId } = await withClub();
    const member = await seed(newUid());
    await service.join({ userId: member, clubCode: club.code });

    await assert.rejects(
      () => service.changeRole({ actorId: member, userId: member, newRole: 'agent' }),
      (err) => err.code === 'CLUB_NOT_CLUB_OWNER' && err.status === 403
    );

    const promoted = await service.changeRole({ actorId: ownerId, userId: member, newRole: 'agent' });
    assert.equal(promoted.role, 'agent');
    assert.ok(promoted.agentCode);
  });

  await t.test('demoting an agent clears their recruitment code', async () => {
    // Otherwise a demoted agent keeps recruiting into a downline they no longer
    // hold a position in.
    const { club, ownerId } = await withClub();
    const member = await seed(newUid());
    await service.join({ userId: member, clubCode: club.code });
    await service.changeRole({ actorId: ownerId, userId: member, newRole: 'agent' });

    const demoted = await service.changeRole({ actorId: ownerId, userId: member, newRole: 'member' });
    assert.equal(demoted.agentCode, null);

    const row = await connection.models.ClubMembership.findOne({ where: { user_id: member }, raw: true });
    assert.equal(row.unique_agent_code, null);
  });

  await t.test('an owner cannot be demoted through the role endpoint', async () => {
    // A club with two owners, or none, is unrepresentable. Ownership moves by
    // transferring the club, not by editing a membership row.
    const { ownerId } = await withClub();
    await assert.rejects(
      () => service.changeRole({ actorId: ownerId, userId: ownerId, newRole: 'member' }),
      (err) => err.code === 'CLUB_INVALID_ROLE_CHANGE'
    );
  });

  await t.test('an owner cannot leave their own club', async () => {
    const { ownerId } = await withClub();
    await assert.rejects(
      () => service.leave({ userId: ownerId }),
      (err) => err.code === 'CLUB_OWNER_CANNOT_LEAVE'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Earnings configuration
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the three percentages cannot exceed 100 between them', async () => {
    // Legacy stored whatever it was given, so a club could be configured to pay
    // out more than the wagering it generated.
    const { club, ownerId } = await withClub();

    await assert.rejects(
      () =>
        service.setEarningsConfig({
          clubId: club.id, actorId: ownerId,
          ownerPercentage: '60', agentPercentage: '30', memberPercentage: '20',
        }),
      (err) => err.code === 'CLUB_PERCENTAGES_EXCEED_TOTAL'
    );

    const ok = await service.setEarningsConfig({
      clubId: club.id, actorId: ownerId,
      ownerPercentage: '50', agentPercentage: '30', memberPercentage: '20',
    });
    assert.equal(ok.ownerPercentage, '50.00');
  });

  await t.test('a non-owner cannot change the earnings split', async () => {
    const { club } = await withClub();
    const stranger = await seed(newUid());

    await assert.rejects(
      () => service.setEarningsConfig({ clubId: club.id, actorId: stranger, ownerPercentage: '99' }),
      (err) => err.code === 'CLUB_NOT_CLUB_OWNER'
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Deletion
  // ══════════════════════════════════════════════════════════════════════

  await t.test('deleting a club removes its memberships in one transaction', async () => {
    const { club, ownerId } = await withClub();
    const member = await seed(newUid());
    await service.join({ userId: member, clubCode: club.code });

    await service.remove({ clubId: club.id, actorId: ownerId });

    assert.equal(await connection.models.ClubMembership.count({ where: { club_id: club.id } }), 0);
    assert.equal(await connection.models.Clubs.count({ where: { id: club.id } }), 0);
  });

  await t.test('a club with sub-clubs cannot be deleted', async () => {
    const parent = await withClub();
    const childOwner = await seed(newUid());
    await service.create({ ownerId: childOwner, name: 'Child', parentClubId: parent.club.id });

    await assert.rejects(
      () => service.remove({ clubId: parent.club.id, actorId: parent.ownerId }),
      (err) => err.code === 'CLUB_HAS_SUB_CLUBS'
    );
  });

  await t.test('a non-owner cannot delete a club', async () => {
    const { club } = await withClub();
    const stranger = await seed(newUid());

    await assert.rejects(
      () => service.remove({ clubId: club.id, actorId: stranger }),
      (err) => err.code === 'CLUB_NOT_CLUB_OWNER'
    );
  });
  // ══════════════════════════════════════════════════════════════════════
  //  The owner profile — legacy's `/clubmembership/userprofile/:userId`
  // ══════════════════════════════════════════════════════════════════════

  await t.test('the owner profile counts members but not the owner', async () => {
    // Legacy: `SELECT COUNT(*) FROM club_memberships WHERE club_id = $1 AND
    // role != 'owner'`. The count is kept; the `SELECT *` beside it is not.
    const { ownerId, club, agentCode } = await withClub();

    const profile = await service.ownerProfile({ ownerId });
    assert.equal(profile.id, club.id);
    assert.equal(profile.members, 0, 'the owner is not counted as a member');

    const joiner = await seed(newUid());
    await service.join({ userId: joiner, clubCode: club.code, agentCode });

    assert.equal((await service.ownerProfile({ ownerId })).members, 1);
  });

  await t.test('the owner profile does not inline the image bytes', async () => {
    // Legacy base64-encoded the file into the JSON response, read from a
    // hardcoded absolute path (`/var/www/html/hellogames/...`) that exists on
    // one machine. Everywhere else it threw, was caught, and answered
    // `profile_picture_data: null, error: 'Image not found'`.
    const { ownerId } = await withClub({ profilePicture: 'crest.png' });

    const profile = await service.ownerProfile({ ownerId });
    assert.equal(profile.profilePicture, 'crest.png');
    assert.equal(profile.profile_picture_data, undefined);
    assert.equal(profile.password, undefined, 'and no `SELECT *` leakage');
  });

  await t.test('a player who owns no club is a 404', async () => {
    const stranger = await seed(newUid());
    await assert.rejects(
      () => service.ownerProfile({ ownerId: stranger }),
      (err) => err.code === 'CLUB_CLUB_NOT_FOUND' && err.status === 404
    );
  });
});
