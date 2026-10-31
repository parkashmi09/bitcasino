'use strict';

/**
 * Stub dependencies for building a module's router WITHOUT a database.
 *
 * A route factory only needs its dependencies to CONSTRUCT the router; nothing
 * built with these handles a request. Shared by verify-authz and
 * verify-strict-validators so both cover exactly the same routers.
 */

/**
 * A no-op middleware carrying the tag the authz checker looks for. The tag,
 * not the name: `markAuthorization` is the contract.
 */
const IS_AUTHORIZATION = Symbol.for('ibitplay.authorizationMiddleware');
const guard = () => {
  const fn = (_req, _res, next) => next();
  fn[IS_AUTHORIZATION] = true;
  return fn;
};
const plain = () => (_req, _res, next) => next();

const authStub = {
  // Authentication — deliberately NOT tagged. Proving who is calling is not
  // an authorization decision.
  authenticate: plain,
  requireActive: plain,
  requireRole: plain,
  authenticateStaff: plain,
  // Authorization.
  requirePermission: guard,
  requireAnyPermission: guard,
  requireLevel: guard,
  requireAuthorityOver: guard,
  requireSelfOrPermission: guard,
};

/**
 * Anything a factory might reach for while building its router. Unknown
 * property reads return another stub; unknown calls return one too.
 */
function deepStub(label = 'stub') {
  const fn = function stubFn() { return deepStub(label); };
  return new Proxy(fn, {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive || prop === 'toString') return () => label;
      if (prop === 'then') return undefined; // never look thenable to `await`
      if (prop === Symbol.iterator) return function* () {};
      return deepStub(`${label}.${String(prop)}`);
    },
    apply() { return deepStub(label); },
    construct() { return deepStub(label); },
  });
}

/**
 * Service clients answer with a promise that never settles, so factories that
 * prime a cache through `clients.<svc>.get(...).then(...)` still build.
 */
const pending = () => new Promise(() => {});
const clientStub = new Proxy({}, {
  get: (_target, _service) => new Proxy({}, { get: () => pending }),
});

const deps = new Proxy(
  {
    auth: authStub,
    clients: clientStub,
    config: {
      RATE_LIMIT_ENABLED: false,
      SERVICE_NAME: 'verify',
      INTERNAL_API_KEY: 'x',
      // Throwaway values that must differ (TokenService refuses equal secrets).
      JWT_ACCESS_SECRET: 'verify-authz-access-secret-not-used-for-signing',
      JWT_REFRESH_SECRET: 'verify-authz-refresh-secret-not-used-for-signing',
      JWT_ADMIN_SECRET: 'verify-authz-admin-secret-not-used-for-signing',
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  },
  { get: (target, prop) => (prop in target ? target[prop] : deepStub(String(prop))) }
);

module.exports = { IS_AUTHORIZATION, deps, deepStub };
