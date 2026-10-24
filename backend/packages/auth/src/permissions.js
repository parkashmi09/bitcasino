'use strict';

/**
 * Role and permission model.
 *
 * Two independent ladders:
 *
 *   Players  — a flat `role` on the user row plus account status flags.
 *   Staff    — a numbered `level` from the `roles` table, where LOWER means
 *              more authority (level 1 outranks level 5). Level drives the
 *              agent hierarchy: a staff member can only ever act on someone
 *              strictly below them.
 *
 * Permissions are strings shaped `resource:action`. `users:read` is a specific
 * grant; `users:*` covers the resource; `*` is unrestricted. Checking a wildcard
 * grant is what lets a role be widened without touching route definitions.
 */

const PLAYER_ROLES = { PLAYER: 'player', VIP: 'vip', AFFILIATE: 'affiliate' };

/** Canonical staff levels. The DB `roles` table is authoritative; these are the defaults. */
const STAFF_LEVELS = {
  SUPER_ADMIN: 1,
  ADMIN: 2,
  SUB_ADMIN: 3,
  SUPER_MASTER: 4,
  MASTER: 5,
  AGENT: 6,
  EXECUTIVE: 7,
};

/** Every permission the platform knows about, grouped by the service that enforces it. */
const PERMISSIONS = {
  // user-service
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  USERS_LOCK: 'users:lock',
  USERS_DELETE: 'users:delete',
  USERS_IMPERSONATE: 'users:impersonate',

  // wallet (inside user-service)
  WALLET_READ: 'wallet:read',
  WALLET_CREDIT: 'wallet:credit',
  WALLET_DEBIT: 'wallet:debit',
  WALLET_ADJUST: 'wallet:adjust',

  // payments
  DEPOSITS_READ: 'deposits:read',
  DEPOSITS_APPROVE: 'deposits:approve',
  WITHDRAWALS_READ: 'withdrawals:read',
  WITHDRAWALS_APPROVE: 'withdrawals:approve',

  // casino-service
  CASINO_READ: 'casino:read',
  CASINO_MANAGE: 'casino:manage',
  CASINO_SETTLE: 'casino:settle',
  /** Admin → Casino → Original Games (dashboard, bets, games). Super Admin + its executives only. */
  ORIGINALS_READ: 'originals:read',

  // sports-service
  SPORTS_READ: 'sports:read',
  SPORTS_MANAGE: 'sports:manage',
  SPORTS_SETTLE: 'sports:settle',
  // Reversing an ALREADY-PAID settlement is a strictly larger power than
  // settling one, and it is the action legacy left unauthenticated. It gets its
  // own grant so `sports:settle` cannot be widened into it by accident.
  SPORTS_VOID_SETTLED: 'sports:void-settled',

  // admin-service
  STAFF_READ: 'staff:read',
  STAFF_WRITE: 'staff:write',
  ROLES_MANAGE: 'roles:manage',
  CONFIG_READ: 'config:read',
  CONFIG_WRITE: 'config:write',
  /** Issue fixed-amount redeem codes from the admin panel. */
  REDEEM_CODES_WRITE: 'redeem:write',
  REPORTS_READ: 'reports:read',
  AUDIT_READ: 'audit:read',
};

const ALL = Object.values(PERMISSIONS);

