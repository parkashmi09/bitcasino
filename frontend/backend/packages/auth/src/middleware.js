'use strict';

const { UnauthorizedError, ForbiddenError } = require('@ibitplay/common');
const { TokenService, TOKEN_TYPES } = require('./tokens');
const { hasPermission, hasAnyPermission, hasAllPermissions, canActOn } = require('./permissions');

/**
 * The mark that says "this middleware makes an authorization decision".
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY A PROPERTY AND NOT A FUNCTION NAME
 *
 * `mountModules` refuses to mount an admin write route that carries no
 * authorization guard. It has to recognise one, and the first version of that
 * check matched on the middleware's function NAME.
 *
 * Names are the wrong contract. They are invisible in the code that relies on
 * them, so nothing tells you a rename broke the check; wrapping a guard in
 * `asyncHandler` erases the name entirely; and a test that stubs `auth` with
 * an anonymous arrow — which is exactly what `authBoundaries.test.js` does —
 * produces a guard the checker cannot see, so a correctly-guarded module
 * fails to mount. That last one is not hypothetical: it is how this was found.
 *
 * An explicit property is a contract you can grep for, and one a stub can
 * satisfy deliberately. Failing to set it means "this is not authorization",
 * which is the safe default for anything that has not thought about it.
 * ═════════════════════════════════════════════════════════════════════════
 */
const IS_AUTHORIZATION = Symbol.for('ibitplay.authorizationMiddleware');

/** Tag a middleware as an authorization decision, and return it. */
function markAuthorization(middleware) {
  middleware[IS_AUTHORIZATION] = true;
  return middleware;
}

/** Does this middleware make an authorization decision? */
const isAuthorizationMiddleware = (fn) => Boolean(fn && fn[IS_AUTHORIZATION]);

/**
 * Route protection.
 *
 * Composed as: authenticate -> (requireActive) -> authorize.
 *
 *   router.get('/me',            authenticate(),                  ctrl.me)
 *   router.post('/bets',         authenticate(), requireActive(), ctrl.place)
 *   router.get('/admin/users',   authenticateStaff(), requirePermission('users:read'), ctrl.list)
 *
 * The token is trusted for identity, but NOT for account state. A player who is
 * locked after their token was issued still holds a structurally valid token —
 * so `requireActive` re-checks status against the database. That check is the
 * difference between "locked" meaning something and meaning nothing until the
 * token expires.
 */

