#!/usr/bin/env node
'use strict';

/**
 * Assert that every path the two frontends call is a route the backend mounts.
 *
 *   node tools/verify-frontend-routes.js
 *   node tools/verify-frontend-routes.js --list
 *
 * WHY THIS EXISTS
 *
 * The gateway rewrites legacy paths onto new ones, but only where a rewrite is
 * expressible — it cannot change a verb, fill in a path parameter, or move a
 * request body into a query string. So a large share of the old paths answer
 * 404, and a frontend still calling one gets no error at build time and a blank
 * screen at runtime.
 *
 * `verify-modules.js` proves the backend's own route table is coherent. This
 * proves the CLIENTS agree with it. Together they mean a renamed route breaks
 * CI rather than a page.
 *
 * WHAT IT READS
 *
 *   adminpanel/src/services/endpoints.ts     the staff app's registry
 *   Addaplay/src/services/api/endpoints.js   the player app's registry
 *   apps/web/src/lib/endpoints.js            the Bitcasino web app's registry
 *
 * Both are plain object literals of string paths, so they are parsed with a
 * regex rather than imported — this script must run without either app's
 * toolchain installed.
 *
 * ── AND THE CALL SITES THAT NEVER REACHED THE REGISTRY ───────────────────
 *
 * Checking the registry only proves the registry is right. It says nothing
 * about a component that skipped it and passed a hardcoded legacy path to
 * `apiFetch` — and that check was green for months while thirty-one such calls
 * answered 404, because a correct registry nobody imports routes no requests.
 *
 * So the second pass reads the CALL SITES, resolves each one through the
 * gateway's own legacy rewriter exactly as a real request is resolved, and
 * reports the ones that reach nothing. It also names the ones that reach a
 * route only because a rewrite caught them: those work today and are the
 * migration list, since the rewrite table exists for clients we do not control
 * — provider callbacks and shipped mobile builds — not for our own panel.
 *
 * This pass has the method, so it catches what the registry pass cannot.
 *
 * ── WHAT NEITHER PASS CATCHES ────────────────────────────────────────────
 *
 * THE SHAPE. A path can resolve, with the right verb, and still hand the screen
 * a body it does not parse — `{success, data}` with the total in
 * `meta.pagination` where the legacy handler returned `{total, data}`. Reaching
 * a route is the floor, not the bar.
 *
 * The registry pass additionally has no method of its own:
 * `/api/v1/admin/user/exchange-rate/rates` accepts POST and has no GET, because
 * READING the rate table is the public route on user-service. The admin screen
 * read from the admin path, the registry pass was happy, and the request 404'd
 * — found by probing a running server. Recording a verb per registry entry
 * would close that; until then a green registry pass means "the path is
 * mounted", not "this call will work".
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BACKEND = path.resolve(__dirname, '..');
const REPO = path.resolve(BACKEND, '..');

const REGISTRIES = [
  { app: 'adminpanel', file: path.join(REPO, 'adminpanel/src/services/endpoints.ts') },
  { app: 'Addaplay', file: path.join(REPO, 'Addaplay/src/services/api/endpoints.js') },
  // The React front end in this repo. Unlike the other two it is a sibling of
  // backend/ rather than a checkout beside it, and it is being wired up one
  // phase at a time — see docs/10-backend-integration.md — so this registry is
  // short and grows. Every path in it is called through apps/web/src/lib/api.js,
  // so there are no hardcoded paths for the call-site pass to find.
  { app: 'apps/web', file: path.join(REPO, 'apps/web/src/lib/endpoints.js') },
];

/** Source trees walked for `apiFetch('/literal-path')` call sites. */
const SOURCES = [
  { app: 'adminpanel', dir: path.join(REPO, 'adminpanel/src') },
];

