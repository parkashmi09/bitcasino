#!/usr/bin/env node
'use strict';

/**
 * Mount every module against a fake container and print the resulting route
 * table.
 *
 *   node tools/verify-modules.js
 *
 * No database, no ports, no `.env` — so this runs in CI and on a laptop with
 * nothing installed but node_modules. What it proves:
 *
 *   - every module manifest is well-formed (the loader validates it)
 *   - every router factory builds without throwing
 *   - the guard rule holds: a non-public audience without a guard refuses to mount
 *   - the concrete URL of every endpoint, which is what you diff after a rename
 */

const path = require('path');
const { loadModules, mountModules } = require('@ibitplay/common');
const { markAuthorization } = require('@ibitplay/auth');

const ROOT = path.resolve(__dirname, '..');
const SERVICES = ['user', 'admin', 'casino', 'sports'];

const passthrough = () => function guard(_req, _res, next) { next(); };

/** A container shaped like the real one, wired to nothing. */
const fakeDeps = {
  config: {
    SERVICE_NAME: 'verify',
    INTERNAL_API_KEY: 'x'.repeat(48),
    RATE_LIMIT_ENABLED: false,
    SPORTS_VOID_WINDOW_HOURS: 30,
    SPORTS_MAX_PAYOUT: 100_000,
    // Router factories that build a TokenService need these to exist. They are
    // never used to sign anything here — no request is ever served.
    // Distinct on purpose: TokenService refuses to start with a shared secret,
    // because a leaked player key must never be able to mint a staff token.
    JWT_ACCESS_SECRET: `verify-access-${'a'.repeat(40)}`,
    JWT_REFRESH_SECRET: `verify-refresh-${'r'.repeat(40)}`,
    JWT_ADMIN_SECRET: `verify-admin-${'d'.repeat(40)}`,
    JWT_ACCESS_TTL: '15m',
    JWT_REFRESH_TTL: '30d',
    JWT_ADMIN_TTL: '8h',
    JWT_ISSUER: 'ibitplay',
    JWT_AUDIENCE: 'ibitplay-api',
    // Storage roots. Resolved at construction by the services that own them,
    // so a missing value fails at MOUNT rather than at use — which is the
    // behaviour we want in production and has to be satisfied here.
    CLUB_BANNER_STORAGE_DIR: '/tmp/verify-club-banners',
    // The odds feed. `FeedClient` validates these at CONSTRUCTION — which is
    // the point: a plain-http feed or a missing key stops the service at boot
    // rather than on the first bet. https here so the insecure check is
    // exercised in its refusing direction on every CI run.
    SPORTS_FEED_URL: 'https://feed.verify.invalid/api',
    SPORTS_FEED_KEY: 'verify-feed-key',
    KYC_STORAGE_DIR: '/tmp/verify-kyc',
    DEPOSIT_STORAGE_DIR: '/tmp/verify-deposits',
  },
  logger: { info() {}, warn() {}, debug() {}, error() {}, fatal() {} },
  db: {
    sequelize: {},
    transaction: async (fn) => fn({}),
    advisoryLock: async () => ({ acquired: true, result: null }),
  },
  models: {},
  clients: { user: {}, admin: { post: async () => {} }, casino: {}, sports: {} },
  auth: {
    // Authentication — NOT tagged. Proving who is calling is not an
    // authorization decision, and tagging it would make the admin-write check
    // pass trivially on every route.
    authenticate: passthrough,
    requireActive: passthrough,
    authenticateStaff: passthrough,
    /**
     * Authorization — tagged, because these stand in for the real guards.
     *
     * `mountModules` recognises an authorization decision by the
     * `ibitplay.authorizationMiddleware` tag that `markAuthorization` sets. An
     * UNTAGGED stub makes correctly-guarded modules look unguarded: this tool
     * reported `access`, `catalogue` and `bet-admin` as unprotected when every
     * one of their write routes carries `auth.requirePermission(...)`.
     */
    requirePermission: () => markAuthorization(passthrough()),
    requireAnyPermission: () => markAuthorization(passthrough()),
    requireLevel: () => markAuthorization(passthrough()),
    requireAuthorityOver: () => markAuthorization(passthrough()),
    requireSelfOrPermission: () => markAuthorization(passthrough()),
  },
};

