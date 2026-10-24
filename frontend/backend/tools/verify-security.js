#!/usr/bin/env node
'use strict';

/**
 * Every security check, in one command.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 *
 * The controls added during the security review only hold if they keep being
 * run. Three of them fail the SERVICE at boot — an admin write route with no
 * grant, an unsafe production config, an ACL that does not match the code — so
 * a broken one is caught eventually. "Eventually" means at deploy, in front of
 * whoever is on call.
 *
 * This is the same set of checks, runnable in a second, before the commit.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────
 *
 * It does not claim the platform is secure. Every check here is a REGRESSION
 * test for a specific finding that was fixed; passing means those findings
 * have not come back. It says nothing about game fairness, the payment
 * integrations, infrastructure, or anything a penetration test would find.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   npm run verify:security          # everything that needs no database
 *   npm run verify:security --all    # including the database-dependent checks
 */

const { execFileSync } = require('child_process');
const path = require('path');

const WITH_DB = process.argv.includes('--all') || process.argv.includes('--db');

const CHECKS = [
  {
    name: 'Admin write routes carry a permission',
    tool: 'verify-authz.js',
    why: 'A staff token proves identity, not authority. 8 route files once had no grant at all.',
  },
  {
    name: 'Inter-service ACL matches the call graph',
    tool: 'verify-internal-acl.js',
    why: 'A widened ACL is a silent loss of containment; a narrowed one 403s a money path.',
  },
  {
    name: 'Every module mounts cleanly',
    tool: 'verify-modules.js',
    why: 'Boots all four services\' routers — the broadest check that nothing is misconfigured.',
  },
  {
    name: 'No known-compromised secret in source',
    tool: 'check-secrets.js',
    why: 'Credentials committed once stay committed.',
  },
  {
    name: 'Models match the database',
    tool: 'verify-models.js',
    needsDb: true,
    why: 'An undeclared column writes null silently — the worst way for a money field to fail.',
  },
  {
    name: 'Database grants match the plan',
    tool: 'db-grants.js',
    args: ['--check'],
    needsDb: true,
    why: 'Confirms each service reaches its own tables and is refused the rest.',
  },
];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let failed = 0;
let skipped = 0;

console.log('\nSecurity checks\n');

for (const check of CHECKS) {
  if (check.needsDb && !WITH_DB) {
    skipped += 1;
    console.log(`${DIM}  ·  ${check.name} — skipped (needs a database; pass --all)${RESET}`);
    continue;
  }

  const tool = path.join(__dirname, check.tool);
  try {
    execFileSync(process.execPath, [tool, ...(check.args || [])], { stdio: 'pipe' });
    console.log(`${GREEN}  ✔${RESET}  ${check.name}`);
  } catch (error) {
    failed += 1;
    console.log(`${RED}  ✘${RESET}  ${check.name}`);
    console.log(`${DIM}     ${check.why}${RESET}`);
    const output = `${error.stdout || ''}${error.stderr || ''}`.trim();
    for (const line of output.split('\n').slice(-14)) {
      if (line.trim()) console.log(`     ${line}`);
    }
    console.log('');
  }
}

console.log('');

if (failed) {
  console.error(`${RED}${failed} check(s) failed.${RESET} Each one is a finding that was fixed and has come back.\n`);
  process.exit(1);
}

console.log(
  `${GREEN}All ${CHECKS.length - skipped} check(s) passed.${RESET}` +
    (skipped ? ` ${DIM}(${skipped} skipped — pass --all with a database available.)${RESET}` : '') +
    `\n${DIM}This proves the fixed findings have not regressed. It is not a claim that the platform is secure —\n` +
    `game fairness, the payment integrations and the infrastructure are all outside this.${RESET}\n`
);
