'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { LocksService } = require('../locks.service');
const v = require('../locks.validators');
const { LOCK_FIELDS } = require('../locks.constants');

/**
 * Locks.
 *
 * The test that matters: locking an agent must reach the WHOLE branch. Legacy
 * locked the named agent and the players attached directly to them, and left
 * every sub-agent and their players still trading — while reporting success.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextId = 500_000_000 + (process.pid % 100_000) * 1000;
const newId = () => (nextId += 1);

test('lock validators', async (t) => {
  await t.test('the legacy field names map to columns that EXIST', () => {
    /**
     * `all_system_blocked` and `casino_blocked` are not columns on `users` or
     * `staff`. Legacy built its SET clause from those literal names, so a
     * request naming either produced `column … does not exist` — and because
     * all three went into ONE statement, a request setting the sports lock
     * alongside either of them failed entirely.
     */
    const parsed = v.updateLocks.body.parse({ userId: 1, all_system_blocked: true, casino_blocked: true });

    assert.deepEqual(parsed.locks, { system: true, casino: true });
    assert.equal(LOCK_FIELDS.system, 'system_locked');
    assert.equal(LOCK_FIELDS.casino, 'casino_locked');
  });

  await t.test('the one legacy name that worked still works', () => {
    const parsed = v.updateLocks.body.parse({ userId: 1, sports_betlocked: true });
    assert.deepEqual(parsed.locks, { sports: true });
  });

  await t.test('a current name wins over its legacy alias', () => {
    const parsed = v.updateLocks.body.parse({ userId: 1, system: false, all_system_blocked: true });
    assert.equal(parsed.locks.system, false);
  });

  await t.test('naming both a player and an agent is refused', () => {
    // Legacy took `if (user_id) … else if (staff_id …)`, so the agent branch
    // was silently skipped and the caller had no way to know.
    assert.equal(v.updateLocks.body.safeParse({ userId: 1, staffId: 2, system: true }).success, false);
  });

  await t.test('naming neither is refused', () => {
    assert.equal(v.updateLocks.body.safeParse({ system: true }).success, false);
  });

  await t.test('naming no lock is refused', () => {
    assert.equal(v.updateLocks.body.safeParse({ userId: 1 }).success, false);
  });

  await t.test('a referral slug is an identifier', () => {
    // It is read without authentication.
    assert.equal(v.resolveReferral.params.safeParse({ slug: 'agent-42' }).success, true);
    assert.equal(v.resolveReferral.params.safeParse({ slug: "'; DROP TABLE staff--" }).success, false);
  });
});

