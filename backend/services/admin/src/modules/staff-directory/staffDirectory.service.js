'use strict';

const { Op } = require('sequelize');
const {
  resolvePermissions,
  verifyPassword,
  safeCompare,
  BCRYPT_PATTERN,
  STAFF_LEVELS,
  isLoginPasswordMode,
} = require('@ibitplay/auth');

/**
 * Staff identity resolution — the authority every service defers to.
 *
 * admin-service owns `staff`, `roles` and `executives`. sports-service and
 * casino-service do not load those models, so when they verify a staff token
 * they call this over the internal API rather than reading the tables.
 *
 * Resolved from the CURRENT row on every request, never from the token. A staff
 * member demoted, locked or deleted five seconds ago stops having authority now
 * — not when their 8-hour token expires. That is the whole reason this is a
 * lookup instead of a claim in the JWT.
 */
async function resolveStaff(models, staffId, executiveId = null) {
  const { Staff, Roles, Executives } = models;

  const staff = await Staff.findByPk(staffId, {
    attributes: [
      'id',
      'name',
      'email',
      'role_id',
      'parent_id',
      'status',
      'system_locked',
      'bet_status',
      'sports_betlocked',
      'casino_locked',
      'agent_code',
      'percentage',
      'must_change_password',
    ],
    include: [{ model: Roles, as: 'role', attributes: ['id', 'name', 'level', 'responsibilities'], required: false }],
    raw: true,
    nest: true,
  });

  if (!staff) return null;

  const level = staff.role?.level ?? null;
  const rolePermissions = roleGrants(staff.role?.responsibilities);

  let executive = null;

  if (executiveId) {
    executive = await Executives.findByPk(executiveId, {
      attributes: ['id', 'username', 'parent_staff_id', 'permissions', 'status', 'kind'],
      raw: true,
    });
    // A missing executive is reported as such rather than silently falling back
    // to the parent's full authority.
    if (!executive) return { ...staff, executive: null, permissions: [] };
  }

  /**
   * `resolvePermissions` intersects an executive's grants with its parent's, so
   * a sub-account can never hold authority the parent does not.
   *
   * The RAW column goes in, with `isExecutive`. It used to pass through
   * `normalisePermissions` first, which returns null for the `{authority: [...]}`
   * object the access module writes, for prose, and for an empty column — and
   * null told `resolvePermissions` "not an executive", so every such executive
   * held its parent's FULL authority. An unreadable grant is now no grant.
   */
  const permissions = resolvePermissions({
    level,
    rolePermissions,
    executivePermissions: executive ? executive.permissions : null,
    isExecutive: Boolean(executive),
  });

  // A staff ROW whose role is EXECUTIVE acts with its parent's authority; the
  // level-gated guards (e.g. `denyAgentTree`) need the parent's level to know
  // which side of the house/agent line it sits on.
  let parentLevel = null;
  if (level === STAFF_LEVELS.EXECUTIVE && staff.parent_id) {
    const parent = await Staff.findByPk(staff.parent_id, {
      attributes: ['id'],
      include: [{ model: Roles, as: 'role', attributes: ['level'], required: false }],
      raw: true,
      nest: true,
    });
    parentLevel = parent?.role?.level ?? null;
  }

  // A suspended or system-locked account ANYWHERE above this one stops it
  // too — on an existing token, not only at the next login. The auth guard
  // refuses a non-null `uplineBlocked`.
  const upline = await uplineBlock(models, staff.id);

  return {
    ...staff,
    level,
    parentLevel,
    roleName: staff.role?.name ?? null,
    permissions,
    executive,
    uplineBlocked: upline ? { staffId: upline.staffId, reason: upline.reason } : null,
  };
}

/**
 * The first staff account at or above `staffId` that blocks it: suspended or
 * inactive (`status` ≠ active) or system-locked. `includeSelf: false` asks
 * only about the ancestors (the account's own row is checked by its caller).
 *
 * One read of `staff_hierarchy` (the closure table: every ancestor at any
 * depth) and one of `staff`. Returns null when nothing blocks it, or when the
 * account does not exist.
 *
 * @returns {Promise<null | { staffId: number, reason: 'suspended'|'inactive'|'locked' }>}
 */
