#!/usr/bin/env node
/**
 * Probe every browser-reachable GET route against a RUNNING platform.
 *
 *   node tools/probe-api.mjs                      # table, grouped by module
 *   node tools/probe-api.mjs --json               # machine-readable
 *   node tools/probe-api.mjs --only=user          # one service
 *   node tools/probe-api.mjs --fail-on-500        # exit 1 if anything 5xx's unexpectedly
 *
 * WHY THIS EXISTS, NEXT TO `verify-routes` AND `api-surface`
 *
 * `route-inventory.js` proves the legacy port is complete. `api-surface.js`
 * proves the documented surface matches the code. Neither one calls anything, so
 * neither can tell you that `GET /casino/bet-history/timed-rounds` answers 500
 * because `bets_30s.uid` is a varchar being compared to a bigint, or that
 * `GET /user/crypto/chains` throws because the `http` dependency it destructures
 * was never put in the container. Both were green on every static check and
 * broken on the first real request.
 *
 * A front end integrating against this platform needs to know which routes
 * return DATA, which need PARAMS, which need PROVIDER CREDENTIALS, and which are
 * simply broken — and those four are indistinguishable in a route list.
 *
 * ── HOW TO READ THE RESULT ───────────────────────────────────────────────
 *
 *   200          usable now
 *   422          works, but the route requires query params — read its validator
 *   404          a legitimate "nothing here for you" on some routes (bonus/record)
 *   502 / 503    an external provider is unreachable or unconfigured, not a bug
 *   500          A BUG. Nothing else produces one.
 *
 * GET only, and never a path with a `:param` or `*` in it — so this is safe to
 * run against any environment, including one with real data. It writes nothing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => {
  const hit = args.find((a) => a.startsWith(`${f}=`));
  return hit ? hit.slice(f.length + 1) : d;
};

const GATEWAY = val('--gateway', process.env.PROBE_GATEWAY || 'http://127.0.0.1:4000');
const IDENTIFIER = val('--user', process.env.PROBE_USER || 'demo_player01');
const PASSWORD = val('--password', process.env.PROBE_PASSWORD || 'Demo@12345');
const ONLY = val('--only', null);

const SURFACE = path.join(ROOT, 'docs', 'api-surface.json');
if (!fs.existsSync(SURFACE)) {
  console.error('docs/api-surface.json is missing — run `node tools/api-surface.js --json` first.');
  process.exit(1);
}

/**
 * A player token, or null.
 *
 * Without one the `user`-audience rows all read 401, which is a useless answer —
 * so say plainly that the probe is partial rather than reporting 60 false
 * failures. `--demo` seeded credentials are the default.
 */
async function signIn() {
  try {
    const res = await fetch(`${GATEWAY}/api/v1/user/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      console.error(`! could not sign in as ${IDENTIFIER} (${res.status} ${body?.error?.code ?? ''})`);
      console.error('  player rows will report 401. Seed accounts with `npm run db:seed:demo`.');
      return null;
    }
    return body.data.accessToken;
  } catch {
    console.error(`! ${GATEWAY} is not answering — start the platform with \`npm run dev\`.`);
    process.exit(1);
  }
}

/** A one-line description of a success payload, enough to spot an empty table. */
function describe(body) {
  const data = body?.data;
  let note;
  if (Array.isArray(data)) note = `array[${data.length}]`;
  else if (data === null) note = 'null';
  else if (typeof data === 'object') note = `{${Object.keys(data).slice(0, 5).join(',')}}`;
  else note = String(data);
  if (body?.meta?.pagination) note += ` total=${body.meta.pagination.total}`;
  return note;
}

const token = await signIn();

const surface = JSON.parse(fs.readFileSync(SURFACE, 'utf8'));
const routes = surface.routes
  .filter((r) => r.method === 'GET')
  .filter((r) => r.audience === 'public' || r.audience === 'user')
  .filter((r) => !r.path.includes(':') && !r.path.includes('*'))
  .filter((r) => (ONLY ? r.service === ONLY : true));

const results = [];
for (const route of routes) {
  const needsAuth = route.audience === 'user';
  const headers = needsAuth && token ? { Authorization: `Bearer ${token}` } : {};
  try {
    const res = await fetch(GATEWAY + route.path, { headers });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* a raw-envelope route, or an empty 204 */
    }

    let note;
    if (body?.success === true) note = describe(body);
    else if (body?.success === false) note = body.error?.code ?? 'error';
    else note = `RAW ${text.slice(0, 48).replace(/\s+/g, ' ')}`;

    results.push({
      service: route.service,
      module: route.module,
      audience: route.audience,
      path: route.path,
      status: res.status,
      note,
    });
  } catch (error) {
    results.push({
      service: route.service,
      module: route.module,
      audience: route.audience,
      path: route.path,
      status: 0,
      note: error.message,
    });
  }
}

if (has('--json')) {
  console.log(JSON.stringify({ gateway: GATEWAY, authenticated: Boolean(token), results }, null, 2));
} else {
  const tally = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const ok = results.filter((r) => r.status === 200).length;
  console.log(`\n${ok}/${results.length} GET routes returned 200   ${JSON.stringify(tally)}`);
  console.log(token ? '' : '(unauthenticated — player rows are 401)\n');

  const groups = new Map();
  for (const r of results) {
    const key = `${r.service}/${r.module}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  for (const key of [...groups.keys()].sort()) {
    const rows = groups.get(key);
    console.log(`\n### ${key}  (${rows.filter((r) => r.status === 200).length}/${rows.length})`);
    for (const r of rows) {
      const flag = r.audience === 'user' ? 'P' : ' ';
      console.log(`  ${String(r.status).padEnd(4)}${flag} ${r.path.replace('/api/v1/', '').padEnd(44)} ${r.note}`);
    }
  }

  const bugs = results.filter((r) => r.status >= 500 && r.status !== 502 && r.status !== 503);
  if (bugs.length) {
    console.log(`\n${bugs.length} route(s) answered 5xx that no provider explains — these are bugs:`);
    for (const b of bugs) console.log(`  ${b.status} ${b.path}  ${b.note}`);
  }
  console.log('');
  if (has('--fail-on-500') && bugs.length) process.exit(1);
}