/** Default grants per staff level. A role row in the DB can override these. */
const LEVEL_PERMISSIONS = {
  [STAFF_LEVELS.SUPER_ADMIN]: ['*'],
  [STAFF_LEVELS.ADMIN]: ALL.filter((p) => p !== PERMISSIONS.ROLES_MANAGE),
  [STAFF_LEVELS.SUB_ADMIN]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_WRITE,
    PERMISSIONS.USERS_LOCK,
    PERMISSIONS.WALLET_READ,
    PERMISSIONS.WALLET_CREDIT,
    PERMISSIONS.WALLET_DEBIT,
    PERMISSIONS.DEPOSITS_READ,
    PERMISSIONS.DEPOSITS_APPROVE,
    PERMISSIONS.WITHDRAWALS_READ,
    PERMISSIONS.WITHDRAWALS_APPROVE,
    PERMISSIONS.CASINO_READ,
    PERMISSIONS.SPORTS_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.STAFF_READ,
    // A sub admin builds its own super masters and executives — scoped in
    // `StaffService.create` by `CHILD_LEVELS` and to its own subtree.
    PERMISSIONS.STAFF_WRITE,
    PERMISSIONS.CONFIG_READ,
    PERMISSIONS.REDEEM_CODES_WRITE,
  ],
  /**
   * The agent tree (B2B). `staff:write` lets a super master build masters and
   * agents beneath itself, and a master agents beneath itself. It is SCOPED in
   * `StaffService`: a creator may only create (or re-level) an account strictly
   * below its own level, under itself or one of its own descendants, and may
   * only edit, reset or remove accounts strictly below it in its own subtree.
   */
  [STAFF_LEVELS.SUPER_MASTER]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_WRITE,
    // Lock / suspend / bet-lock — own subtree only (`LordsService.setStatus`).
    PERMISSIONS.USERS_LOCK,
    PERMISSIONS.WALLET_READ,
    PERMISSIONS.WALLET_CREDIT,
    PERMISSIONS.WALLET_DEBIT,
    PERMISSIONS.CASINO_READ,
    PERMISSIONS.SPORTS_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.STAFF_READ,
    PERMISSIONS.STAFF_WRITE,
  ],
  [STAFF_LEVELS.MASTER]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_WRITE,
    PERMISSIONS.USERS_LOCK,
    PERMISSIONS.WALLET_READ,
    PERMISSIONS.WALLET_CREDIT,
    PERMISSIONS.WALLET_DEBIT,
    PERMISSIONS.REPORTS_READ,
    // A master sees and builds its own agents.
    PERMISSIONS.STAFF_READ,
    PERMISSIONS.STAFF_WRITE,
  ],
  /**
   * An agent runs players, never staff. `users:write` is what creating and
   * editing a player needs; every route behind it is tree-scoped in its
   * service (players, locks, KYC review, wager, single-player email), and an
   * agent's tree is itself — so it reaches its own players only.
   */
  [STAFF_LEVELS.AGENT]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_WRITE,
    PERMISSIONS.USERS_LOCK,
    PERMISSIONS.WALLET_READ,
    PERMISSIONS.WALLET_CREDIT,
    PERMISSIONS.WALLET_DEBIT,
    PERMISSIONS.REPORTS_READ,
  ],
  [STAFF_LEVELS.EXECUTIVE]: [PERMISSIONS.USERS_READ, PERMISSIONS.WALLET_READ, PERMISSIONS.REPORTS_READ],
};

/**
 * Which staff level each creator level may create through Sports Exchange ka
 * Create Account (`POST /admin/exchange/accounts-admin/create` → `StaffService.create`)
 * (the Addaplay ladder): every level creates ONLY the level directly below it,
 * inside its own tree. The Super Admin may create any level. An agent creates
 * players only. EXECUTIVE (7) is never created as a staff row — executives are
 * sub-logins made through `/admin/access/executives`.
 */
const CHILD_LEVELS = Object.freeze({
  [STAFF_LEVELS.SUPER_ADMIN]: Object.freeze([
    STAFF_LEVELS.ADMIN,
    STAFF_LEVELS.SUB_ADMIN,
    STAFF_LEVELS.SUPER_MASTER,
    STAFF_LEVELS.MASTER,
    STAFF_LEVELS.AGENT,
  ]),
  [STAFF_LEVELS.ADMIN]: Object.freeze([STAFF_LEVELS.SUB_ADMIN]),
  [STAFF_LEVELS.SUB_ADMIN]: Object.freeze([STAFF_LEVELS.SUPER_MASTER]),
  [STAFF_LEVELS.SUPER_MASTER]: Object.freeze([STAFF_LEVELS.MASTER]),
  [STAFF_LEVELS.MASTER]: Object.freeze([STAFF_LEVELS.AGENT]),
  [STAFF_LEVELS.AGENT]: Object.freeze([]),
});

/** May a creator at `creatorLevel` create a staff account at `level`? Fails closed. */
const canCreateLevel = (creatorLevel, level) =>
  Boolean(CHILD_LEVELS[Number(creatorLevel)]?.includes(Number(level)));

/**
 * Does `granted` satisfy `required`?
 * Matches exact grants, `resource:*` wildcards, and the global `*`.
 */
function hasPermission(granted, required) {
  if (!Array.isArray(granted) || !granted.length) return false;
  if (granted.includes('*')) return true;
  if (granted.includes(required)) return true;

  const [resource] = String(required).split(':');
  return granted.includes(`${resource}:*`);
}

const hasAnyPermission = (granted, required = []) => required.some((p) => hasPermission(granted, p));
const hasAllPermissions = (granted, required = []) => required.every((p) => hasPermission(granted, p));

/** `users:read`, `users:*` or `*` — the shape of a real grant. Prose is none of these. */
const GRANT_PATTERN = /^(\*|[a-z][a-z0-9-]*:(\*|[a-z][a-z0-9-]*))$/;

/**
 * An executive's grant list, from any shape the `executives.permissions`
 * column has held — a bare array, `{authority: [...]}`, `{permissions: [...]}`,
 * a JSON string of any of those, or a legacy comma-separated string.
 *
 * ALWAYS AN ARRAY, NEVER NULL. Null meant "no executive restriction" to
 * `resolvePermissions`, so an executive whose column was empty, prose, or an
 * object `normalisePermissions` did not understand used to inherit its
 * parent's FULL authority. Anything that is not a list of permission-shaped
 * strings is no grant at all.
 */
