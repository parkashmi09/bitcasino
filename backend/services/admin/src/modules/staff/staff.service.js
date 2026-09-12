'use strict';

const { Op, fn, col, literal } = require('sequelize');
const { hashPassword, verifyPassword } = require('@ibitplay/auth');
const { money } = require('@ibitplay/common');

const errors = require('./staff.errors');
const { TRANSFER_DIRECTION, TARGET_TYPE, BALANCE_CURRENCY, PASSWORD_ROUNDS } = require('./staff.constants');
const { descendantIds } = require('../staff-directory/staffDirectory.service');

/**
 * Staff accounts, the players beneath them, and transfers down the tree.
 *
 * The hierarchy is a closure table (`staff_hierarchy`), so "everyone under me"
 * is one indexed read rather than a recursive query per request — legacy got
 * that part right and it is kept.
 */
class StaffService {
  constructor({ models, db, logger, config, clients }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
    this.clients = clients;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /api/staff/tree */
  async tree({ actor }) {
    const ids = await this.#visibleStaffIds(actor);

    const rows = await this.models.Staff.findAll({
      where: { id: ids },
      attributes: ['id', 'name', 'email', 'parent_id', 'role_id', 'status', 'percentage'],
      order: [['id', 'ASC']],
      raw: true,
    });

    const byId = new Map(rows.map((s) => [Number(s.id), { ...this.#shapeStaff(s), children: [] }]));

    const roots = [];
    for (const node of byId.values()) {
      const parent = node.parentId != null ? byId.get(Number(node.parentId)) : null;
      // A node whose parent is outside the visible set is a root of THIS view,
      // which is what a subtree looks like from partway down.
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  /** @legacy GET /api/staff */
  async list({ actor, search, status, limit = 50, offset = 0 }) {
    const ids = await this.#visibleStaffIds(actor);

    const { rows, count } = await this.models.Staff.findAndCountAll({
      where: {
        id: ids,
        ...(status ? { status } : {}),
        ...(search
          ? {
              [Op.or]: [
                { name: { [Op.iLike]: `%${search}%` } },
                { email: { [Op.iLike]: `%${search}%` } },
              ],
            }
          : {}),
      },
      attributes: ['id', 'name', 'email', 'phone', 'country', 'parent_id', 'role_id', 'status', 'percentage'],
      order: [['id', 'ASC']],
      limit,
      offset,
      raw: true,
    });

    return { total: count, rows: rows.map((s) => this.#shapeStaff(s)) };
  }

  /** @legacy GET /api/staff/:id */
  async getById({ actor, staffId }) {
    await this.#assertVisible(actor, staffId);

    const row = await this.models.Staff.findByPk(staffId, {
      attributes: ['id', 'name', 'email', 'phone', 'country', 'parent_id', 'role_id', 'status', 'percentage'],
      raw: true,
    });
    if (!row) throw errors.NOT_FOUND({ staffId });

    const balance = await this.models.StaffBalances.findOne({ where: { staff_id: staffId }, raw: true });
    return { ...this.#shapeStaff(row), balance: this.#shapeBalance(balance) };
  }

  /** @legacy GET /api/staff/players */
  async listPlayers({ actor, search, limit = 50, offset = 0 }) {
    const ids = await this.#visibleStaffIds(actor);

    const { rows, count } = await this.models.Users.findAndCountAll({
      where: {
        parent_staff_id: ids,
        ...(search ? { name: { [Op.iLike]: `%${search}%` } } : {}),
      },
      attributes: ['id', 'name', 'email', 'status', 'parent_staff_id', 'sports_betlocked', 'casino_locked'],
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return {
      total: count,
      rows: rows.map((u) => ({
        id: u.id,
        name: u.name,
        // Deliberately not the password hash. Legacy's player listing selected
        // the whole row.
        email: u.email,
        status: u.status,
        staffId: u.parent_staff_id,
        sportsLocked: Boolean(u.sports_betlocked),
        casinoLocked: Boolean(u.casino_locked),
      })),
    };
  }

  /**
   * @legacy GET /api/staff/:id/percent-chain
   *
   * The commission chain from the root down to this account — who takes what
   * share of what this account generates.
   */
  async percentChain({ actor, staffId }) {
    await this.#assertVisible(actor, staffId);

    // `depth` here is distance UP from the requested account: 0 is the account
    // itself, 1 its parent, 2 its grandparent. Ordered root-first.
    const ancestors = await this.models.StaffHierarchy.findAll({
      where: { descendant_id: staffId },
      attributes: ['ancestor_id', 'depth'],
      order: [['depth', 'DESC']],
      raw: true,
    });

    const rows = await this.models.Staff.findAll({
      where: { id: ancestors.map((a) => a.ancestor_id) },
      attributes: ['id', 'name', 'parent_id', 'role_id', 'percentage'],
      raw: true,
    });
    const byId = new Map(rows.map((s) => [Number(s.id), s]));
    const roles = await this.#rolesById(rows.map((s) => s.role_id));

    return ancestors
      .map((a) => ({ staff: byId.get(Number(a.ancestor_id)), depth: Number(a.depth) }))
      .filter((a) => a.staff)
      .map(({ staff, depth }) => this.#shapePercentNode(staff, depth, roles));
  }

  /** @legacy GET /api/staff/:id/percent-tree */
  async percentTree({ actor, staffId }) {
    await this.#assertVisible(actor, staffId);

    const root = Number(staffId);
    const ids = await descendantIds(this.models, staffId, { logger: this.logger });
    const rows = await this.models.Staff.findAll({
      where: { id: ids },
      attributes: ['id', 'name', 'parent_id', 'role_id', 'percentage'],
      order: [['id', 'ASC']],
      raw: true,
    });

    const roles = await this.#rolesById(rows.map((s) => s.role_id));
    const depths = this.#subtreeDepths(root, rows);

    return rows
      .map((s) => this.#shapePercentNode(s, depths.get(Number(s.id)) ?? null, roles))
      .sort((a, b) => (a.depth ?? Infinity) - (b.depth ?? Infinity) || a.id - b.id);
  }

  /**
   * Depth of every row measured from `root`, which is depth 0 — this is a
   * SUBTREE view, so an account partway down the ladder sees itself at the top
   * rather than carrying the absolute depth it has in the full hierarchy.
   *
   * Walked level by level off `parent_id` rather than read from
   * `staff_hierarchy`, because the id set came from the same walk: anything the
   * closure table disagrees about would show up here as a null depth.
   */
  #subtreeDepths(root, rows) {
    const childrenOf = new Map();
    for (const s of rows) {
      if (s.parent_id == null) continue;
      const parent = Number(s.parent_id);
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent).push(Number(s.id));
    }

    const depths = new Map([[root, 0]]);
    let frontier = [root];
    let depth = 0;
    while (frontier.length) {
      depth += 1;
      const next = [];
      for (const id of frontier) {
        for (const child of childrenOf.get(id) || []) {
          // Already-seen means a cycle in `parent_id`; keep the shallower depth
          // and stop rather than loop, same stance as the walk that built `rows`.
          if (depths.has(child)) continue;
          depths.set(child, depth);
          next.push(child);
        }
      }
      frontier = next;
    }
    return depths;
  }

  async #rolesById(roleIds) {
    const ids = [...new Set(roleIds.filter((id) => id != null).map(Number))];
    if (!ids.length) return new Map();

    const rows = await this.models.Roles.findAll({
      where: { id: ids },
      attributes: ['id', 'name', 'level'],
      raw: true,
    });
    return new Map(rows.map((r) => [Number(r.id), r]));
  }

  /**
   * The percentage views name the role and its ladder position instead of a
   * bare `role_id`, and key the parent as `parent_id`, because they render a
   * tree the client has to reassemble and colour without a second lookup.
   *
   * `role` is the CLOSED-UP name — `Super Master`, as the `roles` table spells
   * it, comes back as `SuperMaster`. The colour and hierarchy tables on the
   * client are all keyed that way, so sending the spaced name matched only the
   * one-word roles (`Master`, `Agent`) and dropped every other node to the
   * fallback colour.
   */
  #shapePercentNode(staff, depth, roles) {
    const role = roles.get(Number(staff.role_id));
    return {
      id: Number(staff.id),
      name: staff.name,
      percentage: staff.percentage != null ? Number(staff.percentage) : null,
      role: role?.name ? String(role.name).replace(/[\s_-]+/g, '') : null,
      level: role?.level ?? null,
      parent_id: staff.parent_id ?? null,
      depth,
    };
  }

  /**
   * @legacy GET /api/staff/transactions
   * @legacy GET /api/staff/transfers/:id?
   *
   *   `GET /api/staff/transactions` WAS UNREACHABLE. It is declared at line 97
   *   of `system/routes/staff.js`, after `router.get('/:id')` at line 84 —
   *   Express matches in order, so the request hit `getById` with
   *   `id = 'transactions'` and never arrived here.
   */
  async transfers({ actor, staffId, direction, from, to, limit = 50, offset = 0 }) {
    const ids = await this.#visibleStaffIds(actor);
    const scope = staffId ? [await this.#assertVisible(actor, staffId)] : ids;

    const { rows, count } = await this.models.StaffTransfers.findAndCountAll({
      where: {
        [Op.or]: [
          { from_type: TARGET_TYPE.STAFF, from_id: scope },
          { to_type: TARGET_TYPE.STAFF, to_id: scope },
        ],
        ...(direction ? { direction } : {}),
        ...this.#dateRange(from, to),
      },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return { total: count, rows: await this.#withCounterpartyNames(rows) };
  }

  /**
   * Resolve the account names on a page of transfers.
   *
   * The rows carry `(from_type, from_id)` and `(to_type, to_id)` and nothing
   * else — an operator reading the list sees "Staff #12 paid User #4471",
   * which is not a sentence anybody can audit. Two batched lookups per page,
   * not one per row: a 50-row page resolved lazily is 100 round trips.
   */
  async #withCounterpartyNames(rows) {
    const idsOfType = (type) => [
      ...new Set(
        rows.flatMap((r) => [
          r.from_type === type ? Number(r.from_id) : null,
          r.to_type === type ? Number(r.to_id) : null,
        ]).filter((id) => Number.isFinite(id))
      ),
    ];

    const staffIds = idsOfType(TARGET_TYPE.STAFF);
    const userIds = idsOfType(TARGET_TYPE.USER);

    const [staff, users] = await Promise.all([
      staffIds.length
        ? this.models.Staff.findAll({ where: { id: staffIds }, attributes: ['id', 'name'], raw: true })
        : [],
      userIds.length
        ? this.models.Users.findAll({ where: { id: userIds }, attributes: ['id', 'name'], raw: true })
        : [],
    ]);

    const names = {
      [TARGET_TYPE.STAFF]: new Map(staff.map((s) => [String(s.id), s.name ?? null])),
      [TARGET_TYPE.USER]: new Map(users.map((u) => [String(u.id), u.name ?? null])),
    };

    // A deleted counterparty stays `null` rather than dropping the row: the
    // transfer happened, and the money it moved still has to appear.
    const nameFor = (type, id) => names[type]?.get(String(id)) ?? null;

    return rows.map((t) =>
      this.#shapeTransfer(t, {
        from: nameFor(t.from_type, t.from_id),
        to: nameFor(t.to_type, t.to_id),
      })
    );
  }

  /**
   * @legacy GET /api/staff/transfers/summary
   * @legacy GET /api/staff/transfers/summary/:id
   *
   *   `/transfers/summary` WAS ALSO UNREACHABLE — declared after
   *   `/transfers/:id?`, so it matched that with `id = 'summary'`.
   */
  async transferSummary({ actor, staffId, from, to }) {
    const scope = staffId ? [await this.#assertVisible(actor, staffId)] : await this.#visibleStaffIds(actor);

    const rows = await this.models.StaffTransfers.findAll({
      attributes: ['direction', [fn('COUNT', col('id')), 'count'], [fn('SUM', col('amount')), 'total']],
      where: {
        [Op.or]: [
          { from_type: TARGET_TYPE.STAFF, from_id: scope },
          { to_type: TARGET_TYPE.STAFF, to_id: scope },
        ],
        ...this.#dateRange(from, to),
      },
      group: ['direction'],
      raw: true,
    });

    return rows.map((r) => ({
      direction: r.direction,
      count: Number(r.count),
      // `fromStored`, not `toMinor` — see `#shapeBalance`. `SUM(amount)` over a
      // bare `numeric` column is itself bare `numeric`, so the total carries
      // whatever precision the widest row in the group had.
      total: money.fromStored(r.total ?? '0', { field: 'total' }),
    }));
  }

  /**
   * @legacy GET /api/staff/rollup/:id
   * @legacy GET /api/staff/rollupStaff/:id
   * @legacy GET /api/staff/metrics/:id
   *
   * Counts and balances for one account and, for the rollup, everything under
   * it.
   */
  async rollup({ actor, staffId, includeSubtree = false }) {
    await this.#assertVisible(actor, staffId);

    const ids = includeSubtree
      ? await descendantIds(this.models, staffId, { logger: this.logger })
      : [Number(staffId)];

    const [balances, players, staffCount] = await Promise.all([
      this.models.StaffBalances.findAll({ where: { staff_id: ids }, raw: true }),
      this.models.Users.count({ where: { parent_staff_id: ids } }),
      this.models.Staff.count({ where: { id: ids } }),
    ]);

    // `toMinorQuantised`, not `toMinor` — see `#shapeBalance`. One over-precise
    // row anywhere in the subtree used to 400 the whole rollup.
    const total = balances.reduce(
      (sum, b) => money.add(sum, money.toMinorQuantised(b.inr ?? '0', { field: 'balance' })),
      0n
    );

    return {
      staffId: Number(staffId),
      includesSubtree: includeSubtree,
      staffAccounts: staffCount,
      players,
      // Summed as exact decimals. Legacy's rollup added `Number(row.inr)` per
      // row, which is float addition over a NUMERIC column.
      balance: money.toDecimalString(total),
      currency: BALANCE_CURRENCY,
    };
  }

  /**
   * @legacy GET /api/staff/analytics/:id
   *
   * A seven-day trend of transfers in and out.
   */
  async analytics({ actor, staffId, days = 7 }) {
    await this.#assertVisible(actor, staffId);

    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.models.StaffTransfers.findAll({
      attributes: [
        [fn('DATE', col('created_at')), 'day'],
        'direction',
        [fn('COUNT', col('id')), 'count'],
        [fn('SUM', col('amount')), 'total'],
      ],
      where: {
        [Op.or]: [
          { from_type: TARGET_TYPE.STAFF, from_id: staffId },
          { to_type: TARGET_TYPE.STAFF, to_id: staffId },
        ],
        created_at: { [Op.gte]: since },
      },
      group: [literal('DATE(created_at)'), 'direction'],
      order: [[literal('DATE(created_at)'), 'ASC']],
      raw: true,
    });

    return rows.map((r) => ({
      day: r.day,
      direction: r.direction,
      count: Number(r.count),
      // A stored sum, so `fromStored` — see `transferSummary`.
      total: money.fromStored(r.total ?? '0', { field: 'total' }),
    }));
  }

  /** @legacy GET /api/staff/:id/whatsapp-ref */
  async whatsappRef({ actor, staffId }) {
    await this.#assertVisible(actor, staffId);
    const row = await this.models.StaffWhatsappRef.findOne({ where: { staff_id: staffId }, raw: true });
    return row ? { staffId: Number(staffId), reference: row.reference ?? row.ref ?? null } : null;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Money
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/staff/transfer
   *
   * Move INR between an account and someone beneath it.
   *
   * ─────────────────────────────────────────────────────────────────────
   * WHAT THE LEGACY VERSION DID
   *
   *     await pg.query("BEGIN");                    ← on the ONE shared client
   *     const bal = (await pg.query("SELECT inr FROM staff_balances ...")).rows[0]?.inr || 0;
   *     if (amount > bal) return res.status(400)    ← no ROLLBACK, and the read
   *     await transferInr(...)                        was never locked
   *
   * and `transferInr` debits with `SET inr = inr - $1` and no `WHERE inr >= $1`.
   * So: the debit, the credit and the history row were not atomic; the balance
   * check was an unlocked read two concurrent transfers both passed; and the
   * debit itself had no floor, so the account went negative.
   *
   * Here it is one database transaction, the debit is a GUARDED update whose
   * row count decides the outcome, and the history row is written inside it.
   * ─────────────────────────────────────────────────────────────────────
   */
  async transfer({ actor, toType, toId, amount, direction }) {
    const target = await this.#assertTransferTarget(actor, toType, toId);

    // Who pays and who receives. A `withdraw` pulls money UP from the target;
    // a `deposit` pushes it DOWN from the actor.
    const isWithdraw = direction === TRANSFER_DIRECTION.WITHDRAW;
    const source = isWithdraw
      ? { type: toType, id: target }
      : { type: TARGET_TYPE.STAFF, id: actor.id };
    const destination = isWithdraw
      ? { type: TARGET_TYPE.STAFF, id: actor.id }
      : { type: toType, id: target };

    if (source.type === destination.type && String(source.id) === String(destination.id)) {
      throw errors.CANNOT_TRANSFER_TO_SELF();
    }

    return this.db.transaction(async (transaction) => {
      await this.#debit(source, amount, { actor, transaction });
      await this.#credit(destination, amount, { transaction });

      const row = await this.models.StaffTransfers.create(
        {
          from_type: source.type,
          from_id: source.id,
          to_type: destination.type,
          to_id: destination.id,
          amount,
          direction,
          transfer_type: 'transfer',
          created_at: new Date(),
        },
        { transaction }
      );

      this.logger?.info(
        { actorStaffId: actor.id, from: source, to: destination, amount, direction, transferId: row.id },
        'Staff transfer'
      );

      return this.#shapeTransfer(row.get({ plain: true }));
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Writes
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /api/staff
   *
   * Create an account one level below the caller.
   */
  async create({ actor, name, email, password, phone, country, roleId, percentage }) {
    const existing = await this.models.Staff.findOne({ where: { email }, raw: true });
    if (existing) throw errors.NOT_PERMITTED({ reason: 'that email is already in use' });

    return this.db.transaction(async (transaction) => {
      const row = await this.models.Staff.create(
        {
          name,
          email,
          // Hash only. Legacy wrote the plaintext to `password2` beside it.
          password: await hashPassword(password, PASSWORD_ROUNDS),
          phone: phone ?? null,
          country: country ?? null,
          role_id: roleId,
          parent_id: actor.id,
          percentage: percentage ?? null,
          status: 'active',
        },
        { transaction }
      );

      /**
       * The closure table.
       *
       * Every ancestor of the parent becomes an ancestor of the new account,
       * one level deeper, plus a self-row at depth 0. Legacy wrote these too;
       * doing it inside the same transaction as the insert is the difference —
       * a failure between the two left an account with no place in the tree,
       * invisible to every scoped query including the one that would find it.
       */
      const ancestors = await this.models.StaffHierarchy.findAll({
        where: { descendant_id: actor.id },
        attributes: ['ancestor_id', 'depth'],
        transaction,
        raw: true,
      });

      await this.models.StaffHierarchy.bulkCreate(
        [
          { ancestor_id: row.id, descendant_id: row.id, depth: 0 },
          ...ancestors.map((a) => ({
            ancestor_id: a.ancestor_id,
            descendant_id: row.id,
            depth: Number(a.depth) + 1,
          })),
        ],
        { transaction, ignoreDuplicates: true }
      );

      await this.models.StaffBalances.findOrCreate({
        where: { staff_id: row.id },
        defaults: { staff_id: row.id, inr: '0' },
        transaction,
      });

      this.logger?.info({ actorStaffId: actor.id, staffId: row.id, roleId }, 'Staff account created');
      return this.#shapeStaff(row.get({ plain: true }));
    });
  }

  /** @legacy PATCH /api/staff/:id */
  async update({ actor, staffId, ...patch }) {
    await this.#assertVisible(actor, staffId);
    if (Number(staffId) === Number(actor.id)) {
      // Editing your own row through the descendant endpoint would let an
      // account change its own percentage. Self-service is `changePassword`.
      throw errors.NOT_PERMITTED({ reason: 'use the password endpoint to change your own account' });
    }

    const fields = {};
    for (const key of ['name', 'phone', 'country', 'status', 'percentage']) {
      if (patch[key] !== undefined) fields[key] = patch[key];
    }
    if (!Object.keys(fields).length) throw errors.NOT_PERMITTED({ reason: 'nothing to change' });

    const [affected] = await this.models.Staff.update(fields, { where: { id: staffId } });
    if (!affected) throw errors.NOT_FOUND({ staffId });

    this.logger?.info({ actorStaffId: actor.id, staffId, fields }, 'Staff account updated');
    return this.getById({ actor, staffId });
  }

  /**
   * @legacy PATCH /api/staff/password
   *
   * Change a password — your own, or a descendant's if your role allows it.
   *
   *   LEGACY STORED THE PLAINTEXT: `UPDATE staff SET password=$1, password2=$2`.
   *   `password2` is a column, so every staff password ever changed through
   *   that endpoint is readable by anyone with SELECT on the table. Only the
   *   hash is written here.
   */
  async changePassword({ actor, targetId, oldPassword, newPassword }) {
    const self = !targetId || Number(targetId) === Number(actor.id);
    const target = self ? actor.id : Number(targetId);

    if (!self) {
      await this.#assertVisible(actor, target);
      // Legacy gated this on `req.staff.level !== 0` — a hardcoded level check
      // in the controller. It is a permission on the route here.
      if (!actor.canResetOthers) throw errors.NOT_PERMITTED({ reason: 'you may not reset another account' });
    } else {
      const row = await this.models.Staff.findByPk(target, { attributes: ['password'], raw: true });
      if (!row) throw errors.NOT_FOUND({ staffId: target });
      if (!(await verifyPassword(oldPassword ?? '', row.password ?? ''))) {
        throw errors.OLD_PASSWORD_WRONG();
      }
    }

    await this.models.Staff.update(
      { password: await hashPassword(newPassword, PASSWORD_ROUNDS) },
      { where: { id: target } }
    );

    this.logger?.warn({ actorStaffId: actor.id, targetStaffId: target, self }, 'Staff password changed');
    return { staffId: target, changed: true };
  }

  /**
   * @legacy DELETE /api/staff/:id
   *
   * Legacy deleted the row and left the subtree pointing at a parent that no
   * longer exists — those accounts then belonged to no tree and were invisible
   * to every scoped query, including the ones that would have found them.
   * A balance left behind was simply gone.
   */
  async remove({ actor, staffId }) {
    await this.#assertVisible(actor, staffId);
    if (Number(staffId) === Number(actor.id)) throw errors.NOT_PERMITTED({ reason: 'you cannot delete yourself' });

    const descendants = await descendantIds(this.models, staffId, { logger: this.logger });
    if (descendants.filter((id) => Number(id) !== Number(staffId)).length) {
      throw errors.CANNOT_DELETE_WITH_DESCENDANTS({ staffId });
    }

    const balance = await this.models.StaffBalances.findOne({ where: { staff_id: staffId }, raw: true });
    if (balance && !money.isZero(money.toMinorQuantised(balance.inr ?? '0'))) {
      throw errors.CANNOT_DELETE_WITH_BALANCE({ staffId, balance: String(balance.inr) });
    }

    const players = await this.models.Users.count({ where: { parent_staff_id: staffId } });
    if (players) throw errors.CANNOT_DELETE_WITH_DESCENDANTS({ staffId, players });

    return this.db.transaction(async (transaction) => {
      await this.models.StaffHierarchy.destroy({
        where: { [Op.or]: [{ ancestor_id: staffId }, { descendant_id: staffId }] },
        transaction,
      });
      await this.models.StaffBalances.destroy({ where: { staff_id: staffId }, transaction });
      await this.models.Staff.destroy({ where: { id: staffId }, transaction });

      this.logger?.warn({ actorStaffId: actor.id, staffId }, 'Staff account deleted');
      return { staffId: Number(staffId), deleted: true };
    });
  }

  /** @legacy POST /api/staff/patch-bulk-status */
  async bulkStatus({ actor, ids, status }) {
    const visible = (await this.#visibleStaffIds(actor)).map(Number);
    const outside = ids.filter((id) => !visible.includes(Number(id)));
    if (outside.length) throw errors.NOT_IN_YOUR_TREE({ ids: outside });

    // An actor cannot suspend themselves out of their own session.
    if (ids.map(Number).includes(Number(actor.id))) {
      throw errors.NOT_PERMITTED({ reason: 'you cannot change your own status' });
    }

    const [affected] = await this.models.Staff.update({ status }, { where: { id: ids } });
    this.logger?.warn({ actorStaffId: actor.id, ids, status, affected }, 'Staff status changed in bulk');
    return { updated: affected, status };
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Take money, or refuse.
   *
   * The guarded UPDATE is the whole point: `WHERE inr >= :amount` means
   * Postgres decides, under its own row lock, and the row count tells us what
   * happened. Legacy read the balance, compared it in JavaScript, and then
   * debited unconditionally — so two transfers issued at once both passed the
   * comparison and the account went negative.
   */
  async #debit(party, amount, { actor, transaction }) {
    /**
     * The platform owner is the source of funds and has no balance to draw
     * down — legacy expressed this as `req.staff.level !== 0`, skipping the
     * check for level 0. Kept, because the alternative is that the top of the
     * tree cannot fund anyone; but it is now an explicit capability on the
     * actor rather than a magic number in the middle of a handler, and it is
     * logged as the issuance it is.
     */
    if (party.type === TARGET_TYPE.STAFF && Number(party.id) === Number(actor.id) && actor.canIssueFunds) {
      this.logger?.warn(
        { actorStaffId: actor.id, amount },
        'Funds ISSUED by the platform owner — this transfer is not drawn from an existing balance'
      );
      return;
    }

    const [affected] = party.type === TARGET_TYPE.STAFF
      ? await this.models.StaffBalances.update(
          { inr: literal(`inr - ${money.toDecimalString(money.toMinor(amount))}`) },
          {
            where: {
              staff_id: party.id,
              inr: { [Op.gte]: amount },
            },
            transaction,
          }
        )
      : await this.models.Credits.update(
          { inr: literal(`inr - ${money.toDecimalString(money.toMinor(amount))}`) },
          {
            where: {
              uid: party.id,
              inr: { [Op.gte]: amount },
            },
            transaction,
          }
        );

    if (!affected) throw errors.INSUFFICIENT_FUNDS({ party: party.type, id: party.id, amount });
  }

  async #credit(party, amount, { transaction }) {
    const model = party.type === TARGET_TYPE.STAFF ? this.models.StaffBalances : this.models.Credits;
    const key = party.type === TARGET_TYPE.STAFF ? 'staff_id' : 'uid';

    const [, created] = await model.findOrCreate({
      where: { [key]: party.id },
      defaults: { [key]: party.id, inr: amount },
      transaction,
    });

    if (!created) {
      await model.increment(
        { inr: money.toDecimalString(money.toMinor(amount)) },
        { where: { [key]: party.id }, transaction }
      );
    }
  }

  /** Self plus every descendant, from the closure table. */
  async #visibleStaffIds(actor) {
    return descendantIds(this.models, actor.id, { logger: this.logger });
  }

  async #assertVisible(actor, staffId) {
    const ids = (await this.#visibleStaffIds(actor)).map(Number);
    if (!ids.includes(Number(staffId))) throw errors.NOT_IN_YOUR_TREE({ staffId });
    return Number(staffId);
  }

  /** A transfer target must be a descendant account, or a player under one. */
  async #assertTransferTarget(actor, toType, toId) {
    if (toType === TARGET_TYPE.STAFF) return this.#assertVisible(actor, toId);

    const ids = await this.#visibleStaffIds(actor);
    const player = await this.models.Users.findOne({
      where: { id: toId, parent_staff_id: ids },
      attributes: ['id'],
      raw: true,
    });
    if (!player) throw errors.PLAYER_NOT_IN_YOUR_TREE({ toId });
    return Number(player.id);
  }

  #dateRange(from, to) {
    if (!from && !to) return {};
    return {
      created_at: { ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lte]: to } : {}) },
    };
  }

  #shapeStaff(row) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone ?? null,
      country: row.country ?? null,
      parentId: row.parent_id ?? null,
      roleId: row.role_id,
      status: row.status,
      percentage: this.#percent(row.percentage),
      // Never the password, and never `password2` — see the module note.
    };
  }

  /**
   * ── `fromStored`, NOT `toMinor` ───────────────────────────────────────
   *
   * Every money column here is bare `numeric` in the baseline —
   * `staff_balances.inr`, `.credit_limit`, `.exposure_limit` and
   * `staff_transfers.amount` — so Postgres has always accepted whatever
   * precision legacy's float arithmetic produced, and real rows carry well
   * past eight decimal places.
   *
   * `toMinor` refuses those by design: it validates INPUT, and a write with
   * more precision than the platform can represent is a bug. But these are
   * READS of rows that already exist, and every read path in the module went
   * through here — so a single over-precise row 400'd the account page, the
   * transfer list, the rollup and the summary with
   * "amount supports at most 8 decimal places". `fromStored` quantises to the
   * canonical scale instead. Input validation still uses `toMinor`.
   */
  #shapeBalance(row) {
    return {
      inr: money.fromStored(row?.inr ?? '0', { field: 'inr' }),
      creditLimit: money.fromStored(row?.credit_limit ?? '0', { field: 'creditLimit' }),
      exposureLimit: money.fromStored(row?.exposure_limit ?? '0', { field: 'exposureLimit' }),
      currency: BALANCE_CURRENCY,
    };
  }

  /**
   * `names` is optional: the list paths resolve them in one batch per page
   * (see `#withCounterpartyNames`), while the single-transfer write path has
   * no page to batch over and reports `null`.
   */
  #shapeTransfer(row, names = {}) {
    return {
      id: row.id,
      from: { type: row.from_type, id: row.from_id, name: names.from ?? null },
      to: { type: row.to_type, id: row.to_id, name: names.to ?? null },
      amount: money.fromStored(row.amount ?? '0', { field: 'amount' }),
      direction: row.direction,
      transferType: row.transfer_type ?? null,
      createdAt: row.created_at ?? null,
    };
  }

  #percent(value) {
    return value != null ? String(value) : null;
  }
}

module.exports = { StaffService };