test('locks against a database', async (t) => {
  const logger = createLogger({ name: 'locks-test', level: 'silent' });

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

  const { models } = connection;
  const service = new LocksService({ models, db: connection, logger, config: {} });

  const roleId = (await models.Roles.findOne({ raw: true }))?.id ?? 1;

  /**
   * A three-level tree:
   *
   *     owner ── mid ── leaf
   *       │        │       │
   *   ownerPlayer  midPlayer  leafPlayer
   *
   * Legacy locking `mid` would have touched `mid` and `midPlayer` only.
   * `leaf` and `leafPlayer` kept trading.
   */
  const owner = newId();
  const mid = newId();
  const leaf = newId();
  const ownerPlayer = newId();
  const midPlayer = newId();
  const leafPlayer = newId();

  const allStaff = [owner, mid, leaf];
  const allPlayers = [ownerPlayer, midPlayer, leafPlayer];

  t.before(async () => {
    await models.Users.destroy({ where: { id: allPlayers } });
    await models.Staff.destroy({ where: { id: allStaff } });

    await models.Staff.bulkCreate([
      { id: owner, name: `lo-${owner}`, email: `lo${owner}@t.test`, password: 'x', role_id: roleId, parent_id: null },
      { id: mid, name: `lm-${mid}`, email: `lm${mid}@t.test`, password: 'x', role_id: roleId, parent_id: owner },
      { id: leaf, name: `ll-${leaf}`, email: `ll${leaf}@t.test`, password: 'x', role_id: roleId, parent_id: mid },
    ]);

    await models.Users.bulkCreate([
      { id: ownerPlayer, name: `lpo-${ownerPlayer}`, password: 'x', status: 'active', parent_staff_id: owner },
      { id: midPlayer, name: `lpm-${midPlayer}`, password: 'x', status: 'active', parent_staff_id: mid },
      { id: leafPlayer, name: `lpl-${leafPlayer}`, password: 'x', status: 'active', parent_staff_id: leaf },
    ]);
  });

  t.after(async () => {
    await models.Users.destroy({ where: { id: allPlayers } });
    await models.Staff.destroy({ where: { id: allStaff } });
    if (connection) await connection.close();
  });

  const asOwner = { id: owner, permissions: ['*'] };
  const asLeaf = { id: leaf, permissions: ['*'] };

  const playerLocked = async (id) => {
    const row = await models.Users.findOne({ where: { id }, raw: true });
    return Boolean(row.system_locked);
  };
  const staffLocked = async (id) => {
    const row = await models.Staff.findOne({ where: { id }, raw: true });
    return Boolean(row.system_locked);
  };

  await t.test('LOCKING AN AGENT LOCKS THE WHOLE BRANCH', async () => {
    /**
     * ═══════════════════════════════════════════════════════════════════
     * THE TEST THIS FILE EXISTS FOR
     *
     * Legacy, for a `staff_id`:
     *
     *     `UPDATE users SET … WHERE parent_staff_id = $N`
     *     `UPDATE staff SET … WHERE id = $1 AND parent_id IS NOT NULL`
     *
     * One level. Locking `mid` left `leaf` and `leafPlayer` untouched — and
     * the reason to lock an agent is usually that money is going missing
     * through them, so the branch below is exactly what needed stopping.
     * ═══════════════════════════════════════════════════════════════════
     */
    const result = await service.updateLocks({
      actor: asOwner,
      staffId: mid,
      locks: { system: true },
    });

    assert.equal(await staffLocked(mid), true, 'the named agent');
    assert.equal(await staffLocked(leaf), true, 'AND THE SUB-AGENT — legacy left this one trading');
    assert.equal(await playerLocked(midPlayer), true, "the agent's own player");
    assert.equal(await playerLocked(leafPlayer), true, "AND THE SUB-AGENT'S player");

    // Untouched: the owner's own branch.
    assert.equal(await staffLocked(owner), false);
    assert.equal(await playerLocked(ownerPlayer), false);

    assert.equal(result.agentsInSubtree, 2);
    assert.ok(result.playersAffected >= 2);
  });

  await t.test('unlocking reaches just as far', async () => {
    await service.updateLocks({ actor: asOwner, staffId: mid, locks: { system: false } });

    assert.equal(await staffLocked(mid), false);
    assert.equal(await staffLocked(leaf), false);
    assert.equal(await playerLocked(leafPlayer), false);
  });

  await t.test('a lock TWO LEVELS DOWN applies', async () => {
    /**
     * Legacy constrained the player update with `AND parent_staff_id = caller`,
     * so an agent above the player's immediate agent matched zero rows — and
     * the handler ignored the row count and answered "Lock update
     * successfully." anyway.
     */
    const result = await service.updateLocks({
      actor: asOwner,
      userId: leafPlayer,
      locks: { sports: true },
    });

    assert.equal(result.playersAffected, 1);
    const row = await models.Users.findOne({ where: { id: leafPlayer }, raw: true });
    assert.equal(Boolean(row.sports_betlocked), true);
  });

  await t.test('a lock that matches nothing is an ERROR, not a success', async () => {
    // The row count is the answer. Legacy never looked at it.
    await assert.rejects(
      () => service.updateLocks({ actor: asLeaf, userId: ownerPlayer, locks: { system: true } }),
      (err) => err.code === 'LOCKS_NOT_IN_YOUR_TREE'
    );
  });

  await t.test('an agent cannot lock someone above them', async () => {
    await assert.rejects(
      () => service.updateLocks({ actor: asLeaf, staffId: owner, locks: { system: true } }),
      (err) => err.code === 'LOCKS_NOT_IN_YOUR_TREE'
    );
    assert.equal(await staffLocked(owner), false);
  });

  await t.test('locking yourself out is refused', async () => {
    // Legacy permitted it, and it is not recoverable through this route.
    await assert.rejects(
      () => service.updateLocks({ actor: asOwner, staffId: owner, locks: { system: true } }),
      (err) => err.code === 'LOCKS_CANNOT_LOCK_SELF'
    );
  });

  await t.test('all three locks apply together', async () => {
    /**
     * In legacy this exact call failed entirely: `all_system_blocked` and
     * `casino_blocked` are not columns, and all three went into one statement,
     * so the sports lock that WOULD have worked went down with them.
     */
    await service.updateLocks({
      actor: asOwner,
      userId: ownerPlayer,
      locks: { system: true, casino: true, sports: true },
    });

    const row = await models.Users.findOne({ where: { id: ownerPlayer }, raw: true });
    assert.equal(Boolean(row.system_locked), true);
    assert.equal(Boolean(row.casino_locked), true);
    assert.equal(Boolean(row.sports_betlocked), true);
  });

  await t.test("a rival's transfer history is not readable", async () => {
    // Legacy served this on `/api/public/user-transfers/:uid`, unauthenticated.
    await assert.rejects(
      () => service.userTransfers({ actor: asLeaf, userId: ownerPlayer }),
      (err) => err.code === 'LOCKS_NOT_IN_YOUR_TREE'
    );
  });

  await t.test('an unknown referral slug is a 404', async () => {
    await assert.rejects(
      () => service.resolveReferral({ slug: 'no-such-slug-at-all' }),
      (err) => err.code === 'LOCKS_UNKNOWN_REFERRAL' && err.status === 404
    );
  });
});