async function uplineBlock(models, staffId, { includeSelf = false } = {}) {
  const { Staff, StaffHierarchy } = models;
  const id = Number(staffId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;

  let ids = [];
  if (StaffHierarchy) {
    const rows = await StaffHierarchy.findAll({
      where: { descendant_id: id, ...(includeSelf ? {} : { ancestor_id: { [Op.ne]: id } }) },
      attributes: ['ancestor_id'],
      raw: true,
    });
    ids = rows.map((r) => Number(r.ancestor_id));
  }
  if (includeSelf && !ids.includes(id)) ids.push(id);
  if (!ids.length) return null;

  const blocked = await Staff.findOne({
    where: {
      id: ids,
      [Op.or]: [
        { system_locked: true },
        { status: { [Op.ne]: 'active' } },
      ],
    },
    attributes: ['id', 'status', 'system_locked'],
    order: [['id', 'ASC']],
    raw: true,
  });
  if (!blocked) return null;

  return {
    staffId: Number(blocked.id),
    reason: blocked.status && blocked.status !== 'active' ? String(blocked.status) : 'locked',
  };
}

/**
 * Every staff account at or below `staffId` in the reporting tree.
 *
 * This is the answer to "whose players may this person see", and it is the
 * basis of every staff-scoped report on the platform. The legacy version was a
 * `WITH RECURSIVE` CTE copy-pasted into each report file, keyed off
 * `req.headers['x-staff-id']` — a raw header, on unauthenticated routes. Setting
 * `x-staff-id: 1` returned the whole platform's deposits.
 *
 * Here the id comes from a verified staff token and the tree is resolved by
 * admin-service, which owns the `staff` table. Other services ask for it.
 *
 * ── Why iteratively rather than a recursive CTE ──────────────────────────
 * A recursive CTE cannot be expressed through Sequelize's finders, and the rule
 * for this port is that queries go through models. A staff hierarchy is a few
 * levels deep and a few thousand rows wide, so a breadth-first walk costs one
 * cheap indexed query per level.
 *
 * `MAX_DEPTH` is not defensive padding: `staff.parent_id` has no constraint
 * preventing a cycle, and one bad row would otherwise spin here forever. If the
 * cap is ever hit that is a data problem, and it is logged as one.
 */
const MAX_DEPTH = 20;

async function descendantIds(models, staffId, { logger } = {}) {
  const { Staff } = models;

  const root = Number(staffId);
  if (!Number.isInteger(root) || root <= 0) return [];

  const seen = new Set([root]);
  let frontier = [root];
  let depth = 0;

  while (frontier.length) {
    if (++depth > MAX_DEPTH) {
      logger?.error(
        { staffId: root, found: seen.size },
        'Staff hierarchy walk hit the depth cap — parent_id probably contains a cycle'
      );
      break;
    }

    const children = await Staff.findAll({
      where: { parent_id: frontier },
      attributes: ['id'],
      raw: true,
    });

    frontier = [];
    for (const { id } of children) {
      const numeric = Number(id);
      // A cycle revisits an id we have already queued. Skipping it terminates
      // the walk rather than looping.
      if (seen.has(numeric)) continue;
      seen.add(numeric);
      frontier.push(numeric);
    }
  }

  return [...seen];
}

/**
 * The staff whose players THIS staff member may see.
 *
 * ── WHY THIS IS NOT JUST `descendantIds` ─────────────────────────────────
 *
 * The hierarchy below Super Master is a sales tree: a master sees their agents'
 * players and nobody else's, and `descendantIds` is exactly that. Super Admin,
 * Admin and Sub Admin are not in the sales tree at all — they are the site's
 * back office, and "full operations access" means every player on the site.
 *
 * The callers decide who sees a DIRECT signup (`parent_staff_id` NULL) by
 * asking whether the tree contains the root staff member, which was only ever
 * true for staff id 1 itself. So the site's own Admin — a child of the root
 * with nobody under them — got `[own id]`: no agents' players, no direct
 * signups, an empty Players screen on a site with players in it.
 *
 * ONLY THE SUPER ADMIN (level 1, the platform owner) reads the WHOLE tree,
 * root included — which is also what lets it see direct signups. Admin and
 * Sub Admin are scoped to their OWN subtree like every other level (the
 * Addaplay rule): an Admin under the owner sees its own Sub Admins, their
 * agents and their players, and nothing hanging from another Admin. Use this
 * for "which players may I see"; keep `descendantIds` for "whose subtree is
 * this" and for authority over staff.
 *
 * An EXECUTIVE staff row acts with its parent's authority (`resolveStaff`,
 * `effectiveStaffLevel`), so it sees what its parent sees: an executive under
 * an Admin reads the whole site, one under an agent reads that agent's players.
 * Its own grants stay its own (read-only by default). Walking down from the
 * executive's own row found nobody, so the role saw an empty Players screen.
 */

async function visibleStaffIds(models, staffId, { logger, hops = 0 } = {}) {
  const own = await descendantIds(models, staffId, { logger });
  if (!own.length) return own;

  const me = await models.Staff.findByPk(Number(staffId), { attributes: ['id', 'role_id', 'parent_id'], raw: true });
  const level = await levelOfRole(models, me?.role_id);
  if (level === STAFF_LEVELS.EXECUTIVE && me?.parent_id && hops < MAX_DEPTH) {
    const parents = await visibleStaffIds(models, me.parent_id, { logger, hops: hops + 1 });
    return [...new Set([...own, ...parents.map(Number)])];
  }
  // `<=`: a restored legacy owner role can carry level 0 (legacy's
  // `level !== 0` owner check); it is the owner too, never a lesser level.
  if (!Number.isFinite(level) || level > STAFF_LEVELS.SUPER_ADMIN) return own;

  return everyTree(models, own, { logger });
}

/**
 * The staff accounts this staff member may SEE AND MANAGE as staff — the
 * staff list and tree, staff detail, status, locks, limits and transfers.
 *
 * A Super Admin (level 1) is the site's owner: every staff tree on the site,
 * whatever row it hangs from. Walking down from their own row is not that —
 * the bootstrap Super Admin and a seeded `demo_superadmin` are both roots
 * (`parent_id` NULL), so each saw only its own tree and the bootstrap account
 * listed none of the demo staff.
 *
 * Every other level, Admin and Sub Admin included, keeps its own subtree:
 * authority over a staff account still means being above it in the tree.
 * (Which PLAYERS a back-office role may read is `visibleStaffIds`.)
 *
 * `level` is the caller's resolved session level (`req.staff.level`, read from
 * the current row by `resolveStaff`); without it the row's role is looked up.
 */
async function manageableStaffIds(models, staffId, { logger, level } = {}) {
  const own = await descendantIds(models, staffId, { logger });
  if (!own.length) return own;

  let actorLevel = level == null ? NaN : Number(level);
  if (level == null) {
    const me = await models.Staff.findByPk(Number(staffId), { attributes: ['id', 'role_id'], raw: true });
    actorLevel = await levelOfRole(models, me?.role_id);
  }
  if (actorLevel !== STAFF_LEVELS.SUPER_ADMIN) return own;

  return everyTree(models, own, { logger });
}

async function levelOfRole(models, roleId) {
  if (roleId == null) return NaN;
  const role = await models.Roles.findByPk(roleId, { attributes: ['level'], raw: true });
  return Number(role?.level);
}

/** `own` plus every staff account under every root (`parent_id` NULL) on the site. */
async function everyTree(models, own, { logger } = {}) {
  const roots = await models.Staff.findAll({ where: { parent_id: null }, attributes: ['id'], raw: true });
  const all = new Set(own.map(Number));
  for (const { id } of roots) {
    for (const found of await descendantIds(models, id, { logger })) all.add(Number(found));
  }
  return [...all];
}

/**
 * `roles.responsibilities` and `executives.permissions` are JSON in the schema
 * but arrive as a string, an array, or null depending on how the row was
 * written. Anything unparseable is treated as "no grants" — failing closed is
 * the only safe direction for a permission list.
 */
function normalisePermissions(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.map(String);

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : null;
    } catch {
      // Legacy rows sometimes hold a bare comma-separated list.
      return value.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }

  return null;
}