/** Walk an Express router tree and yield `METHOD /full/path` for every endpoint. */
function collectRoutes(stack, prefix = '') {
  const found = [];

  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) {
        found.push({ method: method.toUpperCase(), path: prefix + layer.route.path });
      }
    } else if (layer.handle?.stack) {
      found.push(...collectRoutes(layer.handle.stack, prefix + decodePrefix(layer)));
    }
  }

  return found;
}

/**
 * Recover the literal mount path from a layer's regexp.
 *
 * Express does not keep the string it was mounted with, so this unpicks the
 * generated pattern. Fast-slash layers (`app.use(fn)` with no path) match
 * everything and contribute nothing to the URL.
 */
function decodePrefix(layer) {
  if (layer.path) return layer.path;
  if (layer.regexp?.fast_slash) return '';

  const source = layer.regexp?.source;
  if (!source) return '';

  return source
    .replace(/^\^/, '')
    .replace(/\\\/\?/g, '')
    .replace(/\(\?=\\\/\|\$\)/g, '')
    .replace(/\$$/, '')
    .replace(/\\\//g, '/');
}

let totalModules = 0;
let totalRoutes = 0;
let failed = false;

/** Every `METHOD /path` that actually mounted, for the gateway check below. */
const mountedKeys = new Set();

/**
 * Which service mounts each path, for the proxy-routing check.
 *
 * The rewrite check below only asks whether a target exists SOMEWHERE. That is
 * not enough: `admin` is an audience, so `/api/v1/admin/user/vault` is mounted
 * by user-service, and a gateway that sends all of `/api/v1/admin/*` to
 * admin-service 404s it while the route works perfectly when called directly.
 * That was true of 200 routes until the prefix table was fixed.
 */
const ownerOf = new Map();

for (const service of SERVICES) {
  const modulesDir = path.join(ROOT, 'services', service, 'src/modules');
  let modules;

  try {
    modules = loadModules(modulesDir);
  } catch (error) {
    console.error(`\n✗ ${service}: ${error.message}`);
    failed = true;
    continue;
  }

  if (!modules.length) {
    console.log(`\n${service.toUpperCase().padEnd(7)} — no modules yet`);
    continue;
  }

  let router;
  try {
    router = mountModules({
      modules,
      deps: fakeDeps,
      guards: {
        public: [],
        user: [passthrough()],
        admin: [passthrough()],
        internal: [passthrough()],
      },
    });
  } catch (error) {
    console.error(`\n✗ ${service}: ${error.message}`);
    failed = true;
    continue;
  }

  const routes = collectRoutes(router.stack);
  for (const route of routes) {
    mountedKeys.add(`${route.method} ${route.path}`);
    ownerOf.set(route.path, service);
  }
  totalModules += modules.length;
  totalRoutes += routes.length;

  console.log(`\n${service.toUpperCase()} — ${modules.length} module(s), ${routes.length} route(s)`);
  for (const mount of router.mountedRoutes) {
    console.log(`  ${mount.audience.padEnd(8)} ${mount.path}`);
  }
  console.log('');
  for (const route of routes.sort((a, b) => a.path.localeCompare(b.path))) {
    console.log(`    ${route.method.padEnd(6)} ${route.path}`);
  }
}

/**
 * Every gateway rewrite must land on a route that exists.
 *
 * This check was added after 26 targets were found pointing at
 * `/api/v1/public/...` — a segment the module loader does not produce. `public`
 * is an AUDIENCE, not a path: it mounts at `/api/v1/<service>/<base>` exactly
 * like `user` does, and the difference is that no guard is attached.
 *
 * Seven of those 26 were the casino provider's bet and win callbacks. Nothing
 * catches it in review — the target reads plausibly, the tests exercise the
 * service directly, and the service's own routes are all fine. It surfaces as a
 * 404 the first time a provider posts a win, which is the worst place to find
 * out.
 */
function checkGatewayTargets() {
  let broken = 0;

  const { EXACT, PREFIXES } = require(path.join(ROOT, 'gateway/src/legacyRoutes'));

  // A path parameter matches any segment, so `/x/:id` has to satisfy `/x/42`.
  const patterns = [...mountedKeys].map((key) => {
    const [method, route] = key.split(' ');
    return {
      method,
      // Trailing-slash tolerant: routers mounted at a base path expose `/`.
      regex: new RegExp(`^${route.replace(/:[^/]+/g, '[^/]+').replace(/\/$/, '/?')}$`),
    };
  });

  const resolves = (method, target) => {
    const [pathname] = target.split('?');
    return patterns.some((p) => p.method === method && p.regex.test(pathname));
  };

  for (const [key, target] of Object.entries(EXACT)) {
    const [method] = key.split(' ');
    // Internal paths are not mounted by this tool's fake container.
    if (target.startsWith('/internal/')) continue;
    if (resolves(method, target)) continue;

    console.error(`  ✗ ${key}\n      → ${target}  (no such route)`);
    broken += 1;
  }

  for (const [from, to] of PREFIXES) {
    if (![...mountedKeys].some((key) => key.split(' ')[1].startsWith(to))) {
      console.error(`  ✗ prefix ${from}\n      → ${to}  (nothing mounted under it)`);
      broken += 1;
    }
  }

  return broken;
}

/**
 * Would the gateway's prefix table actually reach the service that mounts each
 * route?
 *
 * `checkGatewayTargets` asks whether a rewrite target exists. This asks the
 * harder question — whether the proxy sends it to the right process. The two
 * fail differently: a bad rewrite is a 404 for one path, a bad prefix is a 404
 * for every route under it.
 */
function checkProxyRouting() {
  const { ROUTES } = require(path.join(ROOT, 'gateway/src/app'));
  if (!Array.isArray(ROUTES)) {
    console.error('  ✗ gateway/src/app.js does not export ROUTES — cannot check proxy routing');
    return 1;
  }

  // Longest prefix wins, exactly as the gateway sorts them.
  const sorted = [...ROUTES].sort((a, b) => b.prefix.length - a.prefix.length);
  const targetFor = (pathname) => sorted.find((r) => pathname.startsWith(r.prefix))?.service ?? null;

  const broken = new Map();
  for (const [pathname, owner] of ownerOf) {
    if (pathname.startsWith('/internal/')) continue;   // never proxied, by design

    const routed = targetFor(pathname);
    if (routed === owner) continue;

    // Group by prefix so one misrouted mount is not 60 identical lines.
    const key = `${pathname.split('/').slice(0, 5).join('/')} → ${routed ?? 'nothing'} (mounted by ${owner})`;
    broken.set(key, (broken.get(key) ?? 0) + 1);
  }

  for (const [key, count] of broken) {
    console.error(`  ✗ ${key}  — ${count} route(s) unreachable`);
  }

  return broken.size;
}

console.log(`\n${'─'.repeat(70)}`);
console.log(`${totalModules} modules, ${totalRoutes} routes`);

if (!failed) {
  console.log('\nGateway legacy rewrites:');
  const broken = checkGatewayTargets();
  if (broken) {
    console.error(`\n${broken} gateway rewrite(s) point at routes that do not exist.`);
    failed = true;
  } else {
    console.log('  every rewrite lands on a mounted route');
  }

  console.log('\nGateway proxy routing:');
  const misrouted = checkProxyRouting();
  if (misrouted) {
    console.error(`\n${misrouted} prefix(es) route to a service that does not mount them.`);
    failed = true;
  } else {
    console.log('  every mounted route is reachable through the gateway');
  }
}

if (failed) {
  console.error('\nOne or more checks failed.');
  process.exit(1);
}
