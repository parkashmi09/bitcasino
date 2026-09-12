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
    PERMISSIONS.CONFIG_READ,
  ],
  [STAFF_LEVELS.SUPER_MASTER]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_WRITE,
    PERMISSIONS.WALLET_READ,
    PERMISSIONS.WALLET_CREDIT,
    PERMISSIONS.WALLET_DEBIT,
    PERMISSIONS.CASINO_READ,
    PERMISSIONS.SPORTS_READ,
    PERMISSIONS.REPORTS_READ,
    PERMISSIONS.STAFF_READ,
  ],
  [STAFF_LEVELS.MASTER]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.USERS_WRITE,
    PERMISSIONS.WALLET_READ,
    PERMISSIONS.WALLET_CREDIT,
    PERMISSIONS.WALLET_DEBIT,
    PERMISSIONS.REPORTS_READ,
  ],
  [STAFF_LEVELS.AGENT]: [
    PERMISSIONS.USERS_READ,
    PERMISSIONS.WALLET_READ,
    PERMISSIONS.WALLET_CREDIT,
    PERMISSIONS.WALLET_DEBIT,
    PERMISSIONS.REPORTS_READ,
  ],
  [STAFF_LEVELS.EXECUTIVE]: [PERMISSIONS.USERS_READ, PERMISSIONS.WALLET_READ, PERMISSIONS.REPORTS_READ],
};

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

/**
 * Resolve the effective permission list for a staff member.
 *
 * An executive is a restricted sub-account of a staff member, so its grants are
 * intersected with the parent's — an executive can never be given authority the
 * parent does not itself hold.
 */
function resolvePermissions({ level, rolePermissions = null, executivePermissions = null }) {
  const base = rolePermissions?.length ? rolePermissions : LEVEL_PERMISSIONS[level] || [];
  if (!executivePermissions) return base;

  const granted = Array.isArray(executivePermissions)
    ? executivePermissions
    : executivePermissions.authority || executivePermissions.permissions || [];

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

module.exports = {
  PLAYER_ROLES,
  STAFF_LEVELS,
  PERMISSIONS,
  LEVEL_PERMISSIONS,
  ALL_PERMISSIONS: ALL,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  resolvePermissions,
  canActOn,
};