/**
 * Role grants from `roles.responsibilities`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THAT COLUMN IS PROSE, AND READING IT AS A PERMISSION LIST LOCKED EVERY
 * STAFF MEMBER OUT OF EVERY PERMISSIONED ROUTE.
 *
 * The seeder writes sentences into it — `'Unrestricted access to every
 * function.'` for Super Admin — and the restored production rows are the same
 * shape (`'Full platform control, infinite balance'`). Passing that through
 * `normalisePermissions` does not fail: the JSON parse throws, the
 * comma-separated fallback catches it, and the result is a NON-EMPTY array of
 * one or two English fragments.
 *
 * Non-empty is the fatal part. `resolvePermissions` takes
 * `rolePermissions?.length ? rolePermissions : LEVEL_PERMISSIONS[level]`, so a
 * junk list of length 1 SHADOWS the real table — and a Super Admin whose level
 * entitles them to `['*']` was instead granted exactly
 * `['Full platform control', 'infinite balance']`, which satisfies nothing.
 *
 * Every permissioned admin route answered 403, for everyone, including the
 * owner. `GET /access/me/permissions` reported the correct `['*']` because it
 * is built from `resolvePermissions` at LOGIN — so the panel showed full
 * authority in one place and was refused in every other.
 *
 * There is no `roles.permissions` column anywhere in the baseline or the 34
 * migrations. Role authority is meant to come from `LEVEL_PERMISSIONS`, keyed
 * on `roles.level`, and this returns `null` so that fallback is reached.
 *
 * A JSON ARRAY is still honoured, because that is an unambiguous statement of
 * intent — if the column is ever repurposed to hold real grants, they work. A
 * sentence is not, so a sentence yields nothing.
 * ═════════════════════════════════════════════════════════════════════════
 */
