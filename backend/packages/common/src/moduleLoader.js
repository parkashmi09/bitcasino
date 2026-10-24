'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

/**
 * The module loader — what makes one codebase run as four microservices OR as
 * a single modular monolith without a module knowing which it is in.
 *
 * A module is a self-contained feature folder that exports a manifest:
 *
 *   module.exports = {
 *     name: 'settlement',
 *     service: 'sports',
 *     basePath: '/settlement',
 *     routers: {
 *       public:   require('./routes/public.routes'),    // (deps) => Router
 *       user:     require('./routes/user.routes'),
 *       admin:    require('./routes/admin.routes'),
 *       internal: require('./routes/internal.routes'),
 *     },
 *   };
 *
 * Each router is a FACTORY taking the service container, not a pre-built
 * Router. That is what keeps a module free of singletons: the same module can
 * be mounted twice against two different containers in a test.
 *
 * The four router keys are the four audiences, and the loader — not the module
 * — attaches the matching guard. A module therefore cannot forget its auth,
 * which is the exact failure the legacy codebase has (`protectStaff` present on
 * some settlement routes and missing from siblings in the same file).
 *
 * Mount paths:
 *
 *   public    /api/v1/<service><basePath>          no auth
 *   user      /api/v1/<service><basePath>          player token
 *   admin     /api/v1/admin/<service><basePath>    staff token + permissions
 *   internal  /internal/<service><basePath>        internal key only
 */

const AUDIENCES = ['public', 'user', 'admin', 'internal'];

/**
 * Read every module manifest under `modulesDir`.
 *
 * A folder is a module if it contains an `index.js`. Folders prefixed with `_`
 * are skipped, which is the escape hatch for work-in-progress modules that
 * should not be mounted yet.
 *
 * @returns {Array<object>} manifests, sorted by name for deterministic mounting
 */
