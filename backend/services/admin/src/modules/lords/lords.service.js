'use strict';

const { Op, fn, col, literal } = require('sequelize');
const { money } = require('@ibitplay/common');
const { hashPassword } = require('@ibitplay/auth');

const errors = require('./lords.errors');
const { ACCOUNT_TYPE, PASSWORD_ROUNDS } = require('./lords.constants');
const { descendantIds, verifyTransactionPassword } = require('../staff-directory/staffDirectory.service');

/** A NUMERIC that arrived as a string, as a plain number. Missing reads as 0. */
const num = (value) => Number(value ?? 0) || 0;

/**
 * A stored balance as a number, quantised to the platform scale first.
 *
 * `fromStored` rather than `toMinor`: real `credits` rows carry twenty decimal
 * places, and rejecting one of them would 400 the whole page.
 */
const stored = (value) => Number(money.fromStored(value ?? '0', { field: 'balance' }));

/* ── SIGN CONVENTION — read this before touching any P&L number ──────────────
 *
 * `users.gt` and `users.casino_gt` are accumulated from the bet ledgers, so
 * they are from the PLAYER's point of view: positive means the player is up.
 *
 * The panel shows the opposite — an agent looking at its downline wants ITS
 * profit, and a player winning is money the house paid out. So every P&L figure
 * leaving here is NEGATED, and named `sports_pnl` / `casino_pnl` rather than
 * `gt` / `casino_gt`: a key matching a column name while carrying the opposite
 * sign is a trap for whoever reads it next.
 * ────────────────────────────────────────────────────────────────────────── */
const housePnl = (playerPnl) => -num(playerPnl);

/**
 * Operator actions on one account.
 *
 * Every write requires the operator's transaction password — legacy's rule,
 * kept, because it is the one control that separates "somebody stole a
 * session" from "an operator decided this".
 */
