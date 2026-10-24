'use strict';

const { Op } = require('@ibitplay/db');

const { descendantIds } = require('../staff-directory/staffDirectory.service');

/** The target kinds an activity row can name, and where each name lives. */
const TARGET_SOURCES = {
  USER: { model: 'Users', name: 'name' },
  STAFF: { model: 'Staff', name: 'name' },
  EXECUTIVE: { model: 'Executives', name: 'username' },
};

/**
 * The staff audit trail.
 *
 * One table, one writer. Legacy had every module writing `admin_activity_logs`
 * directly from whichever process handled the request, which meant the shape of
 * a row depended on which handler wrote it — some carried `details`, some
 * didn't, and nothing recorded whether the action had actually succeeded.
 *
 * Here the row is written from a validated payload, always carries the outcome,
 * and always names the service that performed the action.
 */
class AuditService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  async record(entry) {
    const { AdminActivityLogs } = this.models;

    // The actor's name and role are denormalised onto the row on purpose: an
    // audit trail has to stay readable after the staff account is renamed or
    // deleted, and a join to a row that no longer exists reads as "unknown".
    const actor = await this.#describeActor(entry.staffId);

    const row = await AdminActivityLogs.create({
      staff_id: entry.staffId,
      executive_id: entry.executiveId ?? null,
      actor_name: actor.name,
      actor_role: actor.role,
      actor_level: actor.level,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      details: {
        ...(entry.details || {}),
        service: entry.service ?? null,
        method: entry.method ?? null,
        path: entry.path ?? null,
        statusCode: entry.statusCode ?? null,
        requestId: entry.requestId ?? null,
      },
      ip: entry.ip ?? null,
      user_agent: entry.userAgent ?? null,
      status: entry.outcome,
      error_message: entry.errorMessage ?? null,
    });

