#!/usr/bin/env node
'use strict';

/**
 * Legacy route inventory and port tracker.
 *
 *   node tools/route-inventory.js              write the manifest + checklist
 *   node tools/route-inventory.js --report     show port progress
 *
 * A 591-route port cannot be done from memory. This walks the legacy backend,
 * extracts every route with its source location and mount prefix, assigns each
 * a target service and module, and diffs that against the routes the new
 * services actually expose.
 *
 * The output is the source of truth for "what is left" — and, more importantly,
 * for "what did we silently drop", which is the failure mode that matters when
 * a route quietly stops existing and nobody notices until a player does.
 */

const fs = require('fs');
const path = require('path');
const { writeKeepingEol } = require('./lib/eol');

const ROOT = path.resolve(__dirname, '..');
/**
 * `legacy/` is a SIBLING of `backend/`, not a child.
 *
 * The platform moved into `backend/` so the port and the monolith it replaces
 * sit side by side at the repository root. `ROOT` is the backend; the reference
 * source is one level above it.
 */
const LEGACY = path.join(ROOT, '..', 'legacy');

// ── Which service owns which legacy area ───────────────────────────────
// Keyed by the legacy directory or mount prefix. Anything unmatched lands in
// `unassigned`, which the report prints loudly rather than hiding.
const OWNERSHIP = [
  // user-service: identity, wallet, payments
  [/^(Users|2fa|kyc|emailservice|BankDetails)\//, 'user', 'accounts'],
  [/^(Wallet|internalswap|exchangerate|swap)\//, 'user', 'wallet'],
  [/^(fiatdeposit|fiatwithdraw|depositHistory|withdrawHistory|apay|cricpay|waypay|vaultpro|peerTrade)\//, 'user', 'payments'],
  [/^(bonus|bonuslogs|spinwin|GiftCards|affiliate|clubmembership)\//, 'user', 'rewards'],

  // casino-service
  [/^(Games|Slots|jsgames|jsgamesv2|gis|xgamingapi)\//, 'casino', 'games'],
  [/^(bethistory)\//, 'casino', 'bets'],

  // sports-service
  [/^(sports|sportsapi|sportsbet|sportsbook|sportsmain|mannualsettlement)\//, 'sports', 'betting'],

  // admin-service
  [/^(Admin|system|siteconfig|Banners|Blogs|report|reports|balancesheet|locksystem|maintenance|General)\//, 'admin', 'management'],
  [/^(firabsenotifcation)\//, 'admin', 'notifications'],
];

/**
 * Path rules for routes declared directly in index.js, which has no directory
 * to classify it by. Ordered — the first match wins, so the specific
 * integration prefixes are listed before the broad keyword rules.
 */
const PATH_OWNERSHIP = [
  // ── Platform infrastructure: served by the gateway, not a domain service ──
  [/^\/(health|uploads?\/|assets?\/|favicon)|^\/$|\.txt$|\.html$/i, 'platform', 'infrastructure'],

  // ── Provider callbacks. Path shape is fixed by the third party, so these
  //    must keep their exact legacy paths — they are configured upstream and
  //    cannot be renamed without a provider change request. ──
  [/^\/api\/seamless\//i, 'casino', 'provider-callbacks'],
  [/^\/(callback_evo|launch-game|writeBet|live-bets|gold_api|fetch-(games|products))/i, 'casino', 'provider-callbacks'],
  [/^\/(api\/ccpaymentnotify|webhook\/|blockNotify|crypto_callbacks|processRequest)/i, 'user', 'payment-callbacks'],

  // ── House bank for the in-house crash game ──
  [/^\/(start|stop|win|reset)-house|^\/(updatehouse|gethouse|hour|hr)$/i, 'casino', 'games'],

  // ── Reporting totals ──
  [/^\/(today|total)-(deposits|withdrawals|transactions)/i, 'admin', 'management'],

  // ── Domain keywords ──
  [/^\/(api\/)?(auth|user|users|login|register|profile|editProfile|deleteUser|getUserData|send-otp|2fa|kyc)/i, 'user', 'accounts'],
  [/^\/(api\/)?(wallet|getwallet|balance|getBalance|updatebalance|credit|swap|exchange|rate|getCoinDetails|getAllChains|transfer-(in|out)|inrhistory)/i, 'user', 'wallet'],
  [/^\/(api\/)?(deposit|withdraw|payment|upi|bank|crypto|vault|pay|createDeposit|getOrder|checkorderstatus|createorder)/i, 'user', 'payments'],
  // getDepositData / getWithdrawData / updateWithdrawStatus — the legacy admin
  // payment-queue endpoints. `get`/`update` prefixes hide the domain keyword.
  [/(DepositData|WithdrawData|WithdrawStatus|DepositStatus)/i, 'user', 'payments'],
  [/(referral|referal)/i, 'user', 'rewards'],
  [/^\/(api\/)?(bonus|reward|gift|affiliate|club|spin)/i, 'user', 'rewards'],
  [/^\/(api\/)?(casino|game|slot|bet[0-9]|jackpot|vendor|provider|crash|mine|dice|update-image|update-gis)/i, 'casino', 'games'],
  [/^\/(api\/)?(bets|betHistory|transaction\/(live|slot))/i, 'casino', 'bets'],
  [/^\/(api\/)?(sport|fancy|market|settle|odds|match|event)/i, 'sports', 'betting'],
  [/^\/(api\/)?(admin|staff|report|config|banner|blog|maintenance|lock|dashboard|member)/i, 'admin', 'management'],
];

const ROUTE_RE = /\b(?:app|server|router)\s*\.\s*(get|post|put|patch|delete|all)\s*\(\s*(['"`])([^'"`]+)\2/g;
const MOUNT_RE = /\b(?:app|server)\s*\.\s*use\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*([^)]*)/g;

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name.endsWith('.js')) files.push(full);
  }
  return files;
}

/** Map a legacy file + route path to the service and module that should own it. */
function assign(relativeFile, routePath) {
  for (const [pattern, service, module] of OWNERSHIP) {
    if (pattern.test(relativeFile)) return { service, module };
  }
  for (const [pattern, service, module] of PATH_OWNERSHIP) {
    if (pattern.test(routePath)) return { service, module };
  }
  return { service: 'unassigned', module: 'unassigned' };
}

/**
 * Extract the mount prefixes declared in index.js, so router routes get full paths.
 *
 * Two forms have to be handled, because legacy uses both:
 *
 *   server.use('/kyc', require('./kyc/routes'))     // inline require
 *   server.use('/api/internalsettle', settleRoutes) // variable declared above
 *
 * The second form is the common one — 51 of the mounts in `legacy/index.js` are
 * variables — so resolving only the inline form left most router files with no
 * prefix, and their routes recorded as `/momatches` instead of
 * `/api/internalsettle/momatches`. That matters beyond cosmetics: bare paths
 * collide (`/momatches` is also declared in `sportsbet/routes.js`), so the
 * de-duplication step silently merged two different endpoints into one.
 */
const REQUIRE_DECL_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"`]\.\/?([^'"`]+)['"`]\s*\)/g;

function extractMounts(indexPath) {
  if (!fs.existsSync(indexPath)) return [];
  const source = fs.readFileSync(indexPath, 'utf8');

  // varName -> required path, for the `server.use('/x', someRouter)` form.
  const byVariable = new Map();
  for (const match of source.matchAll(REQUIRE_DECL_RE)) {
    byVariable.set(match[1], match[2]);
  }

  const mounts = [];

  for (const match of source.matchAll(MOUNT_RE)) {
    const prefix = match[2];
    if (!prefix.startsWith('/')) continue;

    const handler = match[3] || '';

    // server.use('/kyc', require('./kyc/routes'))
    const inlineRequire = handler.match(/require\(\s*['"`]\.\/?([^'"`]+)['"`]/);
    if (inlineRequire) {
      mounts.push({ prefix, file: inlineRequire[1] });
      continue;
    }

    // server.use('/api/internalsettle', mannualSettlementRoutes)
    const variable = handler.match(/^\s*([A-Za-z_$][\w$]*)/);
    const resolved = variable && byVariable.get(variable[1]);
    mounts.push({ prefix, file: resolved || null });
  }

  return mounts;
}

/**
 * Is the match at `index` on a line that has been commented out?
 *
 * Looks backwards to the start of the line and asks whether a `//` precedes the
 * declaration. A `//` inside a string on the same line would be a false
 * positive; there are none in the legacy sources, and the alternative is a
 * JavaScript parser inside a counting tool.
 */
function isCommentedOut(source, index) {
  const lineStart = source.lastIndexOf('\n', index) + 1;
  return source.slice(lineStart, index).includes('//');
}

function collect() {
  const routes = [];
  let commentedOut = 0;
  const files = walk(LEGACY);
  const mounts = extractMounts(path.join(LEGACY, 'index.js'));

  /** Best-effort: match a router file to the prefix it was mounted under. */
  const prefixFor = (relative) => {
    const withoutExt = relative.replace(/\.js$/, '');
    const hit = mounts.find(
      (m) => m.file && (withoutExt === m.file || withoutExt.endsWith(m.file) || m.file.endsWith(withoutExt))
    );
    return hit ? hit.prefix : null;
  };

  for (const file of files) {
    const relative = path.relative(LEGACY, file);
    const source = fs.readFileSync(file, 'utf8');
    const isEntry = /^index3?\.js$/.test(relative);
    const mountPrefix = isEntry ? '' : prefixFor(relative);

    for (const match of source.matchAll(ROUTE_RE)) {
      const method = match[1].toUpperCase();
      const declared = match[3];

      // Skip obvious non-routes (regex fragments, urls).
      if (declared.startsWith('http')) continue;

      /**
       * A commented-out route is not a route.
       *
       * `legacy/index.js` carries whole handlers behind `//`, and counting them
       * inflates the work remaining with endpoints that serve no traffic and
       * that nobody can call. `/api/depositNew` and `/api/withdrawNew` are the
       * pair that surfaced this — both fully commented out, both counted, both
       * appearing in the "still to port" list.
       *
       * This checks the line the declaration sits on rather than tracking
       * comment state properly. That is deliberate: block comments around a
       * route declaration are rare in this codebase and a real parser is a lot
       * of machinery for a counting tool. If a route ever goes missing from the
       * inventory, look here first.
       */
      if (isCommentedOut(source, match.index)) {
        commentedOut += 1;
        continue;
      }

      const fullPath =
        isEntry || !mountPrefix
          ? declared
          : `${mountPrefix}${declared === '/' ? '' : declared}`.replace(/\/{2,}/g, '/');

      const line = source.slice(0, match.index).split('\n').length;
      const { service, module } = assign(relative, fullPath);

      routes.push({
        method,
        path: fullPath,
        declaredPath: declared,
        mountPrefix: mountPrefix || null,
        sourceFile: relative,
        sourceLine: line,
        service,
        module,
        // Rough size signal for planning: how much SQL the file carries.
        fileQueryCount: (source.match(/\.query\(/g) || []).length,
      });
    }
  }

  // Deduplicate: the same method+path declared twice is a legacy bug, but it
  // should appear once in the plan.
  const seen = new Map();
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (!seen.has(key)) seen.set(key, route);
    else seen.get(key).duplicate = true;
  }

  return [...seen.values()].sort((a, b) =>
    a.service === b.service
      ? a.path.localeCompare(b.path)
      : a.service.localeCompare(b.service)
  );
}

/** Routes the NEW services expose, by reading their route tables. */
function collectPorted() {
  const ported = [];
  const targets = [
    ['user', path.join(ROOT, 'services/user/src')],
    ['admin', path.join(ROOT, 'services/admin/src')],
    ['casino', path.join(ROOT, 'services/casino/src')],
    ['sports', path.join(ROOT, 'services/sports/src')],
    ['gateway', path.join(ROOT, 'gateway/src')],
  ];

  for (const [service, dir] of targets) {
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(ROUTE_RE)) {
        ported.push({
          service,
          method: match[1].toUpperCase(),
          path: match[3],
          sourceFile: path.relative(ROOT, file),
        });
      }
      // `@legacy` tags let a ported handler claim the legacy route it replaces,
      // even when the new path differs.
      for (const match of source.matchAll(/@legacy\s+([A-Z]+)\s+(\S+)/g)) {
        ported.push({
          service,
          method: match[1].toUpperCase(),
          path: match[2],
          legacyClaim: true,
          sourceFile: path.relative(ROOT, file),
        });
      }
    }
  }
  return ported;
}

function main() {
  const legacyRoutes = collect();
  const portedRoutes = collectPorted();

  const claimed = new Set(
    portedRoutes.filter((r) => r.legacyClaim).map((r) => `${r.method} ${r.path}`)
  );

  for (const route of legacyRoutes) {
    route.ported = claimed.has(`${route.method} ${route.path}`);
  }

  const byService = {};
  for (const route of legacyRoutes) {
    byService[route.service] ??= { total: 0, ported: 0, modules: {} };
    byService[route.service].total += 1;
    if (route.ported) byService[route.service].ported += 1;
    byService[route.service].modules[route.module] ??= { total: 0, ported: 0 };
    byService[route.service].modules[route.module].total += 1;
    if (route.ported) byService[route.service].modules[route.module].ported += 1;
  }

  // ── Report ───────────────────────────────────────────────────────────
  const done = legacyRoutes.filter((r) => r.ported).length;
  const pct = ((done / legacyRoutes.length) * 100).toFixed(1);

  console.log(`\nLegacy routes: ${legacyRoutes.length}   ported: ${done} (${pct}%)\n`);
  console.log('service     module          ported / total');
  console.log('─'.repeat(48));

  for (const [service, stats] of Object.entries(byService).sort()) {
    for (const [module, m] of Object.entries(stats.modules).sort()) {
      const bar = m.ported === m.total ? '✔' : ' ';
      console.log(`${bar} ${service.padEnd(11)} ${module.padEnd(15)} ${String(m.ported).padStart(4)} / ${m.total}`);
    }
  }

  if (process.argv.includes('--report')) return;

  // ── Artefacts ────────────────────────────────────────────────────────
  const outDir = path.join(ROOT, 'docs');
  fs.mkdirSync(outDir, { recursive: true });

  writeKeepingEol(
    path.join(outDir, 'route-manifest.json'),
    `${JSON.stringify({ generatedFrom: 'legacy/', total: legacyRoutes.length, ported: done, routes: legacyRoutes }, null, 2)}\n`
  );

  const lines = [
    '# Legacy route port checklist',
    '',
    `Generated by \`node tools/route-inventory.js\`. **${done} / ${legacyRoutes.length}** migrated (${pct}%).`,
    '',
    '**Every route in this file works.** They are all live in `legacy/` and',
    'serving traffic today. The marker tracks where a route is *served from*,',
    'not whether it functions:',
    '',
    '| | Meaning |',
    '|---|---|',
    '| ✅ | Migrated. Served by the new services; the old path still works through the gateway. |',
    '| ⬜ | Still served by `legacy/`. Working — not yet migrated. |',
    '',
    'A route flips to ✅ only when a handler in the new services carries a',
    '`@legacy <METHOD> <path>` tag claiming it. That tag is what keeps this',
    'honest — a route cannot be marked done by editing this file.',
    '',
  ];

  for (const [service, stats] of Object.entries(byService).sort()) {
    lines.push(`## ${service} — ${stats.ported}/${stats.total}`, '');
    const routes = legacyRoutes.filter((r) => r.service === service);
    for (const module of [...new Set(routes.map((r) => r.module))].sort()) {
      lines.push(`### ${module}`, '');
      lines.push('| | Method | Path | Legacy source |');
      lines.push('|---|---|---|---|');
      for (const route of routes.filter((r) => r.module === module)) {
        lines.push(
          `| ${route.ported ? '✅' : '⬜'} | \`${route.method}\` | \`${route.path}\` | \`${route.sourceFile}:${route.sourceLine}\` |`
        );
      }
      lines.push('');
    }
  }

  writeKeepingEol(path.join(outDir, 'ROUTE-PORT-CHECKLIST.md'), `${lines.join('\n')}\n`);

  /**
   * Splice the same inventory into the appendix of API-ROUTES.md, between the
   * generated markers. Everything above them is hand-written and must survive —
   * so this replaces a region rather than rewriting the file.
   */
  const apiDocPath = path.join(outDir, 'API-ROUTES.md');
  if (fs.existsSync(apiDocPath)) {
    const START = '<!-- BEGIN GENERATED: node tools/route-inventory.js -->';
    const END = '<!-- END GENERATED -->';
    const doc = fs.readFileSync(apiDocPath, 'utf8');
    const from = doc.indexOf(START);
    const to = doc.indexOf(END);

    if (from !== -1 && to > from) {
      const appendix = [
        '',
        'Every route in `legacy/`, grouped by the service that will own it.',
        '',
        '**All of these work today.** They are live in `legacy/` and serving',
        'traffic. The marker says where a route is *served from*, not whether it',
        `functions — **${done} / ${legacyRoutes.length}** migrated so far (${pct}%).`,
        '',
        '| | Meaning |',
        '|---|---|',
        '| ✅ | Migrated to the new services. The old path still works, through the gateway. |',
        '| ⬜ | Still served by `legacy/`. Working — not yet migrated. |',
        '',
        ...lines.slice(lines.findIndex((l) => l.startsWith('## '))),
      ].join('\n');

      writeKeepingEol(apiDocPath, `${doc.slice(0, from + START.length)}\n${appendix}\n${doc.slice(to)}`);
      console.log('Updated the appendix in docs/API-ROUTES.md');
    }
  }

  console.log(`\nWrote docs/route-manifest.json and docs/ROUTE-PORT-CHECKLIST.md`);
}

if (require.main === module) main();

module.exports = { collect, collectPorted, assign };
