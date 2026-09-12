'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const { LordsService } = require('../lords.service');
const v = require('../lords.validators');

/**
 * Operator controls over one account.
 *
 * `legacy/system/routes/lords.js` is the best-guarded code in the platform —
 * token auth, a transaction password on every write, hierarchy checks, and
 * `FOR UPDATE` before every balance change. Two things are still tested here:
 * that the password reset stops writing cleartext, and that the refill's debit
 * has a floor.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextStaffId = 780_000 + (process.pid % 1000) * 100;
const newStaffId = () => (nextStaffId += 1);

let nextUid = 820_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

const TXN_PASSWORD = 'operator transaction password';

test('admin account controls', async (t) => {
  const logger = createLogger({ name: 'lords-test', level: 'silent' });

  // ══════════════════════════════════════════════════════════════════════
  //  The schemas — no database needed
  // ══════════════════════════════════════════════════════════════════════

  await t.test('every write requires the transaction password', async () => {
    // Legacy required it on all five and it is the one control that separates
    // a stolen session from an operator's decision.
    const missing = { accountType: 'user', accountId: 5 };
    assert.equal(v.setPassword.body.safeParse({ ...missing, newPassword: 'a'.repeat(12) }).success, false);
    assert.equal(v.setStatus.body.safeParse({ ...missing, status: 'suspended' }).success, false);
    assert.equal(v.refill.body.safeParse({ accountId: 5, amount: '100' }).success, false);
  });

  await t.test('lock flags must be real booleans', async () => {
    // A coerced `"false"` is truthy and would LOCK an account somebody meant to
    // unlock — the wrong direction for a lock switch to fail in.
    const base = { accountType: 'user', accountId: 5, transactionPassword: 'x' };
    assert.equal(v.setStatus.body.safeParse({ ...base, systemLocked: true }).success, true);
    assert.equal(v.setStatus.body.safeParse({ ...base, systemLocked: 'false' }).success, false);
  });

  await t.test('a refill cannot name who pays', async () => {
    const base = { accountId: 5, amount: '100', transactionPassword: 'x' };
    assert.equal(v.refill.body.safeParse(base).success, true);
    assert.equal(v.refill.body.safeParse({ ...base, fromId: 1 }).success, false);
    assert.equal(v.refill.body.safeParse({ ...base, amount: 100 }).success, false);
  });

  await t.test('a limit may be zero but an amount may not', async () => {
    // Zero is how an operator switches a limit off. A zero-value transfer is a
    // bug.
    const base = { accountId: 5, transactionPassword: 'x' };
    assert.equal(v.setCreditLimit.body.safeParse({ ...base, creditLimit: '0' }).success, true);
    assert.equal(v.refill.body.safeParse({ ...base, amount: '0' }).success, false);
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

  const service = new LordsService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'admin-service', ADMIN_MAX_REFILL: '1000000' },
  });

  const roleId = 9950 + (process.pid % 50);

  const seedStaff = async (id, { inr = '0', parentId = null } = {}) => {
    await connection.sequelize.query(
      `INSERT INTO roles (id, name, level) VALUES (:roleId, :name, 3) ON CONFLICT (id) DO NOTHING`,
      { replacements: { roleId, name: `lords-role-${roleId}` } }
    );
    const { Op } = require('sequelize');
    await connection.models.StaffHierarchy.destroy({
      where: { [Op.or]: [{ ancestor_id: id }, { descendant_id: id }] },
    });
    await connection.models.StaffBalances.destroy({ where: { staff_id: id } });
    await connection.models.Staff.destroy({ where: { id } });

    await connection.models.Staff.create({
      id,
      name: `lords-staff-${id}`,
      email: `lords-${id}@test.invalid`,
      password: 'x',
      // The operator's second factor, hashed. `verifyTransactionPassword`
      // handles both a hash and the legacy plaintext form, so this exercises
      // the hashed path.
      transaction_password: await hashPassword(TXN_PASSWORD, 4),
      role_id: roleId,
      parent_id: parentId,
      status: 'active',
    });
    await connection.models.StaffBalances.create({ staff_id: id, inr });

    const rows = [{ ancestor_id: id, descendant_id: id, depth: 0 }];
    if (parentId) {
      const ancestors = await connection.models.StaffHierarchy.findAll({
        where: { descendant_id: parentId }, raw: true,
      });
      rows.push(...ancestors.map((a) => ({
        ancestor_id: a.ancestor_id, descendant_id: id, depth: Number(a.depth) + 1,
      })));
    }
    await connection.models.StaffHierarchy.bulkCreate(rows, { ignoreDuplicates: true });
    await connection.sequelize.query(
      `SELECT setval('staff_id_seq', GREATEST((SELECT MAX(id) FROM staff), 1))`
    );
    return id;
  };

  const seedPlayer = async (uid, staffId, inr = '0') => {
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({
      id: uid, name: `lords-player-${uid}`, password: 'x', status: 'active', parent_staff_id: staffId,
    });
    await connection.models.Credits.create({ uid, inr });
    return uid;
  };

  const actorFor = (id, extra = {}) => ({ id, level: 3, canIssueFunds: false, ...extra });

  const playerBalance = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };
  const staffBalance = async (id) => {
    const row = await connection.models.StaffBalances.findOne({ where: { staff_id: id }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };

  await t.test('a wrong transaction password stops the write', async () => {
    const staff = await seedStaff(newStaffId(), { inr: '1000' });
    const player = await seedPlayer(newUid(), staff, '0');

    await assert.rejects(
      () => service.refill({
        actor: actorFor(staff), accountId: player, amount: '100',
        transactionPassword: 'not it',
      }),
      (err) => err.code === 'ACCOUNTS_TRANSACTION_PASSWORD_REQUIRED' && err.status === 403
    );

    assert.equal(await playerBalance(player), '0.00000000');
    assert.equal(await staffBalance(staff), '1000.00000000');
  });

  await t.test('a refill debits the operator and credits the player', async () => {
    const staff = await seedStaff(newStaffId(), { inr: '1000' });
    const player = await seedPlayer(newUid(), staff, '0');

    const result = await service.refill({
      actor: actorFor(staff), accountId: player, amount: '250',
      transactionPassword: TXN_PASSWORD,
    });

    assert.equal(result.balance, '250.00000000');
    assert.equal(result.issued, false);
    assert.equal(await staffBalance(staff), '750.00000000');
  });

  await t.test('a refill larger than the operator’s balance moves nothing', async () => {
    /**
     * Legacy read the balance with `FOR UPDATE` — inside a transaction opened
     * on the ONE shared client, so the lock was held on behalf of every
     * concurrent request and its scope was unknowable. The guarded UPDATE here
     * lets Postgres decide and the row count is the answer.
     */
    const staff = await seedStaff(newStaffId(), { inr: '100' });
    const player = await seedPlayer(newUid(), staff, '0');

    await assert.rejects(
      () => service.refill({
        actor: actorFor(staff), accountId: player, amount: '500',
        transactionPassword: TXN_PASSWORD,
      }),
      (err) => err.code === 'ACCOUNTS_INSUFFICIENT_FUNDS' && err.status === 402
    );

    assert.equal(await staffBalance(staff), '100.00000000');
    assert.equal(await playerBalance(player), '0.00000000');
  });

  await t.test('two simultaneous refills cannot overdraw', async () => {
    const staff = await seedStaff(newStaffId(), { inr: '100' });
    const a = await seedPlayer(newUid(), staff, '0');
    const b = await seedPlayer(newUid(), staff, '0');

    const results = await Promise.allSettled([
      service.refill({ actor: actorFor(staff), accountId: a, amount: '100', transactionPassword: TXN_PASSWORD }),
      service.refill({ actor: actorFor(staff), accountId: b, amount: '100', transactionPassword: TXN_PASSWORD }),
    ]);

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await staffBalance(staff), '0.00000000', 'never negative');
  });

  await t.test('the platform owner issues funds without a balance', async () => {
    const owner = await seedStaff(newStaffId(), { inr: '0' });
    const player = await seedPlayer(newUid(), owner, '0');

    const result = await service.refill({
      actor: actorFor(owner, { canIssueFunds: true, level: 0 }),
      accountId: player, amount: '5000', transactionPassword: TXN_PASSWORD,
    });

    assert.equal(result.issued, true);
    assert.equal(await playerBalance(player), '5000.00000000');
    assert.equal(await staffBalance(owner), '0.00000000');

    // And the transfer row says which it was.
    const row = await connection.models.StaffTransfers.findOne({
      where: { to_type: 'user', to_id: player }, order: [['id', 'DESC']], raw: true,
    });
    assert.equal(row.transfer_type, 'issuance');
  });

  await t.test('a refill above the ceiling is refused', async () => {
    // Legacy had no ceiling on a direct wallet credit.
    const owner = await seedStaff(newStaffId(), { inr: '0' });
    const player = await seedPlayer(newUid(), owner, '0');

    await assert.rejects(
      () => service.refill({
        actor: actorFor(owner, { canIssueFunds: true, level: 0 }),
        accountId: player, amount: '9999999', transactionPassword: TXN_PASSWORD,
      }),
      (err) => err.code === 'ACCOUNTS_REFILL_TOO_LARGE' && err.status === 422
    );
    assert.equal(await playerBalance(player), '0.00000000');
  });

  await t.test('a player outside the tree cannot be refilled', async () => {
    const staff = await seedStaff(newStaffId(), { inr: '1000' });
    const other = await seedStaff(newStaffId(), { inr: '0' });
    const theirPlayer = await seedPlayer(newUid(), other, '0');

    await assert.rejects(
      () => service.refill({
        actor: actorFor(staff), accountId: theirPlayer, amount: '50',
        transactionPassword: TXN_PASSWORD,
      }),
      (err) => err.code === 'ACCOUNTS_NOT_IN_YOUR_TREE' && err.status === 404
    );
    assert.equal(await staffBalance(staff), '1000.00000000');
  });

  await t.test('a password reset writes the hash and NOT the plaintext', async () => {
    /**
     * `UPDATE users SET password=$1, password2=$2` — the second is cleartext,
     * and legacy did it for both staff and players from this one endpoint.
     * Third and fourth occurrence of that column in the codebase.
     */
    const staff = await seedStaff(newStaffId());
    const player = await seedPlayer(newUid(), staff, '0');

    await service.setPassword({
      actor: actorFor(staff), accountType: 'user', accountId: player,
      newPassword: 'a brand new long password', transactionPassword: TXN_PASSWORD,
    });

    const row = await connection.models.Users.findByPk(player, { raw: true });
    assert.match(row.password, /^\$2[aby]\$/);
    assert.ok(!row.password2, 'password2 must stay empty');
  });

  await t.test('locks can be set together, and not on yourself', async () => {
    const staff = await seedStaff(newStaffId());
    const player = await seedPlayer(newUid(), staff, '0');

    await service.setStatus({
      actor: actorFor(staff), accountType: 'user', accountId: player,
      sportsLocked: true, casinoLocked: true, transactionPassword: TXN_PASSWORD,
    });

    const row = await connection.models.Users.findByPk(player, { raw: true });
    assert.equal(row.sports_betlocked, true);
    assert.equal(row.casino_locked, true);

    await assert.rejects(
      () => service.setStatus({
        actor: actorFor(staff), accountType: 'staff', accountId: staff,
        systemLocked: true, transactionPassword: TXN_PASSWORD,
      }),
      (err) => err.code === 'ACCOUNTS_CANNOT_ACT_ON_SELF'
    );
  });

  await t.test('the listing never carries a password column', async () => {
    // Legacy's `all-details` returned the whole row, `password2` included.
    const staff = await seedStaff(newStaffId());
    await seedPlayer(newUid(), staff, '100');

    const list = await service.allDetails({ actor: actorFor(staff) });
    for (const row of list.rows) {
      assert.equal(row.password, undefined);
      assert.equal(row.password2, undefined);
    }
    assert.ok(list.rows.length >= 1);
    assert.equal(list.rows[0].balance, 100);
    assert.equal(list.rows[0].account_type, 'USER');
  });

  await t.test('the listing is one level: direct agents, then own players', async () => {
    /**
     * The shape the admin panel's downline table is typed against. An earlier
     * port answered with every player anywhere below the caller and no agents
     * at all, so the table that exists to walk the tree had nothing to walk.
     */
    const parent = await seedStaff(newStaffId(), { inr: '5000' });
    const child = await seedStaff(newStaffId(), { inr: '1500', parentId: parent });
    const grandchild = await seedStaff(newStaffId(), { parentId: child });

    const ownPlayer = await seedPlayer(newUid(), parent, '250');
    await seedPlayer(newUid(), grandchild, '75');   // two levels down

    const list = await service.allDetails({ actor: actorFor(parent), limit: 25 });
    const ids = list.rows.map((r) => r.id);

    assert.deepEqual(ids, [child, ownPlayer]);
    assert.equal(list.total, 2);

    // The role NAME, not the id — the panel prints this column.
    const role = await connection.models.Roles.findByPk(roleId, { raw: true });

    const [agent, player] = list.rows;
    assert.equal(agent.account_type, 'STAFF');
    assert.equal(agent.username, `lords-staff-${child}`);
    assert.equal(agent.role, role.name);
    assert.equal(agent.balance, 1500);
    assert.equal(agent.has_downline, true);
    assert.equal(player.account_type, 'USER');
    assert.equal(player.role, 'User');
    assert.equal(player.has_downline, false);
  });

  await t.test('an agent’s P&L is the roll-up of its whole subtree, sign-flipped', async () => {
    // `users.gt` is the PLAYER's view. What the panel shows is the agent's, so
    // a player up 400 on sports is the agent 400 down.
    const parent = await seedStaff(newStaffId());
    const child = await seedStaff(newStaffId(), { parentId: parent });
    const grandchild = await seedStaff(newStaffId(), { parentId: child });

    const near = await seedPlayer(newUid(), child, '0');
    const far = await seedPlayer(newUid(), grandchild, '0');
    await connection.models.Users.update({ gt: '400', casino_gt: '-50' }, { where: { id: near } });
    await connection.models.Users.update({ gt: '100', casino_gt: '0' }, { where: { id: far } });

    const [agent] = (await service.allDetails({ actor: actorFor(parent) })).rows;

    assert.equal(agent.id, child);
    assert.equal(agent.sports_pnl, -500);   // both levels, negated
    assert.equal(agent.casino_pnl, 50);
  });

  await t.test('a parentId outside the caller’s tree is refused', async () => {
    // Legacy took `parentId` straight from the query and read whatever tree it
    // named — an agent could list another agent's entire downline.
    const mine = await seedStaff(newStaffId());
    const theirs = await seedStaff(newStaffId());

    await assert.rejects(
      () => service.allDetails({ actor: actorFor(mine), parentId: theirs }),
      (err) => err.code === 'ACCOUNTS_NOT_IN_YOUR_TREE' && err.status === 404
    );
  });

  await t.test('paging runs over agents and players as one list', async () => {
    /**
     * Legacy paged the halves independently — agents at the real offset,
     * players always at offset 0 — so page two repeated every player.
     */
    const parent = await seedStaff(newStaffId());
    const child = await seedStaff(newStaffId(), { parentId: parent });
    const first = await seedPlayer(newUid(), parent, '0');
    const second = await seedPlayer(newUid(), parent, '0');

    const page1 = await service.allDetails({ actor: actorFor(parent), limit: 2, offset: 0 });
    const page2 = await service.allDetails({ actor: actorFor(parent), limit: 2, offset: 2 });

    assert.deepEqual(page1.rows.map((r) => r.id), [child, first]);
    assert.deepEqual(page2.rows.map((r) => r.id), [second]);
    assert.equal(page2.total, 3);
  });
});
