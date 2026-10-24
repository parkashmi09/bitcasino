'use strict';

// These cases exercise the SEPARATE transaction password (`staff.transaction_password`);
// login mode (the default) is covered in staff-auth/__tests__/txnPasswordMode.test.js.
process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { StaffService } = require('../staff.service');
const v = require('../staff.validators');

/**
 * The staff hierarchy and the money that moves down it.
 *
 * `legacy/system/` is the best-written code in this platform — real token auth,
 * a closure table, an audit recorder on every write. What it still got wrong is
 * the transfer, and that is most of what is tested here.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

let nextStaffId = 700_000 + (process.pid % 1000) * 100;
const newStaffId = () => (nextStaffId += 1);

let nextUid = 860_000_000 + Math.floor(process.pid % 100_000) * 1000;
const newUid = () => (nextUid += 1);

/** Every seeded account's transaction password (plaintext is a supported legacy shape). */
const TXN = 'staff test txn password';

test('admin staff', async (t) => {
  const logger = createLogger({ name: 'staff-test', level: 'silent' });

  // ══════════════════════════════════════════════════════════════════════
  //  The schemas — no database needed
  // ══════════════════════════════════════════════════════════════════════

  await t.test('a transfer cannot name who pays', async () => {
    /**
     * There is no `fromId`. The payer is the authenticated actor on a deposit
     * and the named target on a withdrawal — derived from `direction`, never
     * supplied, so a caller cannot debit an account they do not control.
     */
    const parse = (body) => v.transfer.body.safeParse(body);
    assert.equal(parse({ toType: 'staff', toId: 5, amount: '100' }).success, true);
    assert.equal(parse({ toType: 'staff', toId: 5, amount: '100', fromId: 1 }).success, false);
  });

  await t.test('the amount is a string and must be positive', async () => {
    // Legacy compared `amount > bal` with `amount` straight from the body — a
    // float against a NUMERIC column, with no lower bound.
    const base = { toType: 'staff', toId: 5 };
    assert.equal(v.transfer.body.safeParse({ ...base, amount: 100 }).success, false);
    assert.equal(v.transfer.body.safeParse({ ...base, amount: '0' }).success, false);
    assert.equal(v.transfer.body.safeParse({ ...base, amount: '-5' }).success, false);
    assert.equal(v.transfer.body.safeParse({ ...base, amount: '100' }).success, true);
  });

  await t.test('changing your own password requires the current one', async () => {
    assert.equal(v.changePassword.body.safeParse({ newPassword: 'a'.repeat(12) }).success, false);
    assert.equal(
      v.changePassword.body.safeParse({ newPassword: 'a'.repeat(12), oldPassword: 'x' }).success,
      true
    );
    // A reset names a target and needs the permission the route checks.
    assert.equal(
      v.changePassword.body.safeParse({ newPassword: 'a'.repeat(12), targetId: 9 }).success,
      true
    );
  });

  // ══════════════════════════════════════════════════════════════════════
  //  Reading rows that carry more precision than the platform's scale
  //
  //  Every money column the module reads is bare `numeric` in the baseline,
  //  so real rows written by legacy's float arithmetic carry well past eight
  //  decimal places. The read paths validated them with `toMinor` — the INPUT
  //  parser — and returned `400 amount supports at most 8 decimal places` for
  //  the whole page rather than showing the stored value.
  // ══════════════════════════════════════════════════════════════════════

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

  const service = new StaffService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'admin-service' },
    clients: { admin: {} },
  });

  /**
   * One role per staff level, so the hierarchy rule (create and act only
   * strictly below your own level) has real levels to compare. A seeded
   * account defaults to level 3, or one below its parent.
   */
  const roleBase = 9500 + (process.pid % 100) * 10;
  const roleFor = (level) => roleBase + level;
  const levels = new Map();

  const ensureRole = async (level) => {
    await connection.sequelize.query(
      `INSERT INTO roles (id, name, level) VALUES (:id, :name, :level)
       ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level`,
      { replacements: { id: roleFor(level), name: `staff-test-role-${roleBase}-${level}`, level } }
    );
    return roleFor(level);
  };

  /** A staff account, optionally beneath another, with a balance. */
  const seedStaff = async (id, { parentId = null, inr = '0', level } = {}) => {
    const lvl = level ?? (parentId ? Math.min((levels.get(parentId) ?? 3) + 1, 7) : 3);
    const roleId = await ensureRole(lvl);
    levels.set(id, lvl);

    await connection.models.StaffHierarchy.destroy({
      where: { [require('sequelize').Op.or]: [{ ancestor_id: id }, { descendant_id: id }] },
    });
    // Ids repeat across runs (they derive from the pid), and a previous run may
    // have left accounts or players beneath this one. Detach them, or the
    // delete trips `staff_parent_id_fkey` / `users_parent_staff_id_fkey`.
    await connection.sequelize.query('UPDATE staff SET parent_id = NULL WHERE parent_id = :id', { replacements: { id } });
    await connection.sequelize.query('UPDATE users SET parent_staff_id = NULL WHERE parent_staff_id = :id', { replacements: { id } });
    await connection.models.StaffCredits.destroy({ where: { staff_id: id } });
    await connection.models.Staff.destroy({ where: { id } });

    await connection.models.Staff.create({
      id,
      name: `staff-${id}`,
      email: `staff-${id}@test.invalid`,
      password: 'x',
      role_id: roleId,
      parent_id: parentId,
      status: 'active',
      transaction_password: TXN,
    });
    await connection.models.StaffCredits.create({ staff_id: id, inr });

    // The closure table: self, plus every ancestor of the parent one deeper.
    const rows = [{ ancestor_id: id, descendant_id: id, depth: 0 }];
    if (parentId) {
      const ancestors = await connection.models.StaffHierarchy.findAll({
        where: { descendant_id: parentId },
        raw: true,
      });
      rows.push(
        ...ancestors.map((a) => ({
          ancestor_id: a.ancestor_id,
          descendant_id: id,
          depth: Number(a.depth) + 1,
        }))
      );
    }
    await connection.models.StaffHierarchy.bulkCreate(rows, { ignoreDuplicates: true });

    /**
     * Advance the sequence past the explicit id.
     *
     * `INSERT ... (id) VALUES (700123)` does not move `staff_id_seq`, so the
     * next insert that lets the default fire collides with a row that already
     * exists. This bites in production too, after any data import that
     * supplies its own ids — worth knowing, and worth the fixture not tripping
     * over it.
     */
    await connection.sequelize.query(
      `SELECT setval('staff_id_seq', GREATEST((SELECT MAX(id) FROM staff), 1))`
    );

    return id;
  };

  const seedPlayer = async (uid, staffId, inr = '0') => {
    await connection.models.Credits.destroy({ where: { uid } });
    await connection.models.Users.destroy({ where: { id: uid } });
    await connection.models.Users.create({
      id: uid, name: `player-${uid}`, password: 'x', status: 'active', parent_staff_id: staffId,
    });
    await connection.models.Credits.create({ uid, inr });
    return uid;
  };

  const staffBalance = async (id) => {
    const row = await connection.models.StaffCredits.findOne({ where: { staff_id: id }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };
  const playerBalance = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };

  const actorFor = (id, extra = {}) => ({
    // Not the owner, so every transfer here is the parent-to-DIRECT-child path
    // (the only one below the Super Admin); parentFunding.test.js covers its
    // rules in detail. These tests are about the guarded debit itself.
    id,
    level: levels.get(id) ?? 3,
    canResetOthers: false,
    canIssueFunds: false,
    canAdjustWallets: false,
    canCredit: true,
    canDebit: true,
    ...extra,
  });
  /** The platform owner: `wallet:adjust` + `canIssueFunds`, the only wide path. */
  const ownerActor = (id, extra = {}) =>
    actorFor(id, { level: 1, canIssueFunds: true, canAdjustWallets: true, ...extra });

  await t.test('a transfer down the tree moves money and records it', async () => {
    const boss = await seedStaff(newStaffId(), { inr: '1000' });
    const agent = await seedStaff(newStaffId(), { parentId: boss, inr: '0' });

    const result = await service.transfer({ transactionPassword: TXN,
      actor: actorFor(boss), toType: 'staff', toId: agent, amount: '250', direction: 'deposit',
    });

    assert.equal(await staffBalance(boss), '750.00000000');
    assert.equal(await staffBalance(agent), '250.00000000');
    assert.equal(result.amount, '250.00000000');
    assert.equal(result.direction, 'deposit');
  });

  await t.test('a transfer larger than the balance moves NOTHING', async () => {
    /**
     * Legacy read the balance without a lock, compared it in JavaScript, then
     * debited with `SET inr = inr - $1` and no `WHERE inr >= $1`. Here the
     * guarded UPDATE decides and its row count is the answer.
     */
    const boss = await seedStaff(newStaffId(), { inr: '100' });
    const agent = await seedStaff(newStaffId(), { parentId: boss, inr: '0' });

    await assert.rejects(
      () => service.transfer({ transactionPassword: TXN,
        actor: actorFor(boss), toType: 'staff', toId: agent, amount: '500', direction: 'deposit',
      }),
      (err) => err.code === 'INSUFFICIENT_FUNDS' && err.status === 422
    );

    assert.equal(await staffBalance(boss), '100.00000000');
    assert.equal(await staffBalance(agent), '0.00000000');
  });

  await t.test('two simultaneous transfers cannot overdraw', async () => {
    // Both would pass an unlocked read of a 100 balance. Only one can pass the
    // guarded UPDATE.
    const boss = await seedStaff(newStaffId(), { inr: '100' });
    const a = await seedStaff(newStaffId(), { parentId: boss });
    const b = await seedStaff(newStaffId(), { parentId: boss });

    const results = await Promise.allSettled([
      service.transfer({ transactionPassword: TXN, actor: actorFor(boss), toType: 'staff', toId: a, amount: '100', direction: 'deposit' }),
      service.transfer({ transactionPassword: TXN, actor: actorFor(boss), toType: 'staff', toId: b, amount: '100', direction: 'deposit' }),
    ]);

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await staffBalance(boss), '0.00000000', 'never negative');
  });

  await t.test('a withdrawal pulls money back UP from a descendant', async () => {
    const boss = await seedStaff(newStaffId(), { inr: '0' });
    const agent = await seedStaff(newStaffId(), { parentId: boss, inr: '400' });

    await service.transfer({ transactionPassword: TXN,
      actor: actorFor(boss), toType: 'staff', toId: agent, amount: '150', direction: 'withdraw',
    });

    assert.equal(await staffBalance(agent), '250.00000000');
    assert.equal(await staffBalance(boss), '150.00000000');
  });

  await t.test('a withdrawal a descendant cannot cover moves nothing', async () => {
    const boss = await seedStaff(newStaffId(), { inr: '0' });
    const agent = await seedStaff(newStaffId(), { parentId: boss, inr: '10' });

    await assert.rejects(
      () => service.transfer({ transactionPassword: TXN,
        actor: actorFor(boss), toType: 'staff', toId: agent, amount: '500', direction: 'withdraw',
      }),
      (err) => err.code === 'INSUFFICIENT_FUNDS' && err.status === 422
    );
    assert.equal(await staffBalance(agent), '10.00000000');
    assert.equal(await staffBalance(boss), '0.00000000');
  });

  await t.test('the owner funds its DIRECT child player from the owner wallet; a grandchild player is not in its tree', async () => {
    const owner = await seedStaff(newStaffId(), { inr: '500', level: 1 });
    const agent = await seedStaff(newStaffId(), { parentId: owner });
    // TENEXCH: direct children only — the owner too. A grandchild's player is not in its tree.
    const deep = await seedPlayer(newUid(), agent, '0');
    await assert.rejects(
      () => service.transfer({ transactionPassword: TXN, actor: ownerActor(owner), toType: 'user', toId: deep, amount: '75', direction: 'deposit' }),
      (err) => err.code === 'STAFF_PLAYER_NOT_IN_YOUR_TREE'
    );
    const player = await seedPlayer(newUid(), owner, '0');

    await service.transfer({ transactionPassword: TXN,
      actor: ownerActor(owner), toType: 'user', toId: player, amount: '75', direction: 'deposit',
    });

    assert.equal(await playerBalance(player), '75.00000000');
    // Migration 099: the owner's balance is in `credits` and a transfer draws on it.
    assert.equal(await staffBalance(owner), '425.00000000');
  });

  await t.test('a transfer to or from a player writes the player\'s ledger + history, so the wallet reconciles', async () => {
    const owner = await seedStaff(newStaffId(), { inr: '500', level: 1 });
    const player = await seedPlayer(newUid(), owner, '0');

    await service.transfer({ transactionPassword: TXN,
      actor: ownerActor(owner), toType: 'user', toId: player, amount: '75', direction: 'deposit',
    });
    await service.transfer({ transactionPassword: TXN,
      actor: ownerActor(owner), toType: 'user', toId: player, amount: '30', direction: 'withdraw',
    });

    const rows = await connection.models.CreditsLedger.findAll({ where: { user_id: String(player) }, order: [['id', 'ASC']], raw: true });
    assert.deepEqual(
      rows.map((r) => [r.reason, money.toDecimalString(money.toMinor(String(r.amount))), money.toDecimalString(money.toMinor(String(r.balance)))]),
      [['TRANSFER_IN', '75.00000000', '75.00000000'], ['TRANSFER_OUT', '-30.00000000', '45.00000000']]
    );
    assert.equal(rows[1].meta.previousBalance, '75.00000000');
    const sum = rows.reduce((a, r) => a + money.toMinor(String(r.amount)), 0n);
    assert.equal(money.toDecimalString(sum), await playerBalance(player), 'ledger sums to the wallet');
    assert.equal(await connection.models.WalletHistory.count({ where: { uid: player } }), 2);
    await connection.models.CreditsLedger.destroy({ where: { user_id: String(player) } });
    await connection.models.WalletHistory.destroy({ where: { uid: player } });
  });

  await t.test('an outside account cannot be transferred to', async () => {
    const boss = await seedStaff(newStaffId(), { inr: '1000' });
    const stranger = await seedStaff(newStaffId(), { inr: '0' });

    await assert.rejects(
      () => service.transfer({ transactionPassword: TXN,
        actor: actorFor(boss), toType: 'staff', toId: stranger, amount: '100', direction: 'deposit',
      }),
      (err) => err.code === 'STAFF_NOT_IN_YOUR_TREE' && err.status === 404
    );
    assert.equal(await staffBalance(boss), '1000.00000000');
  });

  await t.test('an Admin holding wallet:adjust is NOT the wide path: its own player yes, no grandchild', async () => {
    const admin = await seedStaff(newStaffId(), { inr: '1000', level: 2 });
    const sub = await seedStaff(newStaffId(), { parentId: admin, inr: '0' });
    const grandchild = await seedStaff(newStaffId(), { parentId: sub, inr: '0' });
    const player = await seedPlayer(newUid(), admin, '0');
    const actor = actorFor(admin, { canAdjustWallets: true });

    // TENEXCH: its DIRECT child player is a target of the same API, out of its own float.
    await service.transfer({ transactionPassword: TXN, actor, toType: 'user', toId: player, amount: '50', direction: 'deposit' });
    assert.equal(await playerBalance(player), '50.00000000');
    await service.transfer({ transactionPassword: TXN, actor, toType: 'user', toId: player, amount: '50', direction: 'withdraw' });
    await assert.rejects(
      () => service.transfer({ transactionPassword: TXN, actor, toType: 'staff', toId: grandchild, amount: '50', direction: 'deposit' }),
      (err) => err.code === 'STAFF_NOT_IN_YOUR_TREE' && err.status === 404
    );
    // Its direct child, out of its own float.
    await service.transfer({ transactionPassword: TXN, actor, toType: 'staff', toId: sub, amount: '50', direction: 'deposit' });
    assert.equal(await staffBalance(admin), '950.00000000');
    assert.equal(await staffBalance(sub), '50.00000000');
    assert.equal(await playerBalance(player), '0.00000000');
  });

  await t.test('the platform owner pays from its own wallet, and cannot give more than it holds', async () => {
    // Migration 099: the owner no longer mints here. It adds balance to its own
    // wallet first (Exchange > Owner wallet) and every transfer draws on it.
    const owner = await seedStaff(newStaffId(), { inr: '0' });
    const agent = await seedStaff(newStaffId(), { parentId: owner, inr: '0' });

    await assert.rejects(
      () => service.transfer({ transactionPassword: TXN,
        actor: ownerActor(owner), toType: 'staff', toId: agent, amount: '1000', direction: 'deposit',
      }),
      (err) => err.code === 'INSUFFICIENT_FUNDS' && err.status === 422
    );
    assert.equal(await staffBalance(agent), '0.00000000', 'nothing moved');

    await connection.models.StaffCredits.update({ inr: '1500' }, { where: { staff_id: owner } });
    await service.transfer({ transactionPassword: TXN,
      actor: ownerActor(owner), toType: 'staff', toId: agent, amount: '1000', direction: 'deposit',
    });
    assert.equal(await staffBalance(agent), '1000.00000000');
    assert.equal(await staffBalance(owner), '500.00000000');
  });

  // ── The tree ──────────────────────────────────────────────────────────

  await t.test('a created account lands in the closure table in the same transaction', async () => {
    // Legacy inserted the row and the hierarchy separately. A failure between
    // them left an account with no place in the tree — invisible to every
    // scoped query, including the ones that would have found it.
    const boss = await seedStaff(newStaffId(), { inr: '0' });

    const created = await service.create({
      actor: actorFor(boss),
      name: 'New Agent',
      email: `agent-${boss}@test.invalid`,
      password: 'correct horse battery',
      roleId: await ensureRole(4),
    });

    const rows = await connection.models.StaffHierarchy.findAll({
      where: { descendant_id: created.id },
      raw: true,
    });
    assert.ok(rows.some((r) => Number(r.ancestor_id) === Number(created.id) && Number(r.depth) === 0));
    assert.ok(rows.some((r) => Number(r.ancestor_id) === Number(boss) && Number(r.depth) === 1));

    await connection.models.Staff.destroy({ where: { id: created.id } });
  });

  await t.test('a created account stores only the hash, never the plaintext', async () => {
    // `UPDATE staff SET password=$1, password2=$2` — the second is cleartext.
    const boss = await seedStaff(newStaffId());
    const created = await service.create({
      actor: actorFor(boss),
      name: 'Hash Only',
      email: `hash-${boss}@test.invalid`,
      password: 'correct horse battery',
      roleId: await ensureRole(4),
    });

    const row = await connection.models.Staff.findByPk(created.id, { raw: true });
    assert.match(row.password, /^\$2[aby]\$/, 'a bcrypt hash');
    assert.equal(row.password2, null, 'password2 must stay NULL');

    await connection.models.Staff.destroy({ where: { id: created.id } });
  });

  // ── The hierarchy rule: create and act only strictly below your level ──

  const PASSWORD = 'correct horse battery';
  const make = (actor, roleLevel, extra = {}) =>
    ensureRole(roleLevel).then((roleId) =>
      service.create({
        actor,
        name: `made-${actor.id}-${roleLevel}-${newStaffId()}`,
        email: `made-${actor.id}-${roleLevel}-${newStaffId()}@test.invalid`,
        password: PASSWORD,
        roleId,
        ...extra,
      })
    );
  const cleanup = (...ids) => connection.models.Staff.destroy({ where: { id: ids } });
  const refusedLevel = (err) => err.code === 'STAFF_LEVEL_NOT_BELOW' && err.status === 403;
  const refusedSkip = (err) => err.code === 'STAFF_LEVEL_NOT_DIRECT_CHILD' && err.status === 403 && /directly below your own/.test(err.message);

  await t.test('an Admin cannot create a Super Admin, nor another Admin', async () => {
    const admin = await seedStaff(newStaffId(), { level: 2 });

    await assert.rejects(() => make(actorFor(admin), 1), refusedLevel);
    await assert.rejects(() => make(actorFor(admin), 2), refusedLevel);

    const sub = await make(actorFor(admin), 3);
    assert.equal(Number(sub.parentId), admin);
    await cleanup(sub.id);
  });

  await t.test('each level creates ONLY the level directly below it (CHILD_LEVELS)', async () => {
    const admin = await seedStaff(newStaffId(), { level: 2 });
    await assert.rejects(() => make(actorFor(admin), 4), refusedSkip, 'an Admin does not skip to Super Master');

    const sub = await seedStaff(newStaffId(), { parentId: admin, level: 3 });
    await assert.rejects(() => make(actorFor(sub), 3), refusedLevel, 'not a peer');
    await assert.rejects(() => make(actorFor(sub), 5), refusedSkip, 'a Sub Admin does not skip to Master');
    const smMade = await make(actorFor(sub), 4);
    assert.equal(Number(smMade.parentId), sub);

    const sm = await seedStaff(newStaffId(), { level: 4 });
    await assert.rejects(() => make(actorFor(sm), 4), refusedLevel, 'not a peer');
    await assert.rejects(() => make(actorFor(sm), 3), refusedLevel, 'not upwards');
    await assert.rejects(() => make(actorFor(sm), 6), refusedSkip, 'a Super Master does not skip to Agent');

    const master = await make(actorFor(sm), 5);
    levels.set(Number(master.id), 5);

    await assert.rejects(() => make(actorFor(master.id), 5), refusedLevel);
    await assert.rejects(() => make(actorFor(master.id), 4), refusedLevel);
    const agentOfMaster = await make(actorFor(master.id), 6);
    assert.equal(Number(agentOfMaster.parentId), Number(master.id));
    levels.set(Number(agentOfMaster.id), 6);

    // An agent creates players only.
    await assert.rejects(() => make(actorFor(agentOfMaster.id), 7));
    await assert.rejects(() => make(actorFor(agentOfMaster.id), 6), refusedLevel);

    await cleanup(agentOfMaster.id, master.id, smMade.id);
  });

  await t.test('the Super Admin creates any level, under itself or a descendant', async () => {
    const owner = await seedStaff(newStaffId(), { level: 1 });
    const sm = await seedStaff(newStaffId(), { parentId: owner, level: 4 });
    const master = await seedStaff(newStaffId(), { parentId: sm, level: 5 });

    const admin = await make(ownerActor(owner), 2);
    const agentDirect = await make(ownerActor(owner), 6);
    const agent = await make(ownerActor(owner), 6, { parentId: master });
    assert.equal(Number(agent.parentId), master);
    const closure = await connection.models.StaffHierarchy.findAll({ where: { descendant_id: agent.id }, raw: true });
    assert.ok(closure.some((r) => Number(r.ancestor_id) === sm && Number(r.depth) === 2), 'grandparent row');

    // Still strictly below the parent it hangs from.
    await assert.rejects(() => make(ownerActor(owner), 5, { parentId: master }), refusedLevel);

    await cleanup(agent.id, agentDirect.id, admin.id);
  });

  await t.test('below the Super Admin, a create under a descendant must be that parent\'s direct child level', async () => {
    const sm = await seedStaff(newStaffId(), { level: 4 });
    const master = await seedStaff(newStaffId(), { parentId: sm, level: 5 });
    const stranger = await seedStaff(newStaffId(), { level: 5 });

    // A Super Master's child level is Master; Agent under its master is refused.
    await assert.rejects(() => make(actorFor(sm), 6, { parentId: master }), refusedSkip);
    await assert.rejects(() => make(actorFor(sm), 5, { parentId: master }), refusedLevel);
    await assert.rejects(
      () => make(actorFor(sm), 5, { parentId: stranger }),
      (err) => err.code === 'STAFF_NOT_IN_YOUR_TREE'
    );
  });

  await t.test('an Executive (role 7) is never created or re-levelled through /admin/staff', async () => {
    const owner = await seedStaff(newStaffId(), { level: 1 });
    const sm = await seedStaff(newStaffId(), { level: 4 });
    const notPermitted = (err) => err.code === 'STAFF_NOT_PERMITTED' && err.status === 403;

    await assert.rejects(() => make(actorFor(sm), 7), notPermitted);
    await assert.rejects(() => make(ownerActor(owner), 7), notPermitted);
  });

  await t.test('an unknown role is refused', async () => {
    const admin = await seedStaff(newStaffId(), { level: 2 });
    await assert.rejects(
      () => service.create({
        actor: actorFor(admin), name: 'x', email: `x-${admin}@test.invalid`, password: PASSWORD, roleId: 2_000_000_000,
      }),
      (err) => err.code === 'STAFF_UNKNOWN_ROLE'
    );
  });

  // ── First sign-in: a password somebody else chose ─────────────────────

  const mustChange = async (id) =>
    (await connection.models.Staff.findByPk(id, { attributes: ['must_change_password'], raw: true }))
      .must_change_password;

  await t.test("a created account keeps its creator's password; a superior's reset forces a change", async () => {
    const boss = await seedStaff(newStaffId(), { level: 3 });
    const created = await make(actorFor(boss), 4);
    assert.equal(await mustChange(created.id), false);

    await service.changePassword({
      actor: { id: created.id, level: 4 }, oldPassword: PASSWORD, newPassword: 'another long password',
    });
    assert.equal(await mustChange(created.id), false);

    // A superior's reset sets it again — they know the password now.
    await service.changePassword({
      actor: actorFor(boss, { canResetOthers: true }), targetId: created.id, newPassword: 'reset by the boss!!',
    });
    assert.equal(await mustChange(created.id), true);

    // Neither the create, the own change nor the reset left a cleartext copy.
    const row = await connection.models.Staff.findByPk(created.id, { attributes: ['password', 'password2'], raw: true });
    assert.match(row.password, /^\$2[aby]\$/);
    assert.equal(row.password2, null, 'password2 must stay NULL');
    await cleanup(created.id);
  });

  await t.test('a session that must change its password cannot reset anyone else', async () => {
    const boss = await seedStaff(newStaffId(), { level: 3 });
    const agent = await seedStaff(newStaffId(), { parentId: boss, level: 4 });
    await assert.rejects(
      () => service.changePassword({
        actor: actorFor(boss, { canResetOthers: true, mustChangePassword: true }),
        targetId: agent,
        newPassword: PASSWORD,
      }),
      (err) => err.code === 'STAFF_PASSWORD_CHANGE_REQUIRED' && err.status === 403
    );
  });

  // ── Suspension cascades like the system lock ─────────────────────────

});
