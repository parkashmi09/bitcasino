#!/usr/bin/env node
'use strict';

/**
 * Does the internal ACL permit every call the code actually makes?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * `internalAcl.js` decides which service may reach which internal endpoint.
 * Get it too tight and a money path 403s in production — settlement stops
 * paying out, and the failure appears as a stuck queue rather than an obvious
 * permissions error.
 *
 * A hand-written allowlist is a claim about the call graph. This re-derives
 * the call graph FROM SOURCE and checks the claim, so the table cannot drift
 * away from the code: adding a `clients.user.post('/internal/user/wallet/…')`
 * to admin-service without widening the ACL fails here rather than at runtime.
 *
 * ── HOW CALLS ARE ATTRIBUTED ─────────────────────────────────────────────
 *
 * Two shapes, and both have to be covered or the answer is worse than useless:
 *
 *   DIRECT   `clients.<target>.<verb>('/internal/…')` — the caller is whichever
 *            service the file lives in.
 *
 *   WRAPPED  `WalletClient` and the activity recorder issue their calls from
 *            inside `packages/common`, so the path literals are not in the
 *            calling service at all. Those are declared below and attributed
 *            to whichever services CONSTRUCT them, discovered from the
 *            containers rather than assumed.
 *
 * A path built entirely from a variable would be invisible to this. None exist
 * today — `--list` prints every path found, so that stays checkable.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   node tools/verify-internal-acl.js          # exits 1 if any real call is denied
 *   node tools/verify-internal-acl.js --list   # print the derived call graph
 */

const fs = require('fs');
const path = require('path');

const { isInternalCallAllowed, INTERNAL_ACL, KNOWN_SERVICES } = require('../packages/common/src/internalAcl');

const SERVICES_DIR = path.join(__dirname, '..', 'services');
const COMMON_DIR = path.join(__dirname, '..', 'packages', 'common', 'src');
const LIST = process.argv.includes('--list');

/**
 * Calls issued from inside shared wrapper clients.
 *
 * The paths live in `packages/common`, so they are read from those files
 * rather than hardcoded — a new endpoint added to `WalletClient` is picked up
 * without editing this tool.
 */
const WRAPPERS = [
  { file: path.join(COMMON_DIR, 'walletClient.js'), constructedBy: /new WalletClient\(/ },
  { file: path.join(COMMON_DIR, 'middleware', 'activity.js'), constructedBy: /createActivityRecorder\(/ },
];

/** Every `/internal/...` string literal in a file, with `${…}` normalised. */
function internalPathsIn(file) {
  const source = fs.readFileSync(file, 'utf8');
  const found = new Set();

  for (const match of source.matchAll(/['"`](\/internal\/[^'"`]*)['"`]/g)) {
    // A template segment becomes a placeholder; prefix matching does not care.
    found.add(match[1].replace(/\$\{[^}]*\}/g, ':param').replace(/\/+$/, ''));
  }
  return [...found];
}

/** Every .js file under a directory, excluding tests. */
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

// ── 1. Direct calls, attributed to the service whose tree they live in ────
const calls = new Map(); // caller -> Set(path)
const record = (caller, p) => {
  if (!calls.has(caller)) calls.set(caller, new Set());
  calls.get(caller).add(p);
};

for (const dir of fs.readdirSync(SERVICES_DIR)) {
  const caller = `${dir}-service`;
  if (!KNOWN_SERVICES.includes(caller)) continue;

  for (const file of walk(path.join(SERVICES_DIR, dir, 'src'))) {
    // Routers DEFINE the surface; they do not call it. Counting them would
    // make every service look like a caller of its own endpoints.
    if (file.endsWith('internal.routes.js')) continue;

    const source = fs.readFileSync(file, 'utf8');
    /**
     * Only files that actually issue a call — a doc comment naming a path is
     * not a call, and treating it as one would widen the ACL for no reason.
     *
     * `\s*` around the dots is load-bearing. `sportsEnabled.js` writes
     *
     *     inFlight = clients.admin
     *       .get('/internal/admin/site-config/sports')
     *
     * and an anchored `clients\.\w+\.get` misses it because of the newline.
     * That call is real, and a detector that silently skips it would report
     * full coverage while leaving a live call unchecked — which is worse than
     * no detector at all.
     */
    if (!/clients?\.\w+\s*\.\s*(get|post|put|patch|delete)\s*\(/.test(source)) continue;

    for (const p of internalPathsIn(file)) record(caller, p);
  }
}

// ── 2. Wrapper clients, attributed to whoever constructs them ─────────────
for (const wrapper of WRAPPERS) {
  if (!fs.existsSync(wrapper.file)) continue;
  const paths = internalPathsIn(wrapper.file);
  if (!paths.length) continue;

  for (const dir of fs.readdirSync(SERVICES_DIR)) {
    const caller = `${dir}-service`;
    if (!KNOWN_SERVICES.includes(caller)) continue;

    const constructs = walk(path.join(SERVICES_DIR, dir, 'src')).some((f) =>
      wrapper.constructedBy.test(fs.readFileSync(f, 'utf8'))
    );
    if (constructs) for (const p of paths) record(caller, p);
  }
}

// ── 3. Check every derived call against the ACL ───────────────────────────
const denied = [];
let checked = 0;

for (const caller of [...calls.keys()].sort()) {
  const paths = [...calls.get(caller)].sort();
  if (LIST) console.log(`\n${caller}`);

  for (const p of paths) {
    checked += 1;
    const { allowed, reason } = isInternalCallAllowed(caller, p);
    if (!allowed) denied.push({ caller, path: p, reason });
    if (LIST) console.log(`  ${allowed ? '✔' : '✘'} ${p.padEnd(52)} ${allowed ? '' : reason}`);
  }
}

// ── 4. Report grants nobody uses — not a failure, but worth seeing ────────
const unused = [];
for (const [caller, prefixes] of Object.entries(INTERNAL_ACL)) {
  const used = calls.get(caller) || new Set();
  for (const prefix of prefixes) {
    if (![...used].some((p) => p === prefix || p.startsWith(`${prefix}/`))) {
      unused.push(`${caller} → ${prefix}`);
    }
  }
}

console.log('');

if (denied.length) {
  console.error('✘ The ACL would DENY calls the code actually makes:\n');
  for (const d of denied) console.error(`  ${d.caller}\n      ${d.path}\n      ${d.reason}`);
  console.error(
    '\n  Each of these is a real inter-service call that would 403 at runtime.\n' +
      '  Widen the caller\'s grants in packages/common/src/internalAcl.js.\n'
  );
  process.exit(1);
}

if (unused.length) {
  console.log('Grants no call currently uses — reach that could be narrowed:');
  for (const u of unused) console.log(`  ·  ${u}`);
  console.log('');
}

console.log(
  `✔ Every derived inter-service call is permitted (${checked} call site${checked === 1 ? '' : 's'} across ` +
    `${calls.size} service${calls.size === 1 ? '' : 's'}).`
);
