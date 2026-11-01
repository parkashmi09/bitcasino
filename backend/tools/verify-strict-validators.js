#!/usr/bin/env node
'use strict';

/**
 * Every player- and staff-facing route refuses keys it does not declare.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CATCHES
 *
 * zod objects STRIP unknown keys by default, so a non-strict validator accepts
 * any junk and answers as if it were not there. The security QA pass found
 * `POST /user/affiliate/rewards/claim-all` performing a real claim on a body of
 * `{"x":1}`, and `?userId=` accepted (and silently ignored) on profile, vault
 * and spin-wheel reads. Silently ignored today is a hole tomorrow, the day a
 * controller starts reading that key; a 422 makes the contract explicit.
 *
 * For every route on the public, user and admin audiences of every module:
 *   - a query or body schema, if present, must be strict (survives refine /
 *     transform / extend / union — see isStrictSchema in @ibitplay/common);
 *   - every player (user-audience) GET must validate its query: one with no
 *     query validator ignores `?userId=` the same way a lenient schema does;
 *   - every state-changing route (POST/PUT/PATCH/DELETE) must validate its
 *     body, with noBody() when it takes none.
 *
 * Provider/PSP/game-wallet callbacks are NOT ours to shape: the provider sends
 * what it sends, and refusing an extra key would refuse a real payment or a
 * settlement. Those are listed in LENIENT below, each with its reason, and
 * printed on every run. Internal routes (`/internal/*`) are never checked:
 * the gateway does not proxy them and their callers are our own services.
 *
 * Routers are built with the same stubs as verify-authz (tools/lib/router-stubs).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node tools/verify-strict-validators.js          # exits 1 on any finding
 *   node tools/verify-strict-validators.js --list   # also print every route checked
 */

const fs = require('fs');
const path = require('path');

const { isStrictSchema, VALIDATE_SCHEMAS } = require('../packages/common/src/middleware/validate');
const { deps } = require('./lib/router-stubs');

const SERVICES_DIR = path.join(__dirname, '..', 'services');
const LIST = process.argv.includes('--list');
const AUDIENCES = ['public', 'user', 'admin'];
const MUTATING = new Set(['post', 'put', 'patch', 'delete']);

const MSSPORTS =
  "the mssports sportsbook (TENEXCH's API, kept unchanged): its controllers read only the fields " +
  'they use, and a strict validator would refuse requests TENEXCH clients send';

/**
 * Routes deliberately left lenient. Key: `<service>/<module>:<audience>`, value:
 * `{ reason, paths? }` — `paths` (route paths inside the router, matched by
 * prefix) narrows the exemption; without it the whole router is exempt.
 */
const LENIENT = {
  'casino/aggregators:public': {
    reason: 'aggregator seamless-wallet callbacks (asia/nexus/evo): the provider defines the payload',
  },
  'casino/seamless:public': {
    reason: 'seamless-wallet callbacks (balance/debit/credit/rollback): the provider defines the payload',
  },
  'casino/gis:public': {
    paths: ['/callback/'],
    reason: 'GIS wallet callback, HMAC-signed: the provider defines the payload',
  },
  'casino/wl-hub:public': {
    paths: ['/in/gis'],
    reason: 'a Slotegrator wallet callback the parent verified and passed on (hub-signed): the provider defines the payload',
  },
  'casino/x-casino:public': {
    paths: ['/authenticate', '/balance', '/changebalance', '/status', '/cancel'],
    reason: 'x-casino wallet callbacks: the provider defines the payload',
  },
  'casino/js-games:public': {
    paths: ['/v1/bet-callback', '/v2/bet-callback'],
    reason: 'js-games bet callbacks: the provider defines the payload',
  },
  'user/psp:public': {
    paths: ['/:provider/callback', '/:provider/payout-callback'],
    reason: 'PSP deposit/payout webhooks, signed: the PSP may add fields at any time',
  },
  'user/crypto:public': {
    paths: ['/ccpayment/callback'],
    reason: 'CCPayment webhook, signed: the gateway defines the payload',
  },
  'admin/features:admin': {
    paths: ['/template'],
    reason: 'always answers 403 OWNER_ONLY before reading any input',
  },
  'admin/owner:public': {
    paths: ['/branding/asset/'],
    reason: 'raw image bytes (x-owner-key): kept only when they hash to the file name and pass the image checks',
  },
  // services/sports — docs/STRUCTURE.md §3a
  'sports/odds-events:public': { reason: MSSPORTS },
  'sports/bets:public': { reason: MSSPORTS },
  'sports/statement:public': { reason: MSSPORTS },
  'sports/settlement:admin': { reason: MSSPORTS },
  'sports/sports-config:admin': { reason: MSSPORTS },
};

/**
 * Findings in code another workstream owns, reported to them and printed on
 * every run, but not failing this check (it would block every other commit).
 * Remove the entry once fixed; a stale entry fails the run.
 */
/** Routes another workstream owns and has not fixed yet: reported, not failed. Empty when all are done. */
const OWNED_ELSEWHERE = {};

function lenientFor(key, routePath) {
  const entry = LENIENT[key];
  if (!entry) return null;
  if (!entry.paths) return entry.reason;
  return entry.paths.some((p) => routePath.startsWith(p)) ? entry.reason : null;
}