function executiveGrants(value) {
  let parsed = value;
  if (typeof parsed === 'string') {
    const text = parsed.trim();
    if (!text) return [];
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text.split(',');
    }
  }
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    parsed = Array.isArray(parsed.authority)
      ? parsed.authority
      : Array.isArray(parsed.permissions)
        ? parsed.permissions
        : [];
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter((p) => typeof p === 'string').map((p) => p.trim()).filter((p) => GRANT_PATTERN.test(p)))];
}

/**
 * Resolve the effective permission list for a staff member.
 *
 * An executive is a restricted sub-account of a staff member, so its grants are
 * intersected with the parent's — an executive can never be given authority the
 * parent does not itself hold.
 *
 * Pass `isExecutive: true` for an executive session. Its grant is then ALWAYS
 * intersected, and a missing or unreadable grant resolves to NOTHING — never to
 * the parent's authority. (A non-null `executivePermissions` also marks the
 * session as an executive's, for callers that predate the flag.)
 */
function resolvePermissions({ level, rolePermissions = null, executivePermissions = null, isExecutive = false }) {
  const base = rolePermissions?.length ? rolePermissions : LEVEL_PERMISSIONS[level] || [];
  if (!isExecutive && (executivePermissions === null || executivePermissions === undefined)) return base;

  const granted = executiveGrants(executivePermissions);

  if (base.includes('*')) return granted;
  return granted.filter((permission) => hasPermission(base, permission));
}

/**
 * Can `actorLevel` act on `targetLevel`?
 * Strictly-lower level only — equals cannot act on each other, which stops two
 * admins from demoting one another and stops any lateral privilege grab.
 */
const canActOn = (actorLevel, targetLevel) =>
  Number.isFinite(actorLevel) && Number.isFinite(targetLevel) && actorLevel < targetLevel;

/**
 * The agent tree — SUPER_MASTER, MASTER, AGENT. Product rule: these levels run
 * players and balances, never promotions. No bonus, code, gift card, spin
 * wheel, VIP/club, affiliate, race or rakeback screen or API is theirs.
 */
const AGENT_TREE_LEVELS = Object.freeze([
  STAFF_LEVELS.SUPER_MASTER,
  STAFF_LEVELS.MASTER,
  STAFF_LEVELS.AGENT,
]);

/**
 * The level a staff session acts with.
 *
 * An executive SESSION (executive login) already carries its parent's level —
 * the token's subject is the parent staff row. A staff ROW whose own role is
 * EXECUTIVE (level 7) acts with the authority of the staff member above it, so
 * its effective level is `parentLevel`. Unknown parent → stays 7, which every
 * level-gated check treats as the least senior.
 */
function effectiveStaffLevel({ level, parentLevel = null } = {}) {
  const own = level === null || level === undefined ? NaN : Number(level);
  if (own === STAFF_LEVELS.EXECUTIVE && parentLevel !== null && parentLevel !== undefined) {
    return Number(parentLevel);
  }
  return own;
}

/**
 * May this session ISSUE funds — pay out without drawing down a balance?
 *
 * The platform owner: a Super Admin's session, or an executive acting under one
 * (user, 2026-10-17: an executive may do whatever its granted permissions
 * allow, and every money route is behind its own permission). Legacy spelled
 * this `level === 0`; the levels start at 1, so the check matched nobody.
 */
function canIssueFunds(staff) {
  if (!staff) return false;
  return Number(staff.level) === STAFF_LEVELS.SUPER_ADMIN;
}

/** Is this staff session part of the agent tree (levels 4, 5, 6)? */
const isAgentTree = (staff) => AGENT_TREE_LEVELS.includes(effectiveStaffLevel(staff || {}));

/**
 * May this staff session see promotion (and vault) admin at all? House staff
 * (1–3) only.
 * Fails closed: an unknown or executive-without-parent level is refused.
 */
function canManagePromotions(staff) {
  const level = effectiveStaffLevel(staff || {});
  return Number.isFinite(level) && level >= STAFF_LEVELS.SUPER_ADMIN && level <= STAFF_LEVELS.SUB_ADMIN;
}

module.exports = {
  PLAYER_ROLES,
  AGENT_TREE_LEVELS,
  effectiveStaffLevel,
  isAgentTree,
  canManagePromotions,
  STAFF_LEVELS,
  PERMISSIONS,
  LEVEL_PERMISSIONS,
  ALL_PERMISSIONS: ALL,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  resolvePermissions,
  executiveGrants,
  canActOn,
  canIssueFunds,
  CHILD_LEVELS,
  canCreateLevel,
};