function roleGrants(value) {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch {
    // Prose. Not a grant list, and emphatically not an empty-ish one to fall
    // back from — see above.
    return null;
  }
}

/**
 * The staff member's second factor for consequential actions.
 *
 * Payouts, balance adjustments and provider toggles all ask for it. Every one
 * of those lives in a different service, and none of them may read `staff` —
 * so the check happens here, once, and the others ask over the internal API.
 *
 * ── ON THE STORED VALUE ──────────────────────────────────────────────────
 * `staff.transaction_password` is PLAINTEXT in the legacy schema; the helper it
 * replaces says so out loud:
 *
 *     // transaction_password is stored in plaintext (same as password2)
 *     if (rows[0].transaction_password !== transactionPassword) throw ...
 *
 * Rehashing the column is a migration with an operational cutover behind it —
 * every staff member has to set theirs again, because a plaintext value cannot
 * be verified once hashed and there is no session to prompt from. That is a
 * decision for whoever runs the platform, not a side effect of a port.
 *
 * What is done here: a bcrypt hash is verified as one, and a plaintext value is
 * compared in constant time rather than with `!==`. So the column can be
 * migrated to hashes one row at a time, with no code change, and until then a
 * wrong guess leaks nothing about how much of it was right.
 *
 * Returns a boolean. The caller decides what a false means — this function has
 * no opinion about status codes.
 */
async function verifyTransactionPassword(models, staffId, candidate, { executiveId = null } = {}) {
  if (typeof candidate !== 'string' || !candidate) return false;

  // TXN_PASSWORD_MODE=login (the default): the transaction password IS the
  // login password — the same bcrypt compare the staff sign-in runs. An
  // executive session is checked against the executive's OWN login password
  // (and only when that executive belongs to `staffId`), never its parent's.
  if (isLoginPasswordMode()) return verifyLoginPassword(models, staffId, candidate, { executiveId });

  const staff = await models.Staff.findByPk(staffId, {
    attributes: ['id', 'transaction_password'],
    raw: true,
  });

  const stored = staff?.transaction_password;

  // No staff member, or one who has never set a second factor. Both refuse:
  // an unset transaction password must not mean "any password works".
  if (!stored) {
    // Burn a comparison anyway, so "no such staff" is not measurably faster
    // than "wrong password".
    await verifyPassword(candidate, null);
    return false;
  }

  if (BCRYPT_PATTERN.test(stored)) return verifyPassword(candidate, stored);

  return safeCompare(candidate, stored);
}