/** The `validate()` schemas applying to a route: router-level `use` ones plus its own. */
function schemasOf(stack) {
  const out = [];
  for (const layer of stack || []) {
    const s = layer.handle?.[VALIDATE_SCHEMAS];
    if (s) out.push(s);
  }
  return out;
}

/** Walk a router, yielding { methods, path, schemas } for every route. */
function* routes(router, prefix = '', inherited = []) {
  const useSchemas = [];
  for (const layer of router?.stack || []) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods || {}).filter((m) => layer.route.methods[m] && m !== '_all');
      yield {
        methods,
        path: `${prefix}${layer.route.path}`,
        schemas: [...inherited, ...useSchemas, ...schemasOf(layer.route.stack)],
      };
      continue;
    }
    const s = layer.handle?.[VALIDATE_SCHEMAS];
    if (s) { useSchemas.push(s); continue; }
    if (layer.handle?.stack) {
      // Nested routers keep their own mount path in a regexp only; the route
      // paths inside are good enough to name the finding.
      yield* routes(layer.handle, prefix, [...inherited, ...useSchemas]);
    }
  }
}

const findings = [];
const lenient = [];
const deferred = [];
let checkedRoutes = 0;
let failedToBuild = 0;

for (const service of fs.readdirSync(SERVICES_DIR).sort()) {
  const modulesDir = path.join(SERVICES_DIR, service, 'src', 'modules');
  if (!fs.existsSync(modulesDir)) continue;

  for (const moduleName of fs.readdirSync(modulesDir).sort()) {
    for (const audience of AUDIENCES) {
      const routeFile = path.join(modulesDir, moduleName, 'routes', `${audience}.routes.js`);
      if (!fs.existsSync(routeFile)) continue;
      const key = `${service}/${moduleName}:${audience}`;

      let router;
      try {
        router = require(routeFile)(deps);
      } catch (error) {
        failedToBuild += 1;
        findings.push(`${key}  could not build with stubs: ${error.message}`);
        continue;
      }

      for (const r of routes(router)) {
        checkedRoutes += 1;
        const label = `${r.methods.join('/').toUpperCase().padEnd(7)} ${key} ${r.path}`;
        const reason = lenientFor(key, r.path);
        if (reason) {
          lenient.push(`${label}  — ${reason}`);
          continue;
        }

        const problems = [];
        const queries = r.schemas.filter((s) => s.query).map((s) => s.query);
        const bodies = r.schemas.filter((s) => s.body).map((s) => s.body);

        const isGet = r.methods.some((m) => m === 'get' || m === 'head');
        if (queries.length && !queries.every((q) => isStrictSchema(q))) problems.push('query schema not strict');
        // A player GET with no query validator ignores `?userId=` exactly the
        // way a lenient schema does; that was the QA finding.
        else if (!queries.length && isGet && audience === 'user') problems.push('no query validator');

        if (r.methods.some((m) => MUTATING.has(m))) {
          if (!bodies.length) problems.push('no body validator');
          else if (!bodies.every((b) => isStrictSchema(b))) problems.push('body schema not strict');
        } else if (bodies.length && !bodies.every((b) => isStrictSchema(b))) {
          problems.push('body schema not strict');
        }

        const owned = OWNED_ELSEWHERE[`${r.methods.join('/').toUpperCase()} ${key} ${r.path}`];
        if (owned) {
          if (problems.length) deferred.push(`${label}  ${problems.join(', ')}  — ${owned}`);
          else findings.push(`${label}  is fixed: remove it from OWNED_ELSEWHERE`);
          continue;
        }
        if (problems.length) findings.push(`${label}  ${problems.join(', ')}`);
        if (LIST) console.log(`  ${problems.length ? '✘' : '✔'}  ${label}${problems.length ? '  ' + problems.join(', ') : ''}`);
      }
    }
  }
}

console.log('');
if (lenient.length) {
  console.log(`Deliberately lenient (provider callbacks and the like), ${lenient.length} route(s):`);
  for (const l of lenient) console.log(`  ·  ${l}`);
  console.log('');
}

if (deferred.length) {
  console.log(`Owned by another workstream, reported, not failing (${deferred.length}):`);
  for (const d of deferred) console.log(`  !  ${d}`);
  console.log('');
}

if (findings.length) {
  console.error(`✘ ${findings.length} route(s) accept keys they do not declare:\n`);
  for (const f of findings) console.error(`  ${f}`);
  console.error(
    '\n  Give the route validate({ query: z.object({...}).strict(), body: z.object({...}).strict() }).\n' +
      '  A route that takes no input uses noQuery() / noBody() from @ibitplay/common. A provider callback goes in LENIENT\n' +
      '  in this file, with the reason.\n'
  );
  process.exit(1);
}

console.log(
  `✔ Every public/user/admin route validates its query (and body, when it writes) with a strict schema ` +
    `(${checkedRoutes} routes checked, ${lenient.length} lenient by design, ${deferred.length} owned elsewhere${failedToBuild ? `, ${failedToBuild} unbuildable` : ''}).`
);