/** Mount the four services and read back every concrete route they expose. */
function backendRoutes() {
  const out = execFileSync('node', [path.join(BACKEND, 'tools/verify-modules.js')], {
    cwd: BACKEND,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  const routes = new Set();
  for (const line of out.split('\n')) {
    const match = line.match(/^\s+(GET|POST|PUT|PATCH|DELETE)\s+(\/\S*)\s*$/);
    if (match) routes.add(normalise(match[2]));
  }

  if (routes.size === 0) {
    throw new Error('verify-modules.js produced no routes — its output format changed');
  }
  return routes;
}

/**
 * Reduce a path to the form two spellings of the same route share.
 *
 * Parameter NAMES are local to whoever wrote the route — `:userId` on the
 * server and `:uid` on the client are the same segment — so every `:x` becomes
 * `:p`. A trailing slash is likewise not a distinction Express makes here.
 */
function normalise(p) {
  return String(p)
    .replace(/:[A-Za-z0-9_]+/g, ':p')
    .replace(/\*$/, ':p')
    .replace(/\/+$/, '') || '/';
}

/**
 * Pull every string literal that looks like an API path out of a registry.
 *
 * Template literals are the norm there (`` `${USER}/wallet/balances` ``), so
 * the service-root variables are resolved first and the interpolation is
 * replaced with the prefix it stands for.
 */
function readRegistry(file) {
  const source = fs.readFileSync(file, 'utf8');

  const roots = {};
  for (const [, name, value] of source.matchAll(
    /^const\s+([A-Z_]+)\s*=\s*['"]([^'"]+)['"]\s*;/gm
  )) {
    roots[name] = value;
  }

  const found = [];
  // `key: `${ROOT}/rest``  — the only shape the registries use.
  for (const [, key, root, rest] of source.matchAll(
    /(\w+)\s*:\s*`\$\{([A-Z_]+)\}([^`]*)`/g
  )) {
    if (!(root in roots)) continue;
    found.push({ key, path: `${roots[root]}${rest}` });
  }

  return found;
}

/**
 * The same route table, keyed by verb and matchable against a concrete URL.
 *
 * The registry pass compares path SHAPES (`:p` against `:p`); a call site has a
 * real id in it, so this needs a regex per route instead.
 */
function backendRoutesByMethod() {
  const out = execFileSync('node', [path.join(BACKEND, 'tools/verify-modules.js')], {
    cwd: BACKEND,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  const routes = [];
  for (const line of out.split('\n')) {
    const match = line.match(/^\s+(GET|POST|PUT|PATCH|DELETE)\s+(\/\S*)\s*$/);
    if (!match) continue;

    const [, method, declared] = match;
    const source = normalise(declared)
      .split('/')
      .map((seg) =>
        seg.startsWith(':') ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      )
      .join('/');

    routes.push({ method, regex: new RegExp(`^${source}$`) });
  }
  return routes;
}

/**
 * Blank out comments, keeping the byte count so nothing else shifts.
 *
 * Crude on purpose — a `//` inside a string literal is blanked too. That can
 * only ever hide a call site, never invent one, and no call site in either app
 * puts a URL-looking `//` before its path.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^([^\n]*?)\/\/[^\n]*$/gm, (_m, before) => before);
}

/** Every `apiFetch('/path', { method })` in a source tree. */
function readCallSites(dir) {
  const files = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(t|j)sx?$/.test(entry.name)) files.push(full);
    }
  })(dir);

  const calls = new Map();
  for (const file of files) {
    // The registry is a list of paths BY DESIGN — it is not a call site.
    if (/services[/\\](api[/\\])?endpoints\.(t|j)s$/.test(file)) continue;

    // Comments are stripped first: a commented-out call is not a call, and the
    // migrated files keep the old path in a note explaining why it moved.
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    const rel = path.relative(REPO, file);

    // The verb lives in the options object, so the capture reaches past the
    // path to find it. Default GET, as `fetch` does.
    const pattern =
      /api(?:Fetch|FetchPage|Upload|Download)?(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)[`'"]([\s\S]{0,220})/g;

    let match;
    while ((match = pattern.exec(source))) {
      const raw = match[1];
      if (!raw.startsWith('/')) continue;

      const method = (
        /method:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i.exec(match[2])?.[1] || 'GET'
      ).toUpperCase();

      // `${userId}` stands in for a real id so parameterised routes match.
      const url = raw.replace(/\$\{[^}]*\}/g, '1').split('?')[0];
      const key = `${method} ${normalise(url)}`;

      if (!calls.has(key)) calls.set(key, { method, path: normalise(url), raw, files: new Set() });
      calls.get(key).files.add(rel);
    }
  }

  return [...calls.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Resolve every call site the way the gateway would, and sort the results into
 * "reaches nothing" and "reaches something only because a rewrite caught it".
 */
function checkCallSites() {
  const { buildLegacyRewriter } = require(path.join(BACKEND, 'gateway/src/legacyRoutes'));
  const rewriter = buildLegacyRewriter();
  const routes = backendRoutesByMethod();

  const broken = [];
  const viaRewrite = [];

  for (const { app, dir } of SOURCES) {
    if (!fs.existsSync(dir)) continue;

    for (const call of readCallSites(dir)) {
      const req = { method: call.method, url: call.path, originalUrl: call.path };
      rewriter(req, null, () => {});
      const resolved = normalise(req.url.split('?')[0]);

      const hit = routes.some((r) => r.method === call.method && r.regex.test(resolved));
      if (!hit) broken.push({ app, ...call, resolved });
      else if (resolved !== call.path) viaRewrite.push({ app, ...call, resolved });
    }
  }

  return { broken, viaRewrite };
}

function main() {
  const list = process.argv.includes('--list');
  const mounted = backendRoutes();

  let checked = 0;
  const missing = [];

  for (const { app, file } of REGISTRIES) {
    if (!fs.existsSync(file)) {
      console.error(`  ✗ ${app}: no registry at ${path.relative(REPO, file)}`);
      process.exitCode = 1;
      continue;
    }

    const entries = readRegistry(file);
    if (entries.length === 0) {
      console.error(`  ✗ ${app}: registry parsed to zero entries — its shape changed`);
      process.exitCode = 1;
      continue;
    }

    for (const entry of entries) {
      checked += 1;
      const key = normalise(entry.path);
      const ok = mounted.has(key);
      if (!ok) missing.push({ app, ...entry });
      if (list) console.log(`  ${ok ? '✓' : '✗'} ${app.padEnd(11)} ${entry.path}`);
    }

    console.log(`  ${app}: ${entries.length} endpoints`);
  }

  console.log(
    `\n${'─'.repeat(70)}\n${checked} frontend endpoints checked against ${mounted.size} mounted routes`
  );

  if (missing.length) {
    console.error(`\n${missing.length} endpoint(s) do not match any mounted route:\n`);
    for (const m of missing) console.error(`  ✗ ${m.app.padEnd(11)} ${m.key.padEnd(24)} ${m.path}`);
    console.error('\nEither the path is wrong, or the route was renamed and the registry is stale.');
    process.exitCode = 1;
  } else {
    console.log('every registry endpoint resolves to a mounted route');
  }

  // ── Pass two: the call sites, which is where the registry is bypassed ──
  const { broken, viaRewrite } = checkCallSites();

  console.log(`\n${'─'.repeat(70)}`);

  if (viaRewrite.length) {
    console.log(
      `${viaRewrite.length} call site(s) reach a route only through a legacy rewrite — migrate to ENDPOINTS:\n`
    );
    for (const c of viaRewrite) {
      console.log(`  · ${c.method.padEnd(6)} ${c.path.padEnd(42)} -> ${c.resolved}`);
      if (list) console.log(`           ${[...c.files].join('\n           ')}`);
    }
    console.log('');
  }

  if (broken.length) {
    console.error(`${broken.length} call site(s) reach NO mounted route:\n`);
    for (const c of broken) {
      console.error(`  ✗ ${c.method.padEnd(6)} ${c.raw}`);
      console.error(`           ${[...c.files].join('\n           ')}`);
    }
    console.error(
      '\nThese bypass the registry with a legacy path. Import ENDPOINTS instead,\n' +
        'or the route was never ported and the screen has no backend.'
    );
    process.exitCode = 1;
    return;
  }

  console.log('every call site reaches a mounted route');
}

main();