/** The login-password half of `verifyTransactionPassword` (TXN_PASSWORD_MODE=login). */
async function verifyLoginPassword(models, staffId, candidate, { executiveId = null } = {}) {
  let hash = null;
  if (executiveId) {
    const executive = models.Executives
      ? await models.Executives.findOne({
          where: { id: executiveId, parent_staff_id: staffId, status: 'active' },
          attributes: ['id', 'password'],
          raw: true,
        })
      : null;
    hash = executive?.password ?? null;
  } else {
    const staff = await models.Staff.findByPk(staffId, { attributes: ['id', 'password'], raw: true });
    hash = staff?.password ?? null;
  }
  // No hash still burns a bcrypt comparison inside `verifyPassword`, so "no
  // such account" is not measurably faster than "wrong password".
  return verifyPassword(candidate, hash);
}

/**
 * Is sports betting locked anywhere at or above this staff account.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY "AT OR ABOVE" AND NOT JUST "AT"
 *
 * A lock on an agent is meant to stop that agent's whole downline betting.
 * Legacy expressed this correctly in the bet path:
 *
 *     SELECT 1 FROM staff_hierarchy h
 *     JOIN staff s ON s.id = h.ancestor_id
 *     WHERE h.descendant_id = $1 AND (s.sports_betlocked OR s.system_locked)
 *
 * — and then exposed a toggle endpoint that could flip any single staff row,
 * with no authentication and no tree check. So the CHECK understood the
 * hierarchy and the CONTROL did not.
 *
 * `staff_hierarchy` is admin-service's table, so this answers for whoever asks
 * rather than each service joining it themselves.
 */
async function betLockState(models, staffId, { logger } = {}) {
  const { Staff, StaffHierarchy } = models;

  const self = await Staff.findByPk(staffId, {
    attributes: ['id', 'name', 'sports_betlocked', 'system_locked', 'status', 'parent_id'],
    raw: true,
  });
  if (!self) return { staffId: Number(staffId), locked: false, found: false };

  const suspended = (row) => row.status != null && row.status !== 'active';
  if (self.sports_betlocked || self.system_locked || suspended(self)) {
    return {
      staffId: Number(staffId),
      locked: true,
      found: true,
      lockedBy: Number(staffId),
      reason: suspended(self) ? `account ${self.status}` : self.system_locked ? 'account locked' : 'sports betting locked',
    };
  }

  if (!StaffHierarchy) {
    // Without the closure table only the account's own flag is knowable. Say
    // so rather than reporting "not locked", which would be a guess in the
    // direction that lets a bet through.
    logger?.warn({ staffId }, 'staff_hierarchy is not available — only this account was checked');
    return { staffId: Number(staffId), locked: false, found: true, partial: true };
  }

  const ancestors = await StaffHierarchy.findAll({
    where: { descendant_id: staffId },
    attributes: ['ancestor_id'],
    raw: true,
  });
  const ids = ancestors.map((a) => a.ancestor_id).filter((id) => Number(id) !== Number(staffId));
  if (!ids.length) return { staffId: Number(staffId), locked: false, found: true };

  const locked = await Staff.findOne({
    where: {
      id: ids,
      [Op.or]: [{ sports_betlocked: true }, { system_locked: true }, { status: { [Op.ne]: 'active' } }],
    },
    attributes: ['id', 'sports_betlocked', 'system_locked', 'status'],
    raw: true,
  });

  return {
    staffId: Number(staffId),
    locked: Boolean(locked),
    found: true,
    ...(locked
      ? {
          lockedBy: Number(locked.id),
          reason: suspended(locked)
            ? 'an ancestor account is suspended'
            : locked.system_locked
              ? 'an ancestor account is locked'
              : 'locked by an administrator',
        }
      : {}),
  };
}

/**
 * The staff accounts this caller may lock, with their current state.
 *
 * Scoped to the staff the caller manages (`manageableStaffIds`: their own
 * subtree, or the whole site for a Super Admin) — legacy returned whatever
 * `visibleStaffIds(req.headers['x-staff-id'])` produced, and that header is
 * set by the caller.
 */