function loadModules(modulesDir, { logger } = {}) {
  if (!fs.existsSync(modulesDir)) {
    logger?.warn({ modulesDir }, 'No modules directory — service will expose only health endpoints');
    return [];
  }

  const modules = [];

  for (const entry of fs.readdirSync(modulesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

    const manifestPath = path.join(modulesDir, entry.name, 'index.js');
    if (!fs.existsSync(manifestPath)) {
      logger?.warn({ module: entry.name }, 'Module folder has no index.js — skipping');
      continue;
    }

    // eslint-disable-next-line global-require, import/no-dynamic-require
    const manifest = require(manifestPath);
    validateManifest(manifest, entry.name);
    modules.push(manifest);
  }

  logger?.info({ count: modules.length, modules: modules.map((m) => m.name) }, 'Modules loaded');
  return modules;
}

/** Fail at boot on a malformed manifest rather than 404-ing mysteriously later. */
function validateManifest(manifest, folderName) {
  const where = `modules/${folderName}/index.js`;

  if (!manifest || typeof manifest !== 'object') throw new Error(`${where} must export a manifest object`);
  if (!manifest.name) throw new Error(`${where} is missing "name"`);
  if (!manifest.service) throw new Error(`${where} is missing "service"`);
  if (!manifest.basePath?.startsWith('/')) throw new Error(`${where} "basePath" must start with "/"`);
  if (!manifest.routers || typeof manifest.routers !== 'object') throw new Error(`${where} is missing "routers"`);

  const keys = Object.keys(manifest.routers);

  /**
   * A module with no routers is only valid if it says it is SOCKET-ONLY.
   *
   * The platform has two transports. `social` — chat, friends, private
   * messages — never had an HTTP route in legacy and does not need one; its
   * events are registered by `sockets.js` and counted by
   * `tools/socket-inventory.js`.
   *
   * The flag is required rather than inferred from an empty object, because
   * "no routers" is far more often a mistake — a module whose routes silently
   * do not mount is exactly the failure this validation exists to catch.
   */
  if (!keys.length && !manifest.socketOnly) {
    throw new Error(
      `${where} declares no routers. If that is deliberate — a socket-only ` +
        `module — set "socketOnly: true" so it is a statement rather than an omission.`
    );
  }

  for (const key of keys) {
    if (!AUDIENCES.includes(key)) {
      throw new Error(`${where} has unknown router audience "${key}" — expected one of: ${AUDIENCES.join(', ')}`);
    }
    if (typeof manifest.routers[key] !== 'function') {
      throw new Error(
        `${where} router "${key}" must be a factory function (deps) => Router, got ${typeof manifest.routers[key]}. ` +
          `Export the factory, not the built Router.`
      );
    }
  }
}

/**
 * The mark `@ibitplay/auth` puts on every authorization middleware.
 *
 * `Symbol.for` rather than an imported constant: `@ibitplay/common` cannot
 * require `@ibitplay/auth` (auth depends on common, and the cycle would be
 * real), and a registry symbol is the same value in both packages without
 * either importing the other.
 *
 * ── AND NOT A FUNCTION NAME ──────────────────────────────────────────────
 *
 * The first version of this matched middleware by name. Three things break
 * that, and the third one bit immediately: a rename is invisible to the
 * check, `asyncHandler` erases the name of anything it wraps, and a test that
 * stubs `auth` with anonymous arrows produces guards the checker cannot see —
 * so a correctly-guarded module failed to mount and the suite went red.
 *
 * A tag is a contract. `markAuthorization` sets it, test stubs can set it
 * deliberately, and anything that has not thought about it is treated as not
 * being authorization — which is the safe direction to be wrong in.
 */
const IS_AUTHORIZATION = Symbol.for('ibitplay.authorizationMiddleware');

const MUTATING_METHODS = new Set(['post', 'put', 'patch', 'delete']);

/** Does this layer stack contain an authorization decision? */
function hasAuthz(stack = []) {
  return stack.some((layer) => Boolean(layer.handle?.[IS_AUTHORIZATION] || layer[IS_AUTHORIZATION]));
}

/**
 * Every mutating route in a router that carries no authorization middleware.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * The `admin` audience guard is `authenticateStaff()`. It proves WHO is
 * calling and nothing else — a level-7 executive holding three read-only
 * grants passes it exactly as a super admin does. Authorization is per-route,
 * applied inside each module, and for a long time 8 of 48 admin route files
 * simply did not apply any: creating freespin campaigns, issuing vouchers,
 * moving balance to a game provider and broadcasting email to every player
 * were all reachable by the least privileged staff account on the platform.
 *
 * Every one of those was a correct file that forgot a line. That is the class
 * of bug this loader already closes for authentication — a module cannot
 * forget its audience guard, because the module never attaches it — and there
 * is no reason authorization should be the exception. So the same rule now
 * applies one level down: an admin route that CHANGES something must say what
 * it costs, and a service refuses to boot until it does.
 *
 * Reads are not checked. A GET is still scoped by the caller's hierarchy
 * inside the service, and forcing a grant onto every read would produce
 * ceremonial `reports:read` guards that teach nobody anything.
 * ═════════════════════════════════════════════════════════════════════════
 */
function findUnauthorizedWrites(router, prefix = '') {
  const findings = [];
  const layers = router?.stack || [];

  // A `router.use(guard)` covering the whole file satisfies everything below
  // it — that is how `bet-history` and `marketing` are written.
  if (hasAuthz(layers.filter((l) => !l.route))) return findings;

  for (const layer of layers) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods || {}).filter((m) => MUTATING_METHODS.has(m));
      if (methods.length && !hasAuthz(layer.route.stack)) {
        findings.push(`${methods.join('/').toUpperCase()} ${prefix}${layer.route.path}`);
      }
      continue;
    }
    // A nested router mounted with `router.use('/x', sub)`.
    if (layer.handle?.stack) findings.push(...findUnauthorizedWrites(layer.handle, prefix));
  }

  return findings;
}

/**
 * Build one Express router carrying every module's routes.
 *
 * @param {object}   options
 * @param {Array}    options.modules  manifests from `loadModules`
 * @param {object}   options.deps     the service container, handed to every router factory
 * @param {object}   options.guards   `{ user: [mw], admin: [mw], internal: [mw], public: [mw] }`
 * @param {string}   [options.apiPrefix='/api/v1']
 * @param {string}   [options.internalPrefix='/internal']
 * @param {string}   [options.adminSegment='admin'] path segment for staff routes
 */
