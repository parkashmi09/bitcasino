'use strict';

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

  await t.test('a bulk status change is bounded', async () => {
    const ids = (n) => Array.from({ length: n }, (_, i) => i + 1);
    assert.equal(v.bulkStatus.body.safeParse({ ids: ids(500), status: 'active' }).success, true);
    assert.equal(v.bulkStatus.body.safeParse({ ids: ids(501), status: 'active' }).success, false);
    assert.equal(v.bulkStatus.body.safeParse({ ids: [], status: 'active' }).success, false);
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

  await t.test('an update naming nothing is refused', async () => {
    // Legacy built its SET clause from whichever fields were present.
    assert.equal(v.updateStaff.body.safeParse({}).success, false);
    assert.equal(v.updateStaff.body.safeParse({ name: 'New' }).success, true);
  });

  await t.test('?includeSubtree=false does not ask for the subtree', async () => {
    // `z.coerce.boolean()` maps every non-empty string to `true`, so the
    // explicit `false` used to widen the rollup from one account's balance to
    // the whole branch's.
    const parse = (query) => v.rollup.query.parse(query);
    assert.equal(parse({}).includeSubtree, false);
    assert.equal(parse({ includeSubtree: 'false' }).includeSubtree, false);
    assert.equal(parse({ includeSubtree: 'true' }).includeSubtree, true);
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

  await t.test('an over-precise stored balance does not 400 the read paths', async () => {
    const OVER_PRECISE = '-182800.00000000000206';
    const actor = { id: 1, level: 0, canResetOthers: true, canIssueFunds: true };

    const service = new StaffService({
      logger,
      models: {
        // `descendantIds` walks this; one root and no children.
        Staff: {
          findAll: async () => [],
          count: async () => 1,
          findByPk: async () => ({ id: 1, name: 'Root', email: 'r@x.io', role_id: 1, status: 'active' }),
        },
        // `transfers()` resolves counterparty names for the page it returns.
        Users: { count: async () => 0, findAll: async () => [] },
        StaffBalances: {
          findAll: async () => [{ staff_id: 1, inr: OVER_PRECISE }],
          findOne: async () => ({ staff_id: 1, inr: OVER_PRECISE, credit_limit: OVER_PRECISE }),
        },
        StaffTransfers: {
          findAll: async () => [{ direction: 'deposit', count: '2', total: OVER_PRECISE }],
          findAndCountAll: async () => ({
            count: 1,
            rows: [{ id: 9, from_type: 'staff', from_id: 1, to_type: 'user', to_id: 2, amount: OVER_PRECISE }],
          }),
        },
      },
    });

    // Quantised to the platform's scale, not rejected and not silently zeroed.
    const quantised = money.fromStored(OVER_PRECISE);
    assert.equal(quantised, '-182800.00000000');

    assert.equal((await service.rollup({ actor, staffId: 1 })).balance, quantised);
    assert.equal((await service.transferSummary({ actor })).at(0).total, quantised);
    assert.equal((await service.transfers({ actor })).rows.at(0).amount, quantised);
    assert.equal((await service.getById({ actor, staffId: 1 })).balance.inr, quantised);
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

  const service = new StaffService({
    models: connection.models,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'admin-service' },
    clients: { admin: {} },
  });

  const roleId = 9500 + (process.pid % 100);

  /** A staff account, optionally beneath another, with a balance. */
  const seedStaff = async (id, { parentId = null, inr = '0' } = {}) => {
    await connection.sequelize.query(
      `INSERT INTO roles (id, name, level) VALUES (:roleId, :name, 3) ON CONFLICT (id) DO NOTHING`,
      { replacements: { roleId, name: `staff-test-role-${roleId}` } }
    );

    await connection.models.StaffHierarchy.destroy({
      where: { [require('sequelize').Op.or]: [{ ancestor_id: id }, { descendant_id: id }] },
    });
    await connection.models.StaffBalances.destroy({ where: { staff_id: id } });
    await connection.models.Staff.destroy({ where: { id } });

    await connection.models.Staff.create({
      id,
      name: `staff-${id}`,
      email: `staff-${id}@test.invalid`,
      password: 'x',
      role_id: roleId,
      parent_id: parentId,
      status: 'active',
    });
    await connection.models.StaffBalances.create({ staff_id: id, inr });

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
    const row = await connection.models.StaffBalances.findOne({ where: { staff_id: id }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };
  const playerBalance = async (uid) => {
    const row = await connection.models.Credits.findOne({ where: { uid }, raw: true });
    return money.toDecimalString(money.toMinor(row?.inr ?? '0'));
  };

  const actorFor = (id, extra = {}) => ({ id, level: 3, canResetOthers: false, canIssueFunds: false, ...extra });

  await t.test('a transfer down the tree moves money and records it', async () => {
    const boss = await seedStaff(newStaffId(), { inr: '1000' });
    const agent = await seedStaff(newStaffId(), { parentId: boss, inr: '0' });

    const result = await service.transfer({
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
      () => service.transfer({
        actor: actorFor(boss), toType: 'staff', toId: agent, amount: '500', direction: 'deposit',
      }),
      (err) => err.code === 'STAFF_INSUFFICIENT_FUNDS' && err.status === 402
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
      service.transfer({ actor: actorFor(boss), toType: 'staff', toId: a, amount: '100', direction: 'deposit' }),
      service.transfer({ actor: actorFor(boss), toType: 'staff', toId: b, amount: '100', direction: 'deposit' }),
    ]);

    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await staffBalance(boss), '0.00000000', 'never negative');
  });

  await t.test('a withdrawal pulls money back UP from a descendant', async () => {
    const boss = await seedStaff(newStaffId(), { inr: '0' });
    const agent = await seedStaff(newStaffId(), { parentId: boss, inr: '400' });

    await service.transfer({
      actor: actorFor(boss), toType: 'staff', toId: agent, amount: '150', direction: 'withdraw',
    });

    assert.equal(await staffBalance(agent), '250.00000000');
    assert.equal(await staffBalance(boss), '150.00000000');
  });

  await t.test('a withdrawal a descendant cannot cover moves nothing', async () => {
    const boss = await seedStaff(newStaffId(), { inr: '0' });
    const agent = await seedStaff(newStaffId(), { parentId: boss, inr: '10' });

    await assert.rejects(
      () => service.transfer({
        actor: actorFor(boss), toType: 'staff', toId: agent, amount: '500', direction: 'withdraw',
      }),
      (err) => err.code === 'STAFF_INSUFFICIENT_FUNDS'
    );
    assert.equal(await staffBalance(agent), '10.00000000');
    assert.equal(await staffBalance(boss), '0.00000000');
  });

  await t.test('money can move to a player under the tree', async () => {
    const boss = await seedStaff(newStaffId(), { inr: '500' });
    const agent = await seedStaff(newStaffId(), { parentId: boss });
    const player = await seedPlayer(newUid(), agent, '0');

    await service.transfer({
      actor: actorFor(boss), toType: 'user', toId: player, amount: '75', direction: 'deposit',
    });

    assert.equal(await playerBalance(player), '75.00000000');
    assert.equal(await staffBalance(boss), '425.00000000');
  });

  await t.test('an account outside the tree cannot be transferred to', async () => {
    const boss = await seedStaff(newStaffId(), { inr: '1000' });
    const stranger = await seedStaff(newStaffId(), { inr: '0' });

    await assert.rejects(
      () => service.transfer({
        actor: actorFor(boss), toType: 'staff', toId: stranger, amount: '100', direction: 'deposit',
      }),
      (err) => err.code === 'STAFF_NOT_IN_YOUR_TREE' && err.status === 404
    );
    assert.equal(await staffBalance(boss), '1000.00000000');
  });

  await t.test('a player under a DIFFERENT tree cannot be transferred to', async () => {
    const boss = await seedStaff(newStaffId(), { inr: '1000' });
    const other = await seedStaff(newStaffId(), { inr: '0' });
    const theirPlayer = await seedPlayer(newUid(), other, '0');

    await assert.rejects(
      () => service.transfer({
        actor: actorFor(boss), toType: 'user', toId: theirPlayer, amount: '50', direction: 'deposit',
      }),
      (err) => err.code === 'STAFF_PLAYER_NOT_IN_YOUR_TREE'
    );
    assert.equal(await playerBalance(theirPlayer), '0.00000000');
  });

  await t.test('the platform owner issues funds, and it is logged as issuance', async () => {
    // Legacy expressed this as `req.staff.level !== 0` in the middle of the
    // handler. It is an explicit capability here, and the debit is skipped
    // rather than silently succeeding against a balance of zero.
    const owner = await seedStaff(newStaffId(), { inr: '0' });
    const agent = await seedStaff(newStaffId(), { parentId: owner, inr: '0' });

    await service.transfer({
      actor: actorFor(owner, { canIssueFunds: true, level: 0 }),
      toType: 'staff', toId: agent, amount: '1000', direction: 'deposit',
    });

    assert.equal(await staffBalance(agent), '1000.00000000');
    assert.equal(await staffBalance(owner), '0.00000000', 'the owner draws on nothing');
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
      roleId,
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
      roleId,
    });

    const row = await connection.models.Staff.findByPk(created.id, { raw: true });
    assert.match(row.password, /^\$2[aby]\$/, 'a bcrypt hash');
    assert.ok(!row.password2, 'password2 must stay empty');

    await connection.models.Staff.destroy({ where: { id: created.id } });
  });

  await t.test('an account with descendants cannot be deleted', async () => {
    // Legacy deleted the row and left the subtree pointing at a parent that no
    // longer existed — those accounts then belonged to no tree at all.
    const boss = await seedStaff(newStaffId());
    const agent = await seedStaff(newStaffId(), { parentId: boss });
    const sub = await seedStaff(newStaffId(), { parentId: agent });

    // `agent` has `sub` beneath it, so it cannot go.
    await assert.rejects(
      () => service.remove({ actor: actorFor(boss), staffId: agent }),
      (err) => err.code === 'STAFF_CANNOT_DELETE_WITH_DESCENDANTS' && err.status === 409
    );

    // The leaf can. Deleting it then frees the one above.
    await service.remove({ actor: actorFor(boss), staffId: sub });
    const gone = await connection.models.Staff.findByPk(sub, { raw: true });
    assert.equal(gone, null);

    await service.remove({ actor: actorFor(boss), staffId: agent });
    assert.equal(await connection.models.Staff.findByPk(agent, { raw: true }), null);
  });

  await t.test('deleting an account removes its hierarchy rows too', async () => {
    // Otherwise the closure table keeps naming an id that no longer exists,
    // and every scoped query silently widens to include a ghost.
    const boss = await seedStaff(newStaffId());
    const agent = await seedStaff(newStaffId(), { parentId: boss });

    await service.remove({ actor: actorFor(boss), staffId: agent });

    const { Op } = require('sequelize');
    const left = await connection.models.StaffHierarchy.count({
      where: { [Op.or]: [{ ancestor_id: agent }, { descendant_id: agent }] },
    });
    assert.equal(left, 0);
  });

  await t.test('an account cannot delete itself', async () => {
    const boss = await seedStaff(newStaffId());
    await assert.rejects(
      () => service.remove({ actor: actorFor(boss), staffId: boss }),
      (err) => err.code === 'STAFF_NOT_PERMITTED'
    );
  });

  await t.test('an account holding a balance cannot be deleted', async () => {
    const boss = await seedStaff(newStaffId());
    const agent = await seedStaff(newStaffId(), { parentId: boss, inr: '25' });

    await assert.rejects(
      () => service.remove({ actor: actorFor(boss), staffId: agent }),
      (err) => err.code === 'STAFF_CANNOT_DELETE_WITH_BALANCE' && err.status === 409
    );
  });

  await t.test('the tree shows descendants and stops at the caller', async () => {
    const boss = await seedStaff(newStaffId());
    const agent = await seedStaff(newStaffId(), { parentId: boss });
    const sub = await seedStaff(newStaffId(), { parentId: agent });
    const stranger = await seedStaff(newStaffId());

    const tree = await service.tree({ actor: actorFor(agent) });
    const flat = [];
    const walk = (nodes) => nodes.forEach((n) => { flat.push(Number(n.id)); walk(n.children); });
    walk(tree);

    assert.ok(flat.includes(agent));
    assert.ok(flat.includes(sub));
    assert.ok(!flat.includes(boss), 'an agent does not see upwards');
    assert.ok(!flat.includes(stranger));
  });

  await t.test('a listing never carries a password column', async () => {
    const boss = await seedStaff(newStaffId());
    const list = await service.list({ actor: actorFor(boss) });
    for (const row of list.rows) {
      assert.equal(row.password, undefined);
      assert.equal(row.password2, undefined);
    }
  });

  await t.test('an account cannot change its own status in bulk', async () => {
    const boss = await seedStaff(newStaffId());
    await assert.rejects(
      () => service.bulkStatus({ actor: actorFor(boss), ids: [boss], status: 'suspended' }),
      (err) => err.code === 'STAFF_NOT_PERMITTED'
    );
  });

  await t.test('the transfer history is reachable and scoped', async () => {
    // `GET /api/staff/transactions` was shadowed by `/:id` and never ran.
    const boss = await seedStaff(newStaffId(), { inr: '500' });
    const agent = await seedStaff(newStaffId(), { parentId: boss });
    await service.transfer({
      actor: actorFor(boss), toType: 'staff', toId: agent, amount: '100', direction: 'deposit',
    });

    const history = await service.transfers({ actor: actorFor(boss) });
    assert.ok(history.total >= 1);
    assert.equal(history.rows[0].amount, '100.00000000');

    const summary = await service.transferSummary({ actor: actorFor(boss) });
    assert.ok(summary.some((s) => s.direction === 'deposit'));
  });
});
