'use strict';

const { Op } = require('sequelize');
const { hashPassword, resolvePermissions, hasPermission, ALL_PERMISSIONS } = require('@ibitplay/auth');

const errors = require('./access.errors');
const { EXECUTIVE_KIND, EXECUTIVE_STATUS, PASSWORD_ROUNDS } = require('./access.constants');
const { descendantIds } = require('../staff-directory/staffDirectory.service');

/**
 * Executives and marketing accounts.
 *
 * An executive is a sub-login belonging to one staff member. It authenticates
 * separately, acts as that staff member, and carries a SUBSET of their
 * authority — that last word is the whole design, and it is the word legacy
 * did not enforce.
 */
class AccessService {
  constructor({ models, db, logger, config }) {
    this.models = models;
    this.db = db;
    this.logger = logger;
    this.config = config;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Reads
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy GET /lords/access/me/permissions
   *
   * What the caller can actually do, after every intersection has been applied.
   *
   * The point of exposing it: an executive whose stored grant exceeds their
   * parent's sees the TRIMMED set here, which is the set that governs. Legacy
   * returned the stored grant, so the screen and the enforcement disagreed.
   */
  async myPermissions({ actor }) {
    const staff = await this.models.Staff.findByPk(actor.id, {
      attributes: ['id', 'role_id'],
      raw: true,
    });
    if (!staff) throw errors.NOT_FOUND({ staffId: actor.id });

    const role = await this.models.Roles.findByPk(staff.role_id, { raw: true });

    let executivePermissions = null;
    if (actor.executiveId) {
      const exec = await this.models.Executives.findByPk(actor.executiveId, { raw: true });
      executivePermissions = this.#parsePermissions(exec?.permissions);
    }

    const effective = resolvePermissions({
      level: role?.level,
      rolePermissions: this.#parsePermissions(role?.permissions),
      executivePermissions,
    });

    return {
      staffId: actor.id,
      executiveId: actor.executiveId ?? null,
      roleId: staff.role_id,
      level: role?.level ?? null,
      permissions: effective,
    };
  }

  /** @legacy GET /lords/access/executives */
  async listExecutives({ actor, kind = EXECUTIVE_KIND.EXECUTIVE, status, search, limit = 25, offset = 0 }) {
    const { rows, count } = await this.models.Executives.findAndCountAll({
      where: {
        // An executive belongs to ONE staff member. Legacy scoped the listing
        // the same way and it is the one part of this file that needs no
        // hierarchy walk.
        parent_staff_id: actor.id,
        kind,
        ...(status ? { status } : {}),
        ...(search ? { username: { [Op.iLike]: `%${search}%` } } : {}),
      },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return { total: count, rows: rows.map((r) => this.#shape(r)) };
  }

  /** @legacy GET /lords/access/marketing-users */
  async listMarketingUsers({ actor, ...rest }) {
    // Legacy gated this on "SuperAdmin only — enforced in the controller",
    // which meant a level check buried in the handler. It is a permission on
    // the route now.
    return this.listExecutives({ actor, ...rest, kind: EXECUTIVE_KIND.MARKETING });
  }

  /**
   * @legacy GET /lords/access/executives/:id/activity
   *
   * What one executive has done.
   */
  async executiveActivity({ actor, executiveId, limit = 50, offset = 0 }) {
    await this.#assertOwned(actor, executiveId);

    const { rows, count } = await this.models.ExecutiveActivityLogs.findAndCountAll({
      where: { executive_id: executiveId },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return { total: count, rows: rows.map((r) => this.#shapeActivity(r)) };
  }

  /**
   * @legacy GET /lords/access/activity
   *
   * Everything the caller's own tree has done.
   *
   * Legacy described this as "SuperAdmin: all; others: self + downline" and
   * implemented it as a level check inside the handler. Here the tree comes
   * from the closure table for everyone, and the platform owner's tree happens
   * to be everything — one rule instead of two.
   */
  async activity({ actor, action, from, to, limit = 50, offset = 0 }) {
    const staffIds = await descendantIds(this.models, actor.id, { logger: this.logger });

    const executives = await this.models.Executives.findAll({
      where: { parent_staff_id: staffIds },
      attributes: ['id'],
      raw: true,
    });

    const { rows, count } = await this.models.ExecutiveActivityLogs.findAndCountAll({
      where: {
        executive_id: executives.map((e) => e.id),
        ...(action ? { action } : {}),
        ...(from || to
          ? { created_at: { ...(from ? { [Op.gte]: from } : {}), ...(to ? { [Op.lte]: to } : {}) } }
          : {}),
      },
      order: [['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    return { total: count, rows: rows.map((r) => this.#shapeActivity(r)) };
  }

  // ══════════════════════════════════════════════════════════════════════
  //  Writes
  // ══════════════════════════════════════════════════════════════════════

  /**
   * @legacy POST /lords/access/executives
   * @legacy POST /lords/access/marketing-users
   *
   * Create a sub-login beneath the caller.
   *
   * ─────────────────────────────────────────────────────────────────────
   * THE GRANT IS INTERSECTED WITH THE CREATOR'S OWN AUTHORITY, HERE.
   *
   * Legacy checked that the permission payload had three object-valued keys
   * and stored whatever was inside them. Requesting a permission the creator
   * does not hold is refused rather than silently trimmed: silently trimming
   * would leave the caller believing they granted something they did not, and
   * an operator who meant to grant it needs to know they cannot.
   * ─────────────────────────────────────────────────────────────────────
   */
  async createExecutive({ actor, username, password, permissions, kind = EXECUTIVE_KIND.EXECUTIVE }) {
    const granted = await this.#assertGrantable(actor, permissions);

    const existing = await this.models.Executives.findOne({ where: { username }, raw: true });
    if (existing) throw errors.USERNAME_TAKEN({ username });

    const staff = await this.models.Staff.findByPk(actor.id, { attributes: ['id', 'role_id'], raw: true });
    const role = staff ? await this.models.Roles.findByPk(staff.role_id, { raw: true }) : null;

    try {
      const row = await this.models.Executives.create({
        username,
        password: await hashPassword(password, PASSWORD_ROUNDS),
        parent_staff_id: actor.id,
        // A snapshot of the parent's role AT CREATION, for the audit trail —
        // it says what authority this account was minted under even after the
        // parent is promoted or demoted.
        parent_role_snapshot: role?.name ?? null,
        permissions: { authority: granted },
        status: EXECUTIVE_STATUS.ACTIVE,
        kind,
      });

      this.logger?.warn(
        { actorStaffId: actor.id, executiveId: row.id, kind, permissions: granted },
        'Sub-login created'
      );

      return this.#shape(row.get({ plain: true }));
    } catch (error) {
      // The unique index is the real guard; the check above only produces a
      // friendlier message when there is no race.
      if (error?.name === 'SequelizeUniqueConstraintError') throw errors.USERNAME_TAKEN({ username });
      throw error;
    }
  }

  /**
   * @legacy PATCH /lords/access/executives/:id
   *
   * Change what an executive may do. Same intersection as creation — an
   * account cannot be edited into holding more than its owner.
   */
  async updateExecutive({ actor, executiveId, permissions }) {
    const row = await this.#assertOwned(actor, executiveId);
    const granted = await this.#assertGrantable(actor, permissions);

    await this.models.Executives.update(
      { permissions: { authority: granted } },
      { where: { id: executiveId } }
    );

    this.logger?.warn(
      { actorStaffId: actor.id, executiveId, before: this.#parsePermissions(row.permissions), after: granted },
      'Sub-login permissions changed'
    );

    return this.getExecutive({ actor, executiveId });
  }

  /**
   * @legacy PATCH /lords/access/executives/:id/password
   * @legacy PATCH /lords/access/marketing-users/:id/password
   */
  async resetPassword({ actor, executiveId, password }) {
    await this.#assertOwned(actor, executiveId);

    await this.models.Executives.update(
      { password: await hashPassword(password, PASSWORD_ROUNDS) },
      { where: { id: executiveId } }
    );

    this.logger?.warn({ actorStaffId: actor.id, executiveId }, 'Sub-login password reset');
    return { executiveId: Number(executiveId), changed: true };
  }

  /**
   * @legacy PATCH /lords/access/executives/:id/lock
   * @legacy PATCH /lords/access/marketing-users/:id/lock
   *
   * Suspend or restore a sub-login. The unlock is the direction worth
   * auditing — the route does.
   */
  async setStatus({ actor, executiveId, status }) {
    await this.#assertOwned(actor, executiveId);

    await this.models.Executives.update({ status }, { where: { id: executiveId } });

    this.logger?.warn({ actorStaffId: actor.id, executiveId, status }, 'Sub-login status changed');
    return this.getExecutive({ actor, executiveId });
  }

  async getExecutive({ actor, executiveId }) {
    const row = await this.#assertOwned(actor, executiveId);
    return this.#shape(row);
  }

  // ══════════════════════════════════════════════════════════════════════

  /**
   * Every requested permission must be one the actor holds.
   *
   * `hasPermission` understands the wildcard, so an actor with `*` may grant
   * anything and an actor with `reports:read` may grant exactly that. Unknown
   * permission strings are refused too — legacy would have stored them, and a
   * typo'd permission that silently means nothing is worse than one that fails.
   */
  async #assertGrantable(actor, permissions) {
    const requested = this.#parsePermissions(permissions) ?? [];
    if (!Array.isArray(requested) || !requested.length) {
      throw errors.NOT_PERMITTED({ reason: 'give at least one permission' });
    }

    const unknown = requested.filter((p) => p !== '*' && !ALL_PERMISSIONS.includes(p));
    if (unknown.length) throw errors.NOT_PERMITTED({ reason: 'unknown permissions', unknown });

    const held = actor.permissions ?? [];
    const escalating = requested.filter((p) => !hasPermission(held, p));
    if (escalating.length) throw errors.PERMISSION_ESCALATION({ requested: escalating });

    return requested;
  }

  /** An executive belongs to exactly one staff member — its parent. */
  async #assertOwned(actor, executiveId) {
    const row = await this.models.Executives.findByPk(executiveId, { raw: true });
    if (!row) throw errors.NOT_FOUND({ executiveId });
    if (Number(row.parent_staff_id) !== Number(actor.id)) throw errors.NOT_YOURS({ executiveId });
    return row;
  }

  /**
   * The permission list, from any of the shapes this column has held.
   *
   * Legacy stored `{groups, pages, authority}` and `resolvePermissions` reads
   * `.authority` or `.permissions` or a bare array, because all three exist in
   * the table. New rows are written as `{authority: [...]}`; old ones are read
   * as they are.
   */
  #parsePermissions(value) {
    if (!value) return null;
    const parsed = typeof value === 'string' ? this.#safeParse(value) : value;
    if (!parsed) return null;
    if (Array.isArray(parsed)) return parsed;
    return parsed.authority ?? parsed.permissions ?? null;
  }

  #safeParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      this.logger?.warn('An executive permissions column does not hold valid JSON');
      return null;
    }
  }

  #shape(row) {
    return {
      id: row.id,
      username: row.username,
      kind: row.kind,
      status: row.status,
      parentStaffId: row.parent_staff_id,
      parentRoleAtCreation: row.parent_role_snapshot ?? null,
      permissions: this.#parsePermissions(row.permissions) ?? [],
      lastLogin: row.last_login ?? null,
      // Never `password`, and never `last_login_ip` on a listing — it is on the
      // row for investigation, not for a management screen.
    };
  }

  #shapeActivity(row) {
    return {
      id: row.id,
      executiveId: row.executive_id,
      action: row.action,
      targetType: row.target_type ?? null,
      targetId: row.target_id ?? null,
      details: row.details ?? null,
      ip: row.ip ?? null,
      status: row.status ?? null,
      error: row.error_message ?? null,
      createdAt: row.created_at ?? null,
    };
  }
}

module.exports = { AccessService };
