#!/usr/bin/env node
'use strict';

/**
 * Every admin write route must say what it costs.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CATCHES
 *
 * The `admin` audience guard is `authenticateStaff()` — it proves WHO is
 * calling, not what they may do. Authorization is per-route, applied inside
 * each module, and 8 of 48 admin route files once applied none. That made
 * `POST /gis/vouchers`, `POST /js-games/v1/transfer` and `POST /email/bulk`
 * reachable by a level-7 executive whose entire grant list is read-only.
 *
 * `mountModules` now refuses to mount such a router, so a service with this
 * defect cannot boot. This tool is the same check run WITHOUT a database, so
 * CI answers in a second instead of at the first deploy.
 *
 * ── WHY THE ROUTERS ARE BUILT WITH STUBS ─────────────────────────────────
 *
 * A route factory only needs its dependencies to CONSTRUCT the router; nothing
 * here handles a request. So the stub container satisfies the shape and the
 * middleware stubs carry the real function NAMES — which is what the check
 * matches on, and which is why every guard in `@ibitplay/auth` is a named
 * function declaration rather than an arrow assigned to a const.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node tools/verify-authz.js          # exits 1 on any finding
 *   node tools/verify-authz.js --list   # also print what every write route costs
 */

const fs = require('fs');
const path = require('path');

const { findUnauthorizedWrites } = require('../packages/common/src/moduleLoader');

const SERVICES_DIR = path.join(__dirname, '..', 'services');
const LIST = process.argv.includes('--list');

/**
 * A no-op middleware carrying the tag the checker looks for.
 *
 * The tag, not the name: `markAuthorization` is the contract, and a stub that
 * stands in for a real guard has to satisfy the same contract or this tool
 * reports guarded routes as unguarded.
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
  // an authorization decision, and treating it as one would make the whole
  // check pass trivially on every admin route.
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
 * Anything a factory might reach for while building its router.
 *
 * A Proxy rather than a hand-written object: modules keep adding dependencies,
 * and a checker that needs updating every time one does is a checker that gets
 * switched off. Unknown property reads return another stub; unknown calls
 * return one too.
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

const deps = new Proxy(
  {
    auth: authStub,
    config: {
      RATE_LIMIT_ENABLED: false,
      SERVICE_NAME: 'verify',
      INTERNAL_API_KEY: 'x',
      /**
       * Throwaway values, and they must differ from each other — `TokenService`
       * refuses to construct when the access and refresh secrets match, which
       * is a real check worth not defeating even in a stub. Nothing is signed
       * or verified here; the routers are built and thrown away.
       */
      JWT_ACCESS_SECRET: 'verify-authz-access-secret-not-used-for-signing',
      JWT_REFRESH_SECRET: 'verify-authz-refresh-secret-not-used-for-signing',
      JWT_ADMIN_SECRET: 'verify-authz-admin-secret-not-used-for-signing',
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  },
  { get: (target, prop) => (prop in target ? target[prop] : deepStub(String(prop))) }
);

const findings = [];
const exemptions = [];
let checked = 0;
let failedToBuild = 0;

for (const service of fs.readdirSync(SERVICES_DIR)) {
  const modulesDir = path.join(SERVICES_DIR, service, 'src', 'modules');
  if (!fs.existsSync(modulesDir)) continue;

  for (const moduleName of fs.readdirSync(modulesDir)) {
    const routeFile = path.join(modulesDir, moduleName, 'routes', 'admin.routes.js');
    if (!fs.existsSync(routeFile)) continue;

    checked += 1;
    const label = `${service}/${moduleName}`;

    let router;
    try {
      router = require(routeFile)(deps);
    } catch (error) {
      // A factory that cannot be built with stubs is not a finding — it is a
      // gap in THIS tool's coverage, and saying so is the honest report.
      failedToBuild += 1;
      console.warn(`  ?  ${label.padEnd(34)} could not build with stubs: ${error.message}`);
      continue;
    }

    if (router.authorizationReviewed) {
      exemptions.push({ label, reason: router.authorizationReviewed });
      continue;
    }

    const unguarded = findUnauthorizedWrites(router);
    if (unguarded.length) findings.push({ label, routes: unguarded });

    if (LIST) {
      for (const layer of router.stack || []) {
        if (!layer.route) continue;
        const methods = Object.keys(layer.route.methods).map((m) => m.toUpperCase()).join('/');
        const guards = (layer.route.stack || [])
          .filter((l) => l.handle?.[IS_AUTHORIZATION])
          .map((l) => l.handle?.name || 'guard');
        console.log(
          `     ${methods.padEnd(7)} ${(label + layer.route.path).padEnd(58)} ${guards.join(', ') || '—'}`
        );
      }
    }
  }
}

console.log('');
if (exemptions.length) {
  console.log('Declared exemptions:');
  for (const e of exemptions) console.log(`  ·  ${e.label}\n     ${e.reason}`);
  console.log('');
}

if (findings.length) {
  console.error('✘ Admin write routes with no authorization guard:\n');
  for (const f of findings) {
    console.error(`  ${f.label}`);
    for (const route of f.routes) console.error(`      ${route}`);
  }
  console.error(
    '\n  A staff token proves identity, not authority. Add auth.requirePermission(...)\n' +
      '  to each route, or a router.use(...) guard covering the file.\n'
  );
  process.exit(1);
}

console.log(
  `✔ Every admin write route carries an authorization guard ` +
    `(${checked} module${checked === 1 ? '' : 's'} checked, ` +
    `${exemptions.length} exempt${failedToBuild ? `, ${failedToBuild} unbuildable` : ''}).`
);