function mountModules({
  modules,
  deps,
  guards = {},
  apiPrefix = '/api/v1',
  internalPrefix = '/internal',
  adminSegment = 'admin',
  logger,
} = {}) {
  const root = express.Router();
  const mounted = [];

  for (const manifest of modules) {
    const { name, service, basePath, routers } = manifest;

    for (const audience of AUDIENCES) {
      const factory = routers[audience];
      if (!factory) continue;

      const router = factory(deps);
      if (typeof router !== 'function') {
        throw new Error(`Module "${name}" router factory "${audience}" did not return an Express Router`);
      }

      // admin-service's own modules would otherwise land on
      // `/api/v1/admin/admin/audit` — the service name and the admin segment
      // are the same word, and repeating it helps nobody.
      const adminScope = service === adminSegment ? adminSegment : `${adminSegment}/${service}`;

      const mountPath =
        audience === 'internal'
          ? `${internalPrefix}/${service}${basePath}`
          : audience === 'admin'
            ? `${apiPrefix}/${adminScope}${basePath}`
            : `${apiPrefix}/${service}${basePath}`;

      const guard = guards[audience] || [];
      const guardList = Array.isArray(guard) ? guard : [guard];

      // An audience with no guard is only legitimate for `public`. Anything else
      // is a wiring mistake, and a silently unguarded admin route is exactly the
      // kind of hole this loader exists to close.
      if (!guardList.length && audience !== 'public') {
        throw new Error(
          `Module "${name}" exposes "${audience}" routes but no ${audience} guard was supplied to mountModules. ` +
            `Refusing to mount an unauthenticated ${audience} surface.`
        );
      }

      /**
       * A staff token is not a grant — see `findUnauthorizedWrites`.
       *
       * A router may opt out by setting `router.authorizationReviewed` to the
       * reason, which is how `staff-auth`'s logout is allowed to stand on
       * authentication alone. The escape hatch is deliberately a written
       * sentence rather than a boolean: it appears in the boot log, so an
       * exemption is a claim somebody made and can be read back, not a flag.
       */
      if (audience === 'admin' && !router.authorizationReviewed) {
        const unguarded = findUnauthorizedWrites(router);
        if (unguarded.length) {
          throw new Error(
            `Module "${name}" mounts admin write routes with no authorization guard:\n` +
              unguarded.map((r) => `    ${r}`).join('\n') +
              `\n  A staff token proves identity, not authority. Add auth.requirePermission(...) ` +
              `to each route, or a router.use(...) guard covering the file.\n` +
              `  If the route genuinely needs none, set router.authorizationReviewed = '<why>'.`
          );
        }
      }

      root.use(mountPath, ...guardList, router);
      mounted.push({
        module: name,
        audience,
        path: mountPath,
        ...(router.authorizationReviewed ? { authzExemption: router.authorizationReviewed } : {}),
      });
    }
  }

  logger?.info({ count: mounted.length }, 'Module routes mounted');
  for (const m of mounted) logger?.debug({ ...m }, `  ${m.audience.padEnd(8)} ${m.path}`);

  root.mountedRoutes = mounted;
  return root;
}

/**
 * Collect the lifecycle hooks a host process cares about.
 *
 * The HTTP service ignores `jobs`; the background worker mounts no routers and
 * runs only `jobs`. Same modules, different host — which is why settlement
 * logic is reachable from both without being written twice.
 */
function collectJobs(modules) {
  return modules.filter((m) => m.jobs).flatMap((m) => {
    const jobs = Array.isArray(m.jobs) ? m.jobs : [m.jobs];
    return jobs.map((job) => ({ module: m.name, ...job }));
  });
}

/** Every db domain the loaded modules need, deduplicated. */
function collectDomains(modules) {
  return [...new Set(modules.flatMap((m) => m.models || []))];
}

module.exports = {
  loadModules,
  mountModules,
  collectJobs,
  collectDomains,
  AUDIENCES,
  findUnauthorizedWrites,
  IS_AUTHORIZATION,
};
