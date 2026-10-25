'use strict';

/**
 * Dry run: would each service start with NODE_ENV=production on THIS machine's .env?
 *
 *   node scripts/check-production-config.js      (from backend/, on the server)
 *
 * Production turns on HSTS and the boot checks in packages/common/src/productionGuards.js
 * (weak JWT secrets, a default DB password, rate limiting off, CORS "*"). Those checks
 * refuse to START a service, so flipping NODE_ENV blind can take the site down. This loads
 * each service's real config as production, runs the same checks and prints what would
 * block a start. It starts nothing, writes nothing and never prints a secret.
 * Exit code 1 when any service would refuse to start. See docs/SECURITY-CHECKLIST.md #10.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SERVICES = ['gateway', 'services/user', 'services/admin', 'services/casino', 'services/sports'];

// One child per service: each config module reads the environment once, at require time.
const CHILD = `
const { auditProductionConfig } = require('@ibitplay/common/src/productionGuards');
const config = require(process.argv[1]);
const { fatal, warn } = auditProductionConfig(config, process.argv[2]);
const cors = config.CORS_ORIGIN;
if (cors === undefined || (Array.isArray(cors) ? cors.includes('*') : cors === '*')) {
  fatal.push('CORS_ORIGIN is "*" (or unset) — createApp refuses that in production.');
}
console.log(JSON.stringify({ fatal, warn }));
`;

let blocked = false;

for (const dir of SERVICES) {
  const name = path.basename(dir);
  const configPath = path.join(__dirname, '..', dir, 'src', 'config.js');
  const run = spawnSync(process.execPath, ['-e', CHILD, configPath, name], {
    cwd: path.join(__dirname, '..', dir),
    env: { ...process.env, NODE_ENV: 'production' },
    encoding: 'utf8',
  });

  let result;
  try {
    result = JSON.parse(run.stdout.trim().split('\n').pop());
  } catch {
    blocked = true;
    console.log(`\n✘ ${name}: config did not load\n  ${(run.stderr || run.stdout).trim().split('\n').slice(0, 3).join('\n  ')}`);
    continue;
  }

  if (result.fatal.length) blocked = true;
  console.log(`\n${result.fatal.length ? '✘' : '✔'} ${name}`);
  for (const m of result.fatal) console.log(`  BLOCKS START: ${m}`);
  for (const m of result.warn) console.log(`  warning: ${m}`);
}

console.log(blocked ? '\nNot safe to set NODE_ENV=production yet: fix the BLOCKS START lines first.' : '\nSafe to set NODE_ENV=production.');
process.exitCode = blocked ? 1 : 0;