async function betLockList(models, staffId, { logger } = {}) {
  const ids = await manageableStaffIds(models, staffId, { logger });

  const rows = await models.Staff.findAll({
    where: { id: ids },
    attributes: ['id', 'name', 'sports_betlocked', 'system_locked', 'parent_id'],
    order: [['id', 'ASC']],
    raw: true,
  });

  return rows.map((s) => ({
    staffId: s.id,
    name: s.name,
    sportsLocked: Boolean(s.sports_betlocked),
    accountLocked: Boolean(s.system_locked),
    parentId: s.parent_id ?? null,
  }));
}

/**
 * Lock or unlock a staff account's sports betting.
 *
 *   THE LEGACY ENDPOINT WAS `UPDATE staff SET sports_betlocked = $1 WHERE
 *   id = $2` WITH NO AUTHENTICATION AND NO TREE CHECK. One request unlocked an
 *   entire downline, and nothing recorded that it had happened.
 *
 * The target must be inside the actor's subtree, and an actor cannot change
 * their own lock — otherwise a locked agent lifts their own lock.
 */
async function setBetLock(models, { staffId, locked, actorStaffId }, { logger } = {}) {
  if (Number(staffId) === Number(actorStaffId)) {
    return { ok: false, reason: 'an account cannot change its own bet lock' };
  }

  const visible = await manageableStaffIds(models, actorStaffId, { logger });
  if (!visible.map(Number).includes(Number(staffId))) {
    return { ok: false, reason: 'that account is not in your hierarchy' };
  }

  const [affected] = await models.Staff.update({ sports_betlocked: locked }, { where: { id: staffId } });
  if (!affected) return { ok: false, reason: 'no such staff account' };

  logger?.warn(
    { staffId, locked, actorStaffId },
    locked ? 'Staff subtree locked out of sports betting' : 'Staff subtree UNLOCKED for sports betting'
  );

  return { ok: true, staffId: Number(staffId), sportsLocked: locked };
}


/**
 * Money moved between a player and staff.
 *
 * `staff_transfers` is admin-owned, so user-service asks rather than reading a
 * table it does not load.
 *
 * ── THE DIRECTION WAS COMPUTED IN THE QUERY, WITH A FALLBACK ─────────────
 *
 * Legacy's version was a CASE expression per row:
 *
 *     CASE WHEN from_type='staff' AND to_type='user' AND to_id=$1 THEN 'credit'
 *          WHEN from_type='user' AND to_type='staff' AND from_id=$1 THEN 'debit'
 *          ELSE direction
 *
 * The `ELSE direction` is the interesting part: it falls back to a stored
 * column for any row the two cases miss — user-to-user transfers, or rows where
 * `from_type`/`to_type` say something else — and that column is written
 * independently, so a row could say `direction = 'credit'` while the ids say
 * the money went the other way. Direction is derived from the ids here, and a
 * row that matches neither side is reported as `unknown` rather than trusting a
 * second source that may disagree.
 */
async function transfersForUser(models, userId, { limit = 50, offset = 0 } = {}) {
  const { StaffTransfers } = models;

  const { rows, count } = await StaffTransfers.findAndCountAll({
    where: {
      [Op.or]: [
        { to_type: 'user', to_id: userId },
        { from_type: 'user', from_id: userId },
      ],
    },
    order: [['id', 'DESC']],
    limit,
    offset,
    raw: true,
  });

  return {
    total: count,
    rows: rows.map((r) => ({
      id: r.id,
      amount: String(r.amount ?? '0'),
      // Derived, never read from the stored `direction` column.
      direction:
        r.to_type === 'user' && String(r.to_id) === String(userId)
          ? 'credit'
          : r.from_type === 'user' && String(r.from_id) === String(userId)
            ? 'debit'
            : 'unknown',
      transferType: r.transfer_type ?? null,
      note: r.note ?? null,
      createdAt: r.created_at ?? null,
    })),
  };
}

module.exports = {
  uplineBlock,
  transfersForUser,
  betLockState,
  betLockList,
  setBetLock,
  resolveStaff,
  descendantIds,
  visibleStaffIds,
  manageableStaffIds,
  normalisePermissions,
  verifyTransactionPassword,
  MAX_DEPTH,
};