    return row.get({ plain: true });
  }

  /**
   * @legacy GET /lords/access/activity
   *
   * The platform-wide activity log — every action by every actor in the
   * caller's tree.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * THIS IS THE ONE THE SCREEN WANTS. THE OTHER ONE IS A DIFFERENT TABLE.
   *
   * `/admin/access/activity` reads `executive_activity_logs` scoped to the
   * EXECUTIVES beneath the caller — the sub-login trail, and a deliberately
   * narrow thing. This reads `admin_activity_logs`, the unified trail every
   * actor writes to, which is what legacy's `/lords/access/activity` served
   * and what the Activity Log screen renders columns for.
   *
   * The two names are one letter apart in the endpoint list and the panel was
   * pointed at the wrong one, so it queried a table holding no rows and
   * reported "0 entries" over a log with a thousand in it. Legacy's own
   * migration says it plainly: `admin_activity_logs` "supersedes the
   * executive-only executive_activity_logs".
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Scope is the caller's own tree. Legacy branched on `level === 0` — the
   * platform owner saw everything, everyone else got the closure table. Here
   * the closure walk runs for everyone and the owner's tree happens to be the
   * whole platform, which is one rule instead of two that can disagree.
   */
  async list({ actor, staffId, action, status, targetType, targetId, q, from, to, limit = 50, offset = 0 }) {
    const { AdminActivityLogs } = this.models;

    const tree = await descendantIds(this.models, actor.id, { logger: this.logger });

    /**
     * A `staffId` filter NARROWS the tree, it does not replace it — otherwise
     * the filter is a way to read an account you have no authority over.
     */
    const scope = staffId ? tree.filter((id) => Number(id) === Number(staffId)) : tree;
    if (!scope.length) {
      return { rows: [], count: 0 };
    }

    const like = q ? `%${q}%` : null;

    const { rows, count } = await AdminActivityLogs.findAndCountAll({
      where: {
        staff_id: scope,
        // Exact, as legacy had it: the screen sends a key from a fixed list,
        // and a substring match makes `user.lock` also answer `user.lock.x`.
        ...(action ? { action } : {}),
        ...(status ? { status } : {}),
        ...(targetType ? { target_type: targetType } : {}),
        ...(targetId ? { target_id: String(targetId) } : {}),
        ...(from || to
          ? {
            created_at: {
              ...(from ? { [Op.gte]: new Date(from) } : {}),
              ...(to ? { [Op.lte]: new Date(to) } : {}),
            },
          }
          : {}),
        ...(like
          ? {
            [Op.or]: [
              { actor_name: { [Op.iLike]: like } },
              { target_id: { [Op.iLike]: like } },
              { ip: { [Op.iLike]: like } },
            ],
          }
          : {}),
      },
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit,
      offset,
      raw: true,
    });

    const names = await this.#targetNames(rows);

    return { rows: rows.map((row) => this.#shape(row, names)), count };
  }

  /**
   * A readable name for each row's target, in one query per kind.
   *
   * Lets the screen say "Credited 100 INR to user Test 222" rather than
   * "… to user #3929649457". Legacy's `attachTargetNames`, kept — including
   * its forgiveness: a target whose row has since been deleted resolves to
   * null and the entry still reads, because an audit trail that hides an
   * action once its subject is gone is not an audit trail.
   */
  async #targetNames(rows) {
    const wanted = new Map(Object.keys(TARGET_SOURCES).map((type) => [type, new Set()]));

    for (const row of rows) {
      const type = String(row.target_type || '').toUpperCase();
      if (row.target_id && wanted.has(type)) wanted.get(type).add(String(row.target_id));
    }

    const resolved = new Map(Object.keys(TARGET_SOURCES).map((type) => [type, new Map()]));

    await Promise.all(
      [...wanted].map(async ([type, ids]) => {
        if (!ids.size) return;
        const source = TARGET_SOURCES[type];
        const model = this.models[source.model];
        if (!model) return;

        try {
          const found = await model.findAll({
            where: { id: [...ids] },
            attributes: ['id', source.name],
            raw: true,
          });
          for (const row of found) resolved.get(type).set(String(row.id), row[source.name] ?? null);
        } catch (error) {
          // A missing table or column must not cost the reader the whole log.
          this.logger?.warn({ err: error, type }, 'Could not resolve audit target names');
        }
      })
    );

    return resolved;
  }

  /** One `admin_activity_logs` row as the API entry. Legacy's `mapActivityRow`. */
  #shape(row, names) {
    const type = String(row.target_type || '').toUpperCase();
    const targetName = row.target_id ? names.get(type)?.get(String(row.target_id)) ?? null : null;

    return {
      id: Number(row.id),
      staffId: row.staff_id,
      executiveId: row.executive_id ?? null,
      actorName: row.actor_name ?? null,
      actorRole: row.actor_role ?? null,
      actorLevel: row.actor_level ?? null,
      action: row.action,
      targetType: row.target_type ?? null,
      targetId: row.target_id ?? null,
      targetName,
      details: row.details ?? null,
      ip: row.ip ?? null,
      country: row.country ?? null,
      region: row.region ?? null,
      city: row.city ?? null,
      /** One printable place, as the screen's Location column expects. */
      location: [row.city, row.region, row.country].filter(Boolean).join(', ') || null,
      userAgent: row.user_agent ?? null,
      status: row.status,
      errorMessage: row.error_message ?? null,
      createdAt: row.created_at,
    };
  }

  /** Never let a failed actor lookup lose the audit row — the action still happened. */
  async #describeActor(staffId) {
    try {
      const { Staff, Roles } = this.models;
      const staff = await Staff.findByPk(staffId, {
        attributes: ['id', 'name'],
        include: [{ model: Roles, as: 'role', attributes: ['name', 'level'], required: false }],
        raw: true,
        nest: true,
      });

      return {
        name: staff?.name ?? null,
        role: staff?.role?.name ?? null,
        level: staff?.role?.level ?? null,
      };
    } catch (error) {
      this.logger?.warn({ err: error, staffId }, 'Could not describe audit actor — recording without it');
      return { name: null, role: null, level: null };
    }
  }
}

module.exports = { AuditService };