class LordsService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Account settings
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /lords/user-setting/update-password
   *
   * Set a password on a staff account or a player beneath the caller.
   *
   *   LEGACY WROTE THE PLAINTEXT ALONGSIDE THE HASH, for both account types:
   *   `UPDATE staff SET password=$1, password2=$2` and the same against
   *   `users`. Only the hash is written here.
   */
  async setPassword({ actor, accountType, accountId, newPassword, transactionPassword }) {
    await this.#assertTransactionPassword(actor, transactionPassword);
    await this.#assertInTree(actor, accountType, accountId);

    const model = accountType === ACCOUNT_TYPE.STAFF ? this.models.Staff : this.models.Users;
    const [affected] = await model.update(
      { password: await hashPassword(newPassword, PASSWORD_ROUNDS) },
      { where: { id: accountId } }
    );
    if (!affected) throw errors.NOT_FOUND({ accountId });

    this.logger?.warn(
      { actorStaffId: actor.id, accountType, accountId },
      'Password set by an operator'
    );
    return { accountType, accountId: Number(accountId), changed: true };
  }

  /**
   * @legacy POST /lords/user-setting/status
   *
   * The lock switches: overall status, betting, sports, casino, system.
   *
   * Legacy took all five in one body and applied whichever were present, which
   * is right — an operator suspending an account usually wants several at once
   * and separate endpoints make that non-atomic.
   */
  async setStatus({ actor, accountType, accountId, transactionPassword, ...flags }) {
    await this.#assertTransactionPassword(actor, transactionPassword);
    await this.#assertInTree(actor, accountType, accountId);

    if (accountType === ACCOUNT_TYPE.STAFF && Number(accountId) === Number(actor.id)) {
      throw errors.CANNOT_ACT_ON_SELF({ reason: 'you cannot change your own locks' });
    }

    const patch = {};
    if (flags.status !== undefined) patch.status = flags.status;
    if (flags.betStatus !== undefined) patch.bet_status = flags.betStatus;
    if (flags.sportsLocked !== undefined) patch.sports_betlocked = flags.sportsLocked;
    if (flags.casinoLocked !== undefined) patch.casino_locked = flags.casinoLocked;
    if (flags.systemLocked !== undefined) patch.system_locked = flags.systemLocked;

    if (!Object.keys(patch).length) throw errors.NOT_FOUND({ reason: 'nothing to change' });

    const model = accountType === ACCOUNT_TYPE.STAFF ? this.models.Staff : this.models.Users;
    const [affected] = await model.update(patch, { where: { id: accountId } });
    if (!affected) throw errors.NOT_FOUND({ accountId });

    this.logger?.warn(
      { actorStaffId: actor.id, accountType, accountId, patch },
      'Account locks changed'
    );
    return { accountType, accountId: Number(accountId), ...patch };
  }

  /**
   * @legacy POST /lords/user-setting/exposure-limit
   *
   * How much a player may have at risk across open bets at once.
   */
  async setExposureLimit({ actor, accountType, accountId, exposureLimit, transactionPassword }) {
    await this.#assertTransactionPassword(actor, transactionPassword);
    await this.#assertInTree(actor, accountType, accountId);

    if (accountType === ACCOUNT_TYPE.STAFF) {
      await this.models.StaffBalances.update(
        { exposure_limit: exposureLimit },
        { where: { staff_id: accountId } }
      );
    } else {
      await this.models.Users.update({ exposure_limit: exposureLimit }, { where: { id: accountId } });
    }

    this.logger?.info(
      { actorStaffId: actor.id, accountType, accountId, exposureLimit },
      'Exposure limit changed'
    );
    return { accountType, accountId: Number(accountId), exposureLimit };
  }

  /**
   * @legacy POST /lords/update-current
   *
   * Adjust a player's credit limit — how far below zero their balance may go.
   */
  async setCreditLimit({ actor, accountId, creditLimit, transactionPassword }) {
    await this.#assertTransactionPassword(actor, transactionPassword);
    await this.#assertInTree(actor, ACCOUNT_TYPE.USER, accountId);

    await this.models.Credits.update({ credit_limit: creditLimit }, { where: { uid: accountId } });

    this.logger?.warn(
      { actorStaffId: actor.id, accountId, creditLimit },
      'Credit limit changed — this is how far below zero a balance may go'
    );
    return { accountId: Number(accountId), creditLimit };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Money
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /lords/quick-refill
   * @legacy POST /lords/funds/transfer
   * @legacy POST /funds/transfer
   *
   * Credit a player directly.
   *
   * ─────────────────────────────────────────────────────────────────────
   * WHERE THE MONEY COMES FROM
   *
   * An ordinary operator funds it from their own balance — a guarded debit
   * that refuses rather than going negative. The platform owner does not: the
   * house is where money enters the system, so there is nothing to draw down.
   *
   * Legacy modelled both correctly and recorded neither distinctly, so an
   * owner-issued refill looked exactly like an agent moving their own float.
   * Issuance is logged as issuance here and carries a per-refill ceiling that
   * legacy had no equivalent of.
   * ─────────────────────────────────────────────────────────────────────
   */
  async refill({ actor, accountId, amount, note, transactionPassword }) {
    await this.#assertTransactionPassword(actor, transactionPassword);
    await this.#assertInTree(actor, ACCOUNT_TYPE.USER, accountId);

    const ceiling = String(this.config.ADMIN_MAX_REFILL ?? '1000000');
    if (money.gt(amount, ceiling)) throw errors.REFILL_TOO_LARGE({ amount, ceiling });

    return this.db.transaction(async (transaction) => {
      if (actor.canIssueFunds) {
        this.logger?.warn(
          { actorStaffId: actor.id, accountId, amount, note },
          'Funds ISSUED by the platform owner — not drawn from an existing balance'
        );
      } else {
        /**
         * The guarded debit. `inr >= :amount` in the WHERE means Postgres
         * decides under its own row lock and the row count is the answer —
         * legacy read the balance with `FOR UPDATE` inside a transaction shared
         * by every concurrent request, which is a lock whose scope nobody can
         * reason about.
         */
        const [affected] = await this.models.StaffBalances.update(
          { inr: literal(`inr - ${money.toDecimalString(money.toMinor(amount))}`) },
          { where: { staff_id: actor.id, inr: { [Op.gte]: amount } }, transaction }
        );
        if (!affected) throw errors.INSUFFICIENT_FUNDS({ amount });
      }

      const [credits, created] = await this.models.Credits.findOrCreate({
        where: { uid: accountId },
        defaults: { uid: accountId, inr: amount },
        transaction,
      });
      if (!created) {
        await this.models.Credits.increment(
          { inr: money.toDecimalString(money.toMinor(amount)) },
          { where: { uid: accountId }, transaction }
        );
      }

      await this.models.StaffTransfers.create(
        {
          from_type: ACCOUNT_TYPE.STAFF,
          from_id: actor.id,
          to_type: ACCOUNT_TYPE.USER,
          to_id: accountId,
          amount,
          direction: 'deposit',
          transfer_type: actor.canIssueFunds ? 'issuance' : 'transfer',
          note: note ?? null,
          created_at: new Date(),
        },
        { transaction }
      );

      const after = await this.models.Credits.findOne({
        where: { uid: accountId },
        transaction,
        raw: true,
      });

      this.logger?.info(
        { actorStaffId: actor.id, accountId, amount, issued: Boolean(actor.canIssueFunds) },
        'Wallet refilled'
      );

      return {
        accountId: Number(accountId),
        amount: money.toDecimalString(money.toMinor(amount)),
        balance: money.fromStored(after?.inr ?? '0'),
        currency: 'INR',
        issued: Boolean(actor.canIssueFunds),
      };
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════════

  /** @legacy GET /lords/transfer/statement */
  async transferStatement({ actor, accountType, accountId, from, to, limit = 50, offset = 0 }) {
    const staffIds = await descendantIds(this.models, actor.id, { logger: this.logger });

    const scope = accountId
      ? { type: accountType ?? ACCOUNT_TYPE.USER, id: await this.#assertInTree(actor, accountType ?? ACCOUNT_TYPE.USER, accountId) }
      : null;

    const where = scope
      ? {
          [Op.or]: [
            { from_type: scope.type, from_id: scope.id },
            { to_type: scope.type, to_id: scope.id },
          ],
        }
      : {
          [Op.or]: [
            { from_type: ACCOUNT_TYPE.STAFF, from_id: staffIds },
            { to_type: ACCOUNT_TYPE.STAFF, to_id: staffIds },
          ],
        };

    const { rows, count } = await this.models.StaffTransfers.findAndCountAll({
      where: {
        ...where,
        ...(from || to
          ? { created_at: { ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lte]: to } : {}) } }
          : {}),
      },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    // Two batched lookups for the whole page, so the statement reads as
    // "Ms07 → Sriram" rather than "staff #19 → user #3929649457".
    const idsOfType = (type) => [
      ...new Set(
        rows
          .flatMap((r) => [r.from_type === type ? r.from_id : null, r.to_type === type ? r.to_id : null])
          .filter((id) => id != null)
          .map(String)
      ),
    ];

    const [staffRows, userRows] = await Promise.all([
      idsOfType(ACCOUNT_TYPE.STAFF).length
        ? this.models.Staff.findAll({ where: { id: idsOfType(ACCOUNT_TYPE.STAFF) }, attributes: ['id', 'name'], raw: true })
        : [],
      idsOfType(ACCOUNT_TYPE.USER).length
        ? this.models.Users.findAll({ where: { id: idsOfType(ACCOUNT_TYPE.USER) }, attributes: ['id', 'name'], raw: true })
        : [],
    ]);

    const names = {
      [ACCOUNT_TYPE.STAFF]: new Map(staffRows.map((s) => [String(s.id), s.name ?? null])),
      [ACCOUNT_TYPE.USER]: new Map(userRows.map((u) => [String(u.id), u.name ?? null])),
    };
    // A since-deleted counterparty stays `null`; the transfer still happened.
    const nameFor = (type, id) => names[type]?.get(String(id)) ?? null;

    return {
      total: count,
      rows: rows.map((r) => ({
        id: r.id,
        from: { type: r.from_type, id: r.from_id, name: nameFor(r.from_type, r.from_id) },
        to: { type: r.to_type, id: r.to_id, name: nameFor(r.to_type, r.to_id) },
        amount: money.fromStored(r.amount ?? '0'),
        direction: r.direction,
        transferType: r.transfer_type ?? null,
        note: r.note ?? null,
        createdAt: r.created_at ?? null,
      })),
    };
  }

  /**
   * @legacy GET /lords/users/all-details
   *
   * ONE LEVEL of the tree: the caller's direct sub-agents followed by the
   * caller's own players. `parentId` drills into a sub-agent, which is how the
   * panel walks down — so this is a listing of children, NOT of the whole
   * subtree. An earlier version of this port returned every player anywhere
   * below the caller and no agents at all, which is a different question and
   * gave the panel a downline table with no downline in it.
   *
   * Legacy returned the whole row per player — `password` and `password2`
   * included. Only the operational columns are here.
   *
   * The money and P&L figures leave as NUMBERS rather than decimal strings,
   * because that is the contract the admin panel's `Agent` row is typed
   * against. See the sign note on `#rollupPnl` before touching a P&L field.
   */
  async allDetails({ actor, search, limit = 50, offset = 0, parentId }) {
    const visible = (await descendantIds(this.models, actor.id, { logger: this.logger })).map(Number);
    const rootId = parentId != null ? Number(parentId) : Number(actor.id);
    if (!visible.includes(rootId)) throw errors.NOT_IN_YOUR_TREE({ accountId: rootId });

    const like = search ? { name: { [Op.iLike]: `%${search}%` } } : {};
    const staffWhere = { parent_id: rootId, ...like };
    const userWhere = { parent_staff_id: rootId, ...like };

    const [staffTotal, userTotal] = await Promise.all([
      this.models.Staff.count({ where: staffWhere }),
      this.models.Users.count({ where: userWhere }),
    ]);

    /**
     * One window over `[...agents, ...players]`.
     *
     * Legacy paged the two halves independently — agents got the real offset,
     * players were always fetched at offset 0 — so every page after the first
     * repeated the same players under a different set of agents. Slicing the
     * concatenation is the same first page and a correct second one.
     */
    const staffLimit = Math.max(0, Math.min(limit, staffTotal - offset));
    const staffRows = staffLimit
      ? await this.models.Staff.findAll({
          where: staffWhere,
          attributes: [
            'id', 'name', 'status', 'bet_status', 'percentage',
            'sports_betlocked', 'casino_locked', 'system_locked',
          ],
          include: [{ model: this.models.Roles, as: 'role', attributes: ['name'], required: false }],
          order: [['id', 'ASC']],
          limit: staffLimit,
          offset,
          raw: true,
          nest: true,
        })
      : [];

    const userLimit = limit - staffRows.length;
    const userRows = userLimit
      ? await this.models.Users.findAll({
          where: userWhere,
          attributes: [
            'id', 'name', 'status', 'bet_status', 'sports_betlocked',
            'casino_locked', 'system_locked', 'exposure_limit', 'gt', 'casino_gt',
          ],
          order: [['id', 'ASC']],
          limit: userLimit,
          offset: Math.max(0, offset - staffTotal),
          raw: true,
        })
      : [];

    const staffIds = staffRows.map((s) => Number(s.id));
    const userIds = userRows.map((u) => Number(u.id));

    const [balances, credits, downline, subtrees] = await Promise.all([
      this.models.StaffBalances.findAll({ where: { staff_id: staffIds }, raw: true }),
      this.models.Credits.findAll({ where: { uid: userIds }, raw: true }),
      this.#hasDownline(staffIds),
      this.#subtreePlayers(staffIds, visible),
    ]);

    const balanceOf = new Map(balances.map((b) => [String(b.staff_id), b]));
    const creditOf = new Map(credits.map((c) => [String(c.uid), c]));

    // Every player whose exposure this page needs: the listed players, plus
    // each agent's whole subtree. One grouped read rather than one per row.
    const exposure = await this.#exposureByUser([
      ...userIds,
      ...subtrees.players.map((p) => Number(p.id)),
    ]);

    const agents = staffRows.map((s) => {
      const id = Number(s.id);
      const players = subtrees.byStaff.get(id) ?? [];
      const locked = Boolean(s.sports_betlocked);
      return {
        id,
        username: s.name,
        role: s.role?.name ?? null,
        status: s.status,
        bet_status: s.bet_status,
        percentage: num(s.percentage),
        // Legacy reported one column under two names and the panel reads both.
        bet_locked: locked,
        sports_locked: locked,
        casino_locked: Boolean(s.casino_locked),
        system_locked: Boolean(s.system_locked),
        balance: stored(balanceOf.get(String(id))?.inr),
        exp_limit: stored(balanceOf.get(String(id))?.exposure_limit),
        account_type: ACCOUNT_TYPE.STAFF.toUpperCase(),
        has_downline: downline.has(id),
        exposure: players.reduce((sum, p) => sum + (exposure.get(Number(p.id)) ?? 0), 0),
        // An agent has no stored P&L — theirs is always the roll-up over the
        // players beneath them, so it cannot drift from what those players did.
        sports_pnl: housePnl(players.reduce((sum, p) => sum + num(p.gt), 0)),
        casino_pnl: housePnl(players.reduce((sum, p) => sum + num(p.casino_gt), 0)),
      };
    });

    const players = userRows.map((u) => {
      const id = Number(u.id);
      const locked = Boolean(u.sports_betlocked);
      return {
        id,
        username: u.name,
        role: 'User',
        status: u.status,
        bet_status: u.bet_status,
        percentage: 0,
        bet_locked: locked,
        sports_locked: locked,
        casino_locked: Boolean(u.casino_locked),
        system_locked: Boolean(u.system_locked),
        balance: stored(creditOf.get(String(id))?.inr),
        exp_limit: stored(u.exposure_limit),
        account_type: ACCOUNT_TYPE.USER.toUpperCase(),
        has_downline: false,
        exposure: exposure.get(id) ?? 0,
        sports_pnl: housePnl(u.gt),
        casino_pnl: housePnl(u.casino_gt),
      };
    });

    return { total: staffTotal + userTotal, rows: [...agents, ...players] };
  }

  /**
   * @legacy GET /lords/net-exposure/sports
   *
   * The platform's sports exposure, from the operator's side.
   *
   * sports-service owns `user_exposures` and computes this correctly — summing
   * each player's WORST outcome per match rather than adding their winning
   * legs to their losing ones. This proxies rather than reimplementing, because
   * a second implementation of that arithmetic is a second chance to get the
   * sign wrong.
   */
  async netExposure({ actor, clients }) {
    const result = await clients.sports.get('/internal/sports/bet-admin/net', {
      query: { staffId: actor.id },
    });
    return result?.data ?? result;
  }

  // ══════════════════════════════════════════════════════════════════════

  /** Which of these agents have anything at all beneath them — an agent or a player. */
  async #hasDownline(staffIds) {
    if (!staffIds.length) return new Set();

    const [agents, players] = await Promise.all([
      this.models.Staff.findAll({
        attributes: ['parent_id'], where: { parent_id: staffIds }, group: ['parent_id'], raw: true,
      }),
      this.models.Users.findAll({
        attributes: ['parent_staff_id'], where: { parent_staff_id: staffIds }, group: ['parent_staff_id'], raw: true,
      }),
    ]);

    return new Set([
      ...agents.map((r) => Number(r.parent_id)),
      ...players.map((r) => Number(r.parent_staff_id)),
    ]);
  }

  /**
   * Every player under each of these agents, keyed by agent.
   *
   * The subtrees are walked IN MEMORY off one `parent_id` read over the
   * caller's visible staff, so a page of 25 agents costs two queries rather
   * than a hierarchy walk each. `visible` already bounds it to the caller's
   * tree, so nothing outside it can be reached from here.
   */
  async #subtreePlayers(staffIds, visible) {
    if (!staffIds.length) return { byStaff: new Map(), players: [] };

    const edges = await this.models.Staff.findAll({
      where: { id: visible },
      attributes: ['id', 'parent_id'],
      raw: true,
    });

    const childrenOf = new Map();
    for (const { id, parent_id: parentId } of edges) {
      if (parentId == null) continue;
      const list = childrenOf.get(Number(parentId)) ?? [];
      list.push(Number(id));
      childrenOf.set(Number(parentId), list);
    }

    // The agent itself is part of its own subtree — its direct players count
    // towards its roll-up, not only its sub-agents'.
    const subtreeOf = new Map();
    for (const root of staffIds) {
      const seen = new Set([root]);
      const queue = [root];
      while (queue.length) {
        for (const child of childrenOf.get(queue.pop()) ?? []) {
          if (seen.has(child)) continue;
          seen.add(child);
          queue.push(child);
        }
      }
      subtreeOf.set(root, seen);
    }

    const owners = [...new Set([...subtreeOf.values()].flatMap((s) => [...s]))];
    const players = await this.models.Users.findAll({
      where: { parent_staff_id: owners },
      attributes: ['id', 'parent_staff_id', 'gt', 'casino_gt'],
      raw: true,
    });

    const byStaff = new Map(
      staffIds.map((id) => [
        id,
        players.filter((p) => subtreeOf.get(id).has(Number(p.parent_staff_id))),
      ])
    );
    return { byStaff, players };
  }

  /** Open exposure per player, as the absolute amount at risk across their bets. */
  async #exposureByUser(userIds) {
    const ids = [...new Set(userIds)];
    if (!ids.length) return new Map();

    const rows = await this.models.UserExposures.findAll({
      attributes: ['user_id', [fn('SUM', fn('ABS', col('exposure_amount'))), 'total']],
      where: { user_id: ids },
      group: ['user_id'],
      raw: true,
    });
    return new Map(rows.map((r) => [Number(r.user_id), num(r.total)]));
  }

  /**
   * The operator's second factor.
   *
   * admin-service owns `staff`, so this reads it directly rather than over the
   * internal API — the same helper `staff-directory` exposes to other services.
   */
  async #assertTransactionPassword(actor, transactionPassword) {
    if (!transactionPassword) throw errors.TRANSACTION_PASSWORD_REQUIRED();
    const ok = await verifyTransactionPassword(this.models, actor.id, transactionPassword);
    if (!ok) throw errors.TRANSACTION_PASSWORD_REQUIRED({ reason: 'not valid' });
  }

  /** The target must be the caller's own account, a descendant, or their player. */
  async #assertInTree(actor, accountType, accountId) {
    const staffIds = (await descendantIds(this.models, actor.id, { logger: this.logger })).map(Number);

    if (accountType === ACCOUNT_TYPE.STAFF) {
      if (!staffIds.includes(Number(accountId))) throw errors.NOT_IN_YOUR_TREE({ accountId });
      return Number(accountId);
    }

    const player = await this.models.Users.findOne({
      where: { id: accountId, parent_staff_id: staffIds },
      attributes: ['id'],
      raw: true,
    });
    if (!player) throw errors.NOT_IN_YOUR_TREE({ accountId });
    return Number(player.id);
  }
}

module.exports = { LordsService };