function createAuthMiddleware({ config, loadUser, loadStaff, cache = null }) {
  const tokens = new TokenService(config);

  /**
   * Verify a player access token and attach `req.user`.
   * @param {object} [options]
   * @param {boolean} [options.optional] Continue unauthenticated when no token is present.
   */
  function authenticate({ optional = false } = {}) {
    return async function authenticateMiddleware(req, _res, next) {
      try {
        const token = TokenService.fromHeader(req.headers.authorization);

        if (!token) {
          if (optional) return next();
          throw new UnauthorizedError('Authentication required');
        }

        const payload = tokens.verify(token, TOKEN_TYPES.ACCESS);

        req.user = {
          id: Number(payload.sub),
          sessionId: payload.sid || null,
          role: payload.role || 'player',
          status: payload.status || 'active',
          tokenId: payload.jti,
        };
        req.token = { raw: token, payload };
        if (req.context) req.context.userId = req.user.id;

        return next();
      } catch (error) {
        if (optional && error instanceof UnauthorizedError) return next();
        return next(error);
      }
    };
  }

  /**
   * Confirm the account is still usable, reading the current row.
   *
   * `loadUser` is injected by the service so this package never imports the
   * data layer. Results can be cached briefly — the trade-off is that a lock
   * takes up to the TTL to bite, so keep it short.
   */
  function requireActive({ allowStatuses = ['active'], checkBetting = false } = {}) {
    return async function requireActiveMiddleware(req, _res, next) {
      try {
        if (!req.user) throw new UnauthorizedError('Authentication required');
        if (typeof loadUser !== 'function') return next();

        const cacheKey = `user:${req.user.id}`;
        let record = cache?.get(cacheKey);
        if (!record) {
          record = await loadUser(req.user.id);
          if (record) cache?.set(cacheKey, record);
        }

        if (!record) throw new UnauthorizedError('Account no longer exists');

        if (record.system_locked) {
          throw new ForbiddenError('This account has been locked by the system. Contact support.');
        }
        if (record.is_locked) {
          throw new ForbiddenError('This account is locked. Contact support.');
        }
        if (record.status && !allowStatuses.includes(record.status)) {
          throw new ForbiddenError(`Account is ${record.status}`);
        }
        if (checkBetting) {
          if (record.bet_status && record.bet_status !== 'active') {
            throw new ForbiddenError('Betting is disabled on this account');
          }
        }

        // Hand the loaded row downstream so controllers do not refetch it.
        req.account = record;
        return next();
      } catch (error) {
        return next(error);
      }
    };
  }

  /** Player role check, for VIP-only or affiliate-only routes. */
  function requireRole(...roles) {
    const allowed = roles.flat();
    return function requireRoleMiddleware(req, _res, next) {
      if (!req.user) return next(new UnauthorizedError('Authentication required'));
      if (!allowed.includes(req.user.role)) {
        return next(new ForbiddenError(`This action requires one of: ${allowed.join(', ')}`));
      }
      return next();
    };
  }

  /**
   * Verify a staff token and attach `req.staff`.
   *
   * Unlike player auth this ALWAYS hits the database. Staff tokens carry real
   * authority over other people's money, so a revoked or demoted account must
   * stop working immediately, not when the token happens to expire.
   */
  function authenticateStaff({ optional = false } = {}) {
    return async function authenticateStaffMiddleware(req, _res, next) {
      try {
        const token = TokenService.fromHeader(req.headers.authorization);

        if (!token) {
          if (optional) return next();
          throw new UnauthorizedError('Staff authentication required');
        }

        const payload = tokens.verify(token, TOKEN_TYPES.ADMIN);

        if (typeof loadStaff !== 'function') {
          throw new Error('authenticateStaff requires a loadStaff loader');
        }

        const staff = await loadStaff(Number(payload.sub), payload.executiveId || null);
        if (!staff) throw new UnauthorizedError('Staff account not found');
        if (staff.status && staff.status !== 'active') {
          throw new ForbiddenError(`Staff account is ${staff.status}`);
        }
        if (staff.system_locked) throw new ForbiddenError('Staff account is locked');

        // An executive must still belong to the staff member named in the token;
        // otherwise a re-parented executive would keep the old parent's reach.
        if (payload.executiveId) {
          if (!staff.executive) throw new UnauthorizedError('Executive account not found');
          if (staff.executive.status !== 'active') {
            throw new ForbiddenError(`Executive account is ${staff.executive.status}`);
          }
          if (Number(staff.executive.parent_staff_id) !== Number(payload.sub)) {
            throw new UnauthorizedError('Executive no longer belongs to this staff account');
          }
        }

        req.staff = {
          id: Number(payload.sub),
          roleId: staff.role_id,
          roleName: staff.roleName || payload.roleName || null,
          level: staff.level ?? payload.level ?? null,
          name: staff.name || null,
          executiveId: payload.executiveId || null,
          permissions: staff.permissions || [],
          record: staff,
        };
        req.token = { raw: token, payload };
        if (req.context) req.context.staffId = req.staff.id;

        return next();
      } catch (error) {
        if (optional && error instanceof UnauthorizedError) return next();
        return next(error);
      }
    };
  }

  /** Require every listed permission. */
  function requirePermission(...permissions) {
    const required = permissions.flat();
    return markAuthorization(function requirePermissionMiddleware(req, _res, next) {
      if (!req.staff) return next(new UnauthorizedError('Staff authentication required'));
      if (!hasAllPermissions(req.staff.permissions, required)) {
        req.log?.warn(
          { staffId: req.staff.id, required, granted: req.staff.permissions },
          'Permission denied'
        );
        return next(new ForbiddenError(`Missing required permission: ${required.join(', ')}`));
      }
      return next();
    });
  }

  /** Require at least one of the listed permissions. */
  function requireAnyPermission(...permissions) {
    const required = permissions.flat();
    return markAuthorization(function requireAnyPermissionMiddleware(req, _res, next) {
      if (!req.staff) return next(new UnauthorizedError('Staff authentication required'));
      if (!hasAnyPermission(req.staff.permissions, required)) {
        return next(new ForbiddenError(`Requires one of: ${required.join(', ')}`));
      }
      return next();
    });
  }

  /** Require a staff level at least as senior as `maxLevel` (lower number = more senior). */
  function requireLevel(maxLevel) {
    return markAuthorization(function requireLevelMiddleware(req, _res, next) {
      if (!req.staff) return next(new UnauthorizedError('Staff authentication required'));
      if (!Number.isFinite(req.staff.level) || req.staff.level > maxLevel) {
        return next(new ForbiddenError('Your role does not have sufficient authority for this action'));
      }
      return next();
    });
  }

  /**
   * Guard a route that acts on another staff member: the actor must strictly
   * outrank the target. Without this, an agent could edit a peer or a superior
   * simply by putting their id in the URL.
   */
  function requireAuthorityOver(getTargetLevel) {
    return markAuthorization(async function requireAuthorityOverMiddleware(req, _res, next) {
      try {
        if (!req.staff) throw new UnauthorizedError('Staff authentication required');
        const targetLevel = await getTargetLevel(req);
        if (targetLevel === null || targetLevel === undefined) throw new ForbiddenError('Target not found');
        if (!canActOn(req.staff.level, targetLevel)) {
          throw new ForbiddenError('You cannot act on an account at or above your own level');
        }
        return next();
      } catch (error) {
        return next(error);
      }
    });
  }

  /**
   * Allow either the resource owner or a staff member with `permission`.
   * The common shape for "a player can read their own bets; support can read anyone's".
   */
  function requireSelfOrPermission(getOwnerId, permission) {
    return markAuthorization(async function requireSelfOrPermissionMiddleware(req, _res, next) {
      try {
        const ownerId = await getOwnerId(req);

        if (req.user && Number(ownerId) === Number(req.user.id)) return next();
        if (req.staff && hasPermission(req.staff.permissions, permission)) return next();

        throw new ForbiddenError('You do not have access to this resource');
      } catch (error) {
        return next(error);
      }
    });
  }

  return {
    tokens,
    authenticate,
    requireActive,
    requireRole,
    authenticateStaff,
    requirePermission,
    requireAnyPermission,
    requireLevel,
    requireAuthorityOver,
    requireSelfOrPermission,
  };
}

module.exports = {
  createAuthMiddleware,
  markAuthorization,
  isAuthorizationMiddleware,
  IS_AUTHORIZATION,
};
