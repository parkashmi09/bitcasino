'use strict';

const { Op } = require('sequelize');
const { money } = require('@ibitplay/common');

const errors = require('./locks.errors');
const { LOCK_FIELDS } = require('./locks.constants');
const { descendantIds } = require('../staff-directory/staffDirectory.service');

/**
 * Locks, and the public referral lookup.
 */
class LocksService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
  }

  /**
   * @legacy POST /locksystem/update-system-lock
   *
   * Lock or unlock an account — and, for an agent, everything beneath it.
   */
  async updateLocks({ actor, userId, staffId, locks }) {
    const changes = Object.fromEntries(
      Object.entries(LOCK_FIELDS)
        .filter(([key]) => locks[key] !== undefined)
        .map(([key, column]) => [column, Boolean(locks[key])])
    );

    if (!Object.keys(changes).length) throw errors.NOTHING_TO_UPDATE();
    if (!userId && !staffId) throw errors.NO_TARGET();
    if (userId && staffId) throw errors.AMBIGUOUS_TARGET();

    return this.db.transaction(async (transaction) => {
      const tree = await descendantIds(this.models, actor.id, { logger: this.logger });

      if (userId) return this.#lockPlayer({ actor, userId, changes, tree, transaction });
      return this.#lockAgentTree({ actor, staffId, changes, tree, transaction });
    });
  }

  /**
   * One player.
   *
   * Scoped to the caller's WHOLE tree, not just their direct children — see
   * the module header for the `parent_staff_id = caller` clause that made a
   * supervisor's lock silently do nothing.
   */
  async #lockPlayer({ actor, userId, changes, tree, transaction }) {
    const seesUnassigned = tree.map(Number).includes(1);

    const [affected] = await this.models.Users.update(changes, {
      where: {
        id: userId,
        ...(seesUnassigned
          ? { [Op.or]: [{ parent_staff_id: tree }, { parent_staff_id: null }] }
          : { parent_staff_id: tree }),
      },
      transaction,
    });

    /**
     * The row count is the answer.
     *
     * Legacy ran the UPDATE, ignored how many rows it matched, and answered
     * "Lock update successfully." either way — so a lock that applied to
     * nothing was reported as a lock that worked.
     */
    if (!affected) throw errors.NOT_IN_YOUR_TREE({ userId });

    this.logger?.warn({ actorStaffId: actor.id, userId, changes }, 'Player locks changed');

    return { target: 'USER', id: String(userId), applied: changes, playersAffected: affected, agentsAffected: 0 };
  }

  /**
   * An agent, and the entire subtree under them.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THE WHOLE BRANCH, NOT THE FIRST LEVEL
   *
   * Legacy locked the named agent and the players attached directly to them.
   * Sub-agents kept trading, and so did every player beneath a sub-agent.
   * ─────────────────────────────────────────────────────────────────────
   */
  async #lockAgentTree({ actor, staffId, changes, tree, transaction }) {
    if (!tree.map(Number).includes(Number(staffId))) throw errors.NOT_IN_YOUR_TREE({ staffId });

    if (Number(staffId) === Number(actor.id)) {
      // Locking yourself out is almost certainly a mistake and is definitely
      // not recoverable through this route. Legacy permitted it.
      throw errors.CANNOT_LOCK_SELF();
    }

    const subtree = await descendantIds(this.models, staffId, { logger: this.logger });

    const [agentsAffected] = await this.models.Staff.update(changes, {
      where: { id: subtree },
      transaction,
    });

    const [playersAffected] = await this.models.Users.update(changes, {
      where: { parent_staff_id: subtree },
      transaction,
    });

    this.logger?.warn(
      { actorStaffId: actor.id, staffId, agents: subtree.length, agentsAffected, playersAffected, changes },
      'Agent SUBTREE locks changed'
    );

    return {
      target: 'STAFF',
      id: String(staffId),
      applied: changes,
      agentsAffected,
      playersAffected,
      /** Named so an operator can see the lock reached past the first level. */
      agentsInSubtree: subtree.length,
    };
  }

  /**
   * @legacy GET /api/public/ref/:slug
   *
   * Map a referral slug to the WhatsApp number to message.
   *
   * Genuinely public — read before anybody has an account. It returns one
   * phone number for one slug and nothing else, which is the whole reason it
   * can stay open.
   */
  async resolveReferral({ slug }) {
    const row = await this.models.StaffWhatsappRef.findOne({
      where: { slug },
      attributes: ['phone'],
      raw: true,
    });

    if (!row) throw errors.UNKNOWN_REFERRAL();
    return { phone: row.phone };
  }

  /**
   * @legacy GET /api/public/user-transfers/:uid
   *
   * A player's deposits and withdrawals with their agent.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THIS WAS ON THE PUBLIC ROUTER
   *
   * No authentication, uid from the path: every transfer involving any player,
   * with amounts, timestamps and counterparty names, by counting ids. It is a
   * staff read and it is scoped to the caller's tree.
   * ─────────────────────────────────────────────────────────────────────
   */
  async userTransfers({ actor, userId, limit = 50, offset = 0 }) {
    const tree = await descendantIds(this.models, actor.id, { logger: this.logger });
    const seesUnassigned = tree.map(Number).includes(1);

    const player = await this.models.Users.findOne({
      where: {
        id: userId,
        ...(seesUnassigned
          ? { [Op.or]: [{ parent_staff_id: tree }, { parent_staff_id: null }] }
          : { parent_staff_id: tree }),
      },
      attributes: ['id', 'name'],
      raw: true,
    });
    if (!player) throw errors.NOT_IN_YOUR_TREE({ userId });

    const { rows, count } = await this.models.StaffTransfers.findAndCountAll({
      where: {
        [Op.or]: [
          { from_type: 'user', from_id: userId },
          { to_type: 'user', to_id: userId },
        ],
      },
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const counterparties = await this.#counterpartyNames(rows);

    return {
      total: count,
      rows: rows.map((row) => {
        const incoming = row.to_type === 'user' && String(row.to_id) === String(userId);
        return {
          id: String(row.id),
          at: row.created_at,
          direction: incoming ? 'deposit' : 'withdraw',
          amount: money.toDecimalString(money.toMinor(row.amount ?? '0')),
          counterparty:
            counterparties.get(`${incoming ? row.from_type : row.to_type}:${incoming ? row.from_id : row.to_id}`) ??
            null,
          note: row.note ?? null,
        };
      }),
    };
  }

  // ══════════════════════════════════════════════════════════════════════

  async #counterpartyNames(rows) {
    const staffIds = new Set();
    const userIds = new Set();

    for (const row of rows) {
      (row.from_type === 'staff' ? staffIds : userIds).add(row.from_id);
      (row.to_type === 'staff' ? staffIds : userIds).add(row.to_id);
    }

    const [staff, users] = await Promise.all([
      staffIds.size
        ? this.models.Staff.findAll({ where: { id: [...staffIds] }, attributes: ['id', 'name'], raw: true })
        : [],
      userIds.size
        ? this.models.Users.findAll({ where: { id: [...userIds] }, attributes: ['id', 'name'], raw: true })
        : [],
    ]);

    const lookup = new Map();
    for (const row of staff) lookup.set(`staff:${row.id}`, row.name);
    for (const row of users) lookup.set(`user:${row.id}`, row.name);
    return lookup;
  }
}

module.exports = { LocksService };
