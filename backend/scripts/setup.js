#!/usr/bin/env node
'use strict';

/**
 * One command that takes a fresh clone to a running platform.
 *
 *   node scripts/setup.js            interactive — asks for database details
 *   node scripts/setup.js --yes      non-interactive, every default accepted
 *   node scripts/setup.js --demo     …and load the demo dataset as well
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS RATHER THAN A LIST OF STEPS IN THE README
 *
 * The README's quick start is four commands and one of them is "generate a
 * secret, one per secret". There are EIGHT secrets, three of them must differ
 * from each other or the platform refuses to boot in production, and two of
 * the variables the services require are not in `.env.example` at all:
 *
 *   SOCKET_ALLOWED_ORIGINS   absent from the example file. It has NO default —
 *                            unset means no browser can open a socket to any
 *                            of the three services that serve one, and the
 *                            failure is a silent CORS rejection in the client.
 *
 *   SPORTS_FEED_KEY          present but EMPTY, and declared as `coercers.str()`
 *                            with no default. sports-service exits at boot on
 *                            an empty value, which takes `npm run dev` down
 *                            with it because the dev runner stops everything
 *                            when one child dies.
 *
 * So a person following the README lands on a platform that installs, migrates
 * and then will not start. This file closes that gap: it fills every variable
 * a service actually requires, generates the secrets, and only then touches
 * the database.
 *
 * ── IT IS SAFE TO RE-RUN ─────────────────────────────────────────────────
 *
 * Every step is idempotent. An existing `.env` is edited in place and real
 * values are never overwritten — only empty ones and the example file's
 * `dev-only-…-replace-me` placeholders. `db:create` skips an existing database,
 * migrations and seeders are tracked, and the data runner upserts.
 *
 * The one destructive flag is `--fresh`, which DROPS the database first. It
 * asks, every time, unless you also pass `--yes`.
 * ═════════════════════════════════════════════════════════════════════════
 */

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ROOT = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT, '.env');
const ENV_EXAMPLE = path.join(ROOT, '.env.example');

// ══════════════════════════════════════════════════════════════════════════
//  Output
// ══════════════════════════════════════════════════════════════════════════

const TTY = process.stdout.isTTY;
const c = (code) => (text) => (TTY ? `\x1b[${code}m${text}\x1b[0m` : String(text));
const bold = c('1');
const dim = c('2');
const red = c('31');
const green = c('32');
const yellow = c('33');
const blue = c('34');
const cyan = c('36');

let stepNumber = 0;
const started = Date.now();

const say = (message = '') => process.stdout.write(`${message}\n`);
const step = (title) => say(`\n${blue(`▸ ${++stepNumber}. ${title}`)}`);
const ok = (message) => say(`  ${green('✓')} ${message}`);
const info = (message) => say(`  ${dim('·')} ${dim(message)}`);
const warn = (message) => say(`  ${yellow('!')} ${yellow(message)}`);

/** Stop with a readable reason rather than a stack trace nobody reads. */
function fail(message, hint) {
  say(`\n${red('✗ Setup stopped')}`);
  say(`  ${message}`);
  if (hint) say(`\n  ${dim(hint)}`);
  process.exit(1);
}

// ══════════════════════════════════════════════════════════════════════════
//  Arguments
// ══════════════════════════════════════════════════════════════════════════

function parseArgs(argv) {
  const flags = new Set(argv.slice(2).filter((a) => a.startsWith('-')));
  const has = (...names) => names.some((n) => flags.has(n));

  if (has('--help', '-h')) {
    say(`
${bold('iBitPlay backend — setup')}

  node scripts/setup.js [flags]

${bold('Flags')}
  -y, --yes             Accept every default. No prompts.
      --demo            Load the demo dataset (staff tree, players, content).
      --no-data         Skip the data runner entirely (schema + bootstrap only).
      --fresh           DROP the database first, then rebuild it. Destructive.
      --skip-install    Do not run npm install.
      --skip-db         Configure .env only — touch no database.
      --new-secrets     Regenerate every secret, even ones already set.
  -h, --help            This text.

${bold('What it does')}
  1. Checks Node and the workspace.
  2. Creates or repairs .env — generates all 8 secrets, fills required vars.
  3. npm install (workspaces).
  4. Creates the database, runs 37 migrations, runs the bootstrap seeders.
  5. Runs the data runner: platform config, and demo data with --demo.
  6. Verifies every model against the real schema.
`);
    process.exit(0);
  }

  return {
    yes: has('--yes', '-y'),
    demo: has('--demo'),
    noData: has('--no-data'),
    fresh: has('--fresh'),
    skipInstall: has('--skip-install'),
    skipDb: has('--skip-db'),
    newSecrets: has('--new-secrets'),
  };
}

const args = parseArgs(process.argv);

// ══════════════════════════════════════════════════════════════════════════
//  Prompting
// ══════════════════════════════════════════════════════════════════════════

let rl = null;

function ask(question, fallback) {
  if (args.yes) return Promise.resolve(fallback);
  if (!TTY) return Promise.resolve(fallback);

  rl = rl || readline.createInterface({ input: process.stdin, output: process.stdout });
  const suffix = fallback ? dim(` [${fallback}]`) : dim(' []');

  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix} `, (answer) => resolve(answer.trim() || fallback || ''));
  });
}

async function confirm(question, fallback = false) {
  if (args.yes) return true;
  if (!TTY) return fallback;
  const answer = await ask(`${question} ${dim(fallback ? '(Y/n)' : '(y/N)')}`, fallback ? 'y' : 'n');
  return /^y(es)?$/i.test(String(answer));
}

// ══════════════════════════════════════════════════════════════════════════
//  Running things
// ══════════════════════════════════════════════════════════════════════════

/**
 * Run a command, streaming its output through this terminal.
 *
 * `shell: false` on purpose — every argument here is ours, and going through a
 * shell would only add a quoting bug waiting to happen.
 */
/**
 * Quote a command path for the Windows shell.
 *
 * `shell: true` on win32 hands the command line to cmd.exe, which splits on
 * spaces before the program is resolved. `process.execPath` is
 * `C:Program Files
odejs
ode.exe` on a default install, so every db and
 * data step died with `'C:Program' is not recognized`. Quoting the
 * program — and only the program, the args are ours and space-free — is what
 * makes the shell treat it as one token.
 */
const shellSafe = (command) =>
  process.platform === 'win32' && /s/.test(command) ? `"${command}"` : command;

function run(command, commandArgs, { label, allowFailure = false } = {}) {
  const result = spawnSync(shellSafe(command), commandArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });

  if (result.error) {
    if (allowFailure) return false;
    fail(`Could not run \`${command}\`: ${result.error.message}`);
  }

  if (result.status !== 0) {
    if (allowFailure) return false;
    fail(
      `${label || `\`${command} ${commandArgs.join(' ')}\``} failed (exit ${result.status}).`,
      'The output above says why. Fix it and run `node scripts/setup.js` again — every step is idempotent.'
    );
  }

  return true;
}

/** The database CLI, which is where every schema operation already lives. */
const dbCli = (command, label) =>
  run(process.execPath, [path.join('packages', 'db', 'src', 'cli.js'), command], { label });

/** The same, but a non-zero exit is reported rather than fatal. */
const dbCliSoft = (command) =>
  run(process.execPath, [path.join('packages', 'db', 'src', 'cli.js'), command], { allowFailure: true });

// ══════════════════════════════════════════════════════════════════════════
//  Step 1 — preflight
// ══════════════════════════════════════════════════════════════════════════

function preflight() {
  step('Checking the environment');

  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    fail(
      `Node ${process.versions.node} is too old — this platform requires Node 20 or newer.`,
      'nvm install 20 && nvm use 20'
    );
  }
  ok(`Node ${process.versions.node}`);

  const pkgPath = path.join(ROOT, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    fail(`No package.json at ${ROOT}.`, 'Run this from inside the backend directory.');
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.workspaces) {
    fail('That package.json has no "workspaces" — this is not the backend root.');
  }
  ok(`Workspace root: ${ROOT}`);

  // `psql` is not required — the CLI connects with `pg` — but its absence is
  // usually the first sign that Postgres is not installed at all, and saying so
  // here is cheaper than a connection timeout four steps later.
  const psql = spawnSync('psql', ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' });
  if (psql.status === 0) ok(String(psql.stdout).trim());
  else info('psql not on PATH — fine if the database is remote or in Docker');
}

// ══════════════════════════════════════════════════════════════════════════
//  Step 2 — the environment file
// ══════════════════════════════════════════════════════════════════════════

/**
 * The secrets, and why each one is separate from the others.
 *
 * `productionGuards.auditProductionConfig` refuses to boot production when any
 * of these is under 32 characters, looks like a placeholder, or when the admin
 * secret equals the access secret. 32 random bytes as hex is 64 characters, so
 * everything generated here clears that bar by construction.
 */
const SECRETS = [
  { key: 'JWT_ACCESS_SECRET', note: 'signs player access tokens' },
  { key: 'JWT_REFRESH_SECRET', note: 'signs refresh tokens — must differ from the access secret' },
  { key: 'JWT_ADMIN_SECRET', note: 'signs staff tokens — a leaked player secret must not mint one' },
  { key: 'INTERNAL_API_KEY', note: 'the shared service-to-service key' },
  { key: 'TOTP_ENCRYPTION_KEY', note: 'encrypts stored 2FA secrets at rest' },
  { key: 'INTERNAL_KEY_USER_SERVICE', note: 'identifies user-service on internal calls' },
  { key: 'INTERNAL_KEY_ADMIN_SERVICE', note: 'identifies admin-service on internal calls' },
  { key: 'INTERNAL_KEY_CASINO_SERVICE', note: 'identifies casino-service on internal calls' },
  { key: 'INTERNAL_KEY_SPORTS_SERVICE', note: 'identifies sports-service on internal calls' },
];

/**
 * Variables a service REQUIRES but the example file leaves empty or omits.
 *
 * Each of these is the difference between "the platform starts" and "the
 * platform exits at boot with a zod error", so they get a working default
 * rather than a comment asking somebody to remember.
 */
const REQUIRED_DEFAULTS = [
  {
    key: 'SOCKET_ALLOWED_ORIGINS',
    value: 'http://localhost:3000,http://localhost:3001,http://localhost:3003,http://127.0.0.1:3000,http://127.0.0.1:3001,http://127.0.0.1:3003,http://localhost:5173',
    note: 'browser origins allowed to open a socket — no default, and absent from .env.example',
  },
  {
    key: 'CORS_ORIGIN',
    value: 'http://localhost:3000,http://localhost:3001,http://localhost:3003,http://localhost:5173',
    note: 'browser origins allowed to call the HTTP API',
  },
  {
    key: 'SPORTS_FEED_URL',
    value: 'https://feed.example.com/api',
    note: 'the odds feed — required, no default. Replace with the real provider URL.',
    placeholder: true,
  },
  {
    key: 'SPORTS_FEED_KEY',
    value: 'replace-with-real-feed-key',
    note: 'the odds feed key — required and empty in .env.example, which stops sports-service booting',
    placeholder: true,
  },
  { key: 'NODE_ENV', value: 'development' },
  { key: 'LOG_PRETTY', value: 'true' },
  { key: 'SEED_ADMIN_USERNAME', value: 'superadmin' },
  { key: 'SEED_ADMIN_EMAIL', value: 'admin@ibitplay.local' },
  { key: 'SEED_ADMIN_PASSWORD', value: 'ChangeMe!2026' },
];

/** Database settings, asked for interactively because they are per-machine. */
const DB_PROMPTS = [
  { key: 'DB_HOST', question: 'Postgres host', fallback: '127.0.0.1' },
  { key: 'DB_PORT', question: 'Postgres port', fallback: '5432' },
  { key: 'DB_NAME', question: 'Database name', fallback: 'ibitplay' },
  { key: 'DB_USER', question: 'Postgres user', fallback: 'postgres' },
  { key: 'DB_PASSWORD', question: 'Postgres password', fallback: 'postgres' },
];

/** Values that mean "nobody has filled this in yet". */
const PLACEHOLDER = /^$|replace[-_ ]?me|change[-_ ]?me|dev-only|your-|<.*>|example\.com|placeholder/i;

const isPlaceholder = (value) => value === undefined || PLACEHOLDER.test(String(value).trim());

/** 32 random bytes as hex — 64 characters, twice the enforced minimum. */
const generateSecret = () => crypto.randomBytes(32).toString('hex');

/**
 * Read `.env` as a line list so comments and ordering survive a rewrite.
 *
 * A parse-to-object-and-serialise round trip would throw away the 17KB of
 * commentary in that file, which is most of what makes it followable.
 */
function readEnvLines() {
  if (fs.existsSync(ENV_FILE)) return { lines: fs.readFileSync(ENV_FILE, 'utf8').split('\n'), created: false };

  if (!fs.existsSync(ENV_EXAMPLE)) {
    fail('Neither .env nor .env.example exists.', 'Both should be in the repository — check you cloned everything.');
  }

  return { lines: fs.readFileSync(ENV_EXAMPLE, 'utf8').split('\n'), created: true };
}

function envValue(lines, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*=(.*)$`);
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match) return match[1].trim();
  }
  return undefined;
}

/** Replace a key's line in place, or append it if the file never had one. */
function setEnv(lines, key, value, appended) {
  const pattern = new RegExp(`^\\s*${key}\\s*=`);
  const index = lines.findIndex((line) => pattern.test(line));

  if (index >= 0) {
    lines[index] = `${key}=${value}`;
    return;
  }

  appended.push(`${key}=${value}`);
}

async function configureEnv() {
  step('Configuring .env');

  const { lines, created } = readEnvLines();
  const appended = [];
  const generated = [];
  const filled = [];

  // ── Database ─────────────────────────────────────────────────────────
  //
  // Only asked on a first run. On a re-run the existing values are somebody's
  // working configuration and overwriting them is the opposite of helpful.
  if (created && !args.yes && TTY) {
    say(`  ${dim('Database connection — press enter to accept each default.')}`);
    for (const prompt of DB_PROMPTS) {
      const current = envValue(lines, prompt.key);
      const answer = await ask(prompt.question, current && !isPlaceholder(current) ? current : prompt.fallback);
      setEnv(lines, prompt.key, answer, appended);
    }
    say('');
  } else {
    for (const prompt of DB_PROMPTS) {
      if (envValue(lines, prompt.key) === undefined) setEnv(lines, prompt.key, prompt.fallback, appended);
    }
  }

  // ── Secrets ──────────────────────────────────────────────────────────
  for (const secret of SECRETS) {
    const current = envValue(lines, secret.key);
    const needsValue = args.newSecrets || isPlaceholder(current);

    if (!needsValue) continue;

    setEnv(lines, secret.key, generateSecret(), appended);
    generated.push(secret);
  }

  // Three of them must not collide. Generated values never will, but a
  // hand-edited file can — and the failure mode (a player secret that mints
  // staff tokens) is bad enough to be worth one comparison.
  const distinct = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'JWT_ADMIN_SECRET'];
  const seen = new Map();
  for (const key of distinct) {
    const value = envValue(lines, key);
    if (!value) continue;
    if (seen.has(value)) {
      warn(`${key} is identical to ${seen.get(value)} — regenerating it`);
      setEnv(lines, key, generateSecret(), appended);
    } else {
      seen.set(value, key);
    }
  }

  // ── Everything else a service needs to boot ──────────────────────────
  for (const required of REQUIRED_DEFAULTS) {
    const current = envValue(lines, required.key);
    if (current !== undefined && !isPlaceholder(current)) continue;

    setEnv(lines, required.key, required.value, appended);
    filled.push(required);
  }

  if (appended.length) {
    lines.push(
      '',
      '# ─────────────────────────────────────────────────────────────────────',
      '# Added by scripts/setup.js — variables the services require that the',
      '# template did not carry. Safe to move up into the sections above.',
      '# ─────────────────────────────────────────────────────────────────────',
      ...appended,
      ''
    );
  }

  // 0600: this file now holds eight live secrets and the database password.
  fs.writeFileSync(ENV_FILE, lines.join('\n'), { mode: 0o600 });
  try {
    fs.chmodSync(ENV_FILE, 0o600);
  } catch {
    /* Windows, or a filesystem that does not do modes — not worth failing over */
  }

  ok(created ? '.env created from .env.example' : '.env updated in place');
  if (generated.length) {
    ok(`${generated.length} secret(s) generated (32 random bytes each)`);
    for (const secret of generated) info(`${secret.key} — ${secret.note}`);
  } else {
    info('every secret already had a real value — none replaced');
  }

  for (const item of filled) {
    if (item.placeholder) warn(`${item.key} set to a PLACEHOLDER — ${item.note}`);
    else info(`${item.key} filled — ${item.note || 'required by a service'}`);
  }

  /**
   * Load what we just wrote, so `--fresh` and the summary see it.
   *
   * `override: false`, matching `common/env.js`. A real environment variable
   * OUTRANKS the file — that is how every service in this platform resolves
   * config, and it is how a one-off run like
   *
   *     DB_NAME=ibitplay_scratch node scripts/setup.js
   *
   * is supposed to work. With `override: true` the file silently won that
   * argument and the run built the database named in `.env` instead, which is
   * the one case where being wrong is expensive.
   */
  require('dotenv').config({ path: ENV_FILE, override: false, quiet: true });

  return { placeholders: filled.filter((f) => f.placeholder) };
}

// ══════════════════════════════════════════════════════════════════════════
//  Step 3 — dependencies
// ══════════════════════════════════════════════════════════════════════════

function install() {
  step('Installing dependencies');

  if (args.skipInstall) {
    info('skipped (--skip-install)');
    return;
  }

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  say(dim('  npm install — this pulls the workspace packages too, so give it a minute.\n'));
  run(npm, ['install'], { label: 'npm install' });
  ok('dependencies installed');
}

// ══════════════════════════════════════════════════════════════════════════
//  Step 4 — the database
// ══════════════════════════════════════════════════════════════════════════

/**
 * DROP DATABASE, on purpose and only when asked twice.
 *
 * Sessions are terminated first: Postgres refuses to drop a database anything
 * is connected to, and "a stale psql in another tab" is the usual reason a
 * `--fresh` run fails half way.
 */
async function dropDatabase() {
  const name = process.env.DB_NAME || 'ibitplay';

  say('');
  warn(`--fresh will DROP the database "${name}". Every row in it is destroyed.`);

  if (!(await confirm(`Type y to destroy "${name}"`, false))) {
    fail('Cancelled — nothing was dropped.');
  }

  let Client;
  try {
    ({ Client } = require('pg'));
  } catch {
    fail('`pg` is not installed, so --fresh cannot connect.', 'Run without --skip-install first.');
  }

  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || undefined,
    database: 'postgres',
  });

  await client.connect();
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name]
    );
    await client.query(`DROP DATABASE IF EXISTS "${name.replace(/"/g, '""')}"`);
    ok(`dropped "${name}"`);
  } finally {
    await client.end();
  }
}

async function buildDatabase() {
  step('Building the database');

  if (args.skipDb) {
    info('skipped (--skip-db)');
    return false;
  }

  // Named out loud before anything is written to it. Every destructive mistake
  // in this file's history is a step that ran against a database nobody said
  // the name of.
  const target = `${process.env.DB_USER}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
  ok(`target: ${bold(target)}`);

  if (args.fresh) await dropDatabase();

  say(dim('\n  create → migrate → seed\n'));

  dbCli('create', 'Creating the database');
  dbCli('migrate', 'Running migrations');
  dbCli('seed', 'Running the bootstrap seeders');

  ok('schema built, roles and the super-admin seeded');

  applyGrants();
  return true;
}

/**
 * Per-service Postgres roles, when the environment asks for them.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WITHOUT THIS, A CONFIGURED DEPLOYMENT 500s ON EVERY REQUEST
 *
 * `DB_USER_ADMIN_SERVICE` and friends are opt-in: `resolveCredentials` falls
 * back to `DB_USER` when they are unset, so a deployment that never adopted the
 * roles is unaffected. But the roles are CLUSTER-wide and the grants are
 * PER-DATABASE — so an `.env` that names them, pointed at a database created
 * five minutes ago, connects as `ibitplay_admin` into a database where that
 * role has been granted nothing.
 *
 * The result is not a boot failure. Every service starts, `/health` is green
 * because the health probe is `SELECT 1`, and then the first real query returns
 *
 *     permission denied for table staff
 *
 * as a 500. Which is a genuinely confusing way to discover the problem, and it
 * is why this runs as part of setup rather than living in the README as a step
 * somebody is expected to remember.
 * ═════════════════════════════════════════════════════════════════════════
 */
function applyGrants() {
  const scoped = ['USER', 'ADMIN', 'CASINO', 'SPORTS'].filter(
    (service) => process.env[`DB_USER_${service}_SERVICE`] && process.env[`DB_PASSWORD_${service}_SERVICE`]
  );

  if (!scoped.length) {
    info('no DB_USER_*_SERVICE roles configured — every service connects as DB_USER');
    return;
  }

  const grants = path.join('tools', 'db-grants.js');

  /**
   * `--check` FIRST, because `--apply` rotates.
   *
   * For a role that already exists, db-grants emits
   * `ALTER ROLE … PASSWORD '<new random>'` and prints the new value for you to
   * paste into `.env`. Those roles are CLUSTER-wide — so applying here to set
   * up a scratch database would silently invalidate the password every OTHER
   * database's deployment is using, and the only warning would be a block of
   * text scrolling past in a setup log.
   *
   * So: if the roles already reach their tables, leave them completely alone.
   */
  const check = capture(process.execPath, [grants, '--check']);
  if (check.status === 0) {
    ok(`service roles already reach their tables (${scoped.map((s) => s.toLowerCase()).join(', ')})`);
    return;
  }

  say(dim(`\n  ${scoped.length} service role(s) named in .env cannot reach this database — granting\n`));

  const applied = capture(process.execPath, [grants, '--apply'], { echo: true });
  if (applied.status !== 0) {
    warn(
      'db-grants failed. Every service will connect as its scoped role and get ' +
        '"permission denied" on the first real query — /health stays green because it only runs SELECT 1. ' +
        'Fix the cause and run `npm run db:grants`.'
    );
    return;
  }

  // The new passwords go back into `.env` here rather than being printed for
  // somebody to copy. A rotation nobody records is a platform that cannot
  // reconnect after the next restart.
  const rotated = writeRotatedPasswords(applied.stdout);
  ok(`grants applied for ${scoped.map((s) => s.toLowerCase()).join(', ')}`);
  if (rotated.length) ok(`${rotated.length} rotated role password(s) written back to .env`);
}

/** Run something and keep its output, optionally echoing it as it goes. */
function capture(command, commandArgs, { echo = false } = {}) {
  const result = spawnSync(shellSafe(command), commandArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
  });

  const stdout = result.stdout || '';
  if (echo && stdout.trim()) say(stdout.trimEnd());

  return { status: result.status, stdout, stderr: result.stderr || '' };
}

/**
 * Pull `DB_PASSWORD_*_SERVICE=…` out of db-grants' output and into `.env`.
 *
 * Only keys that ALREADY exist in the file are updated — a value db-grants
 * suggests for a service this deployment has not adopted is a suggestion, not a
 * change somebody asked for.
 */
function writeRotatedPasswords(output) {
  const pairs = [...output.matchAll(/^(DB_(?:USER|PASSWORD)_[A-Z]+_SERVICE)=(.+)$/gm)];
  if (!pairs.length) return [];

  let text = fs.readFileSync(ENV_FILE, 'utf8');
  const written = [];

  for (const [, key, value] of pairs) {
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    if (!pattern.test(text)) continue;

    const next = text.replace(pattern, `${key}=${value.trim()}`);
    if (next !== text) {
      text = next;
      if (key.startsWith('DB_PASSWORD')) written.push(key);
    }
  }

  if (written.length) {
    fs.writeFileSync(ENV_FILE, text, { mode: 0o600 });
    // The child processes started after this point read `.env` themselves, but
    // this process's own env is now stale — and `--fresh` uses it.
    for (const [, key, value] of pairs) process.env[key] = value.trim();
  }

  return written;
}

// ══════════════════════════════════════════════════════════════════════════
//  Step 5 — data
// ══════════════════════════════════════════════════════════════════════════

function seedData() {
  step('Loading data');

  if (args.skipDb || args.noData) {
    info(args.noData ? 'skipped (--no-data)' : 'skipped (--skip-db)');
    return;
  }

  const runnerArgs = [path.join('scripts', 'seed-data.js')];
  if (args.demo) runnerArgs.push('--demo');

  say('');
  run(process.execPath, runnerArgs, { label: 'The data runner' });
}

// ══════════════════════════════════════════════════════════════════════════
//  Step 6 — verification
// ══════════════════════════════════════════════════════════════════════════

function verify() {
  step('Verifying the schema');

  if (args.skipDb) {
    info('skipped (--skip-db)');
    return;
  }

  say('');

  // Not fatal. `db:verify` compares 163 models against the live schema and a
  // mismatch is worth knowing about, but it is a report — the platform runs.
  if (!dbCliSoft('verify')) {
    warn('Some models do not match the database. The list is above; the platform will still start.');
  } else {
    ok('every model matches the database');
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  Summary
// ══════════════════════════════════════════════════════════════════════════

function summary({ placeholders }) {
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const line = '─'.repeat(70);

  say(`\n${green(line)}`);
  say(`${green(bold('  Setup complete'))} ${dim(`(${seconds}s)`)}`);
  say(`${green(line)}\n`);

  say(bold('  Start the platform'));
  say(`    ${cyan('npm run dev')}          ${dim('gateway + all four services + the sports worker')}`);
  say('');
  say(bold('  Then'));
  say(`    ${cyan('curl localhost:4000/health')}     ${dim('aggregated platform health')}`);
  say(`    ${cyan('curl localhost:4000/api/v1')}     ${dim('endpoint index')}`);
  say('');

  say(bold('  Admin login'));
  say(`    ${dim('POST')} http://127.0.0.1:4000/api/v1/admin/auth/login  ${dim('{"email","password"}')}`);
  say(`    Email     ${process.env.SEED_ADMIN_EMAIL || 'admin@ibitplay.local'}`);
  say(`    Password  ${process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!2026'}`);
  say('');
  say(bold('  Player login'));
  say(`    ${dim('POST')} http://127.0.0.1:4000/api/v1/user/auth/login   ${dim('{"identifier","password"}')}`);
  say('');

  if (args.demo) {
    say(bold('  Demo accounts'));
    say(`    ${dim('Printed by the data runner above — staff tree and players, one shared password.')}`);
    say('');
  }

  say(bold('  Useful'));
  say(`    ${cyan('npm run db:status')}            ${dim('what is applied and what is pending')}`);
  say(`    ${cyan('npm run db:seed:data')}         ${dim('re-run platform config seeds')}`);
  say(`    ${cyan('npm run db:seed:demo')}         ${dim('load the demo dataset')}`);
  say(`    ${cyan('node scripts/setup.js --fresh')} ${dim('rebuild from nothing')}`);
  say('');

  if (placeholders.length) {
    say(`${yellow(line)}`);
    say(yellow(bold('  Before this is useful for real, replace these placeholders in .env')));
    for (const item of placeholders) say(`    ${yellow('•')} ${bold(item.key)} — ${item.note}`);
    say(`\n  ${dim('Everything else works without them; the sports board will be empty until the feed is real.')}`);
    say(`${yellow(line)}\n`);
  }

  if ((process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!2026') === 'ChangeMe!2026') {
    warn('The super-admin still has the default password. Change it before anyone else can reach this box.');
    say('');
  }
}

// ══════════════════════════════════════════════════════════════════════════

async function main() {
  say(`\n${bold('iBitPlay backend — setup')}`);
  say(dim(`${ROOT}\n`));

  preflight();
  const env = await configureEnv();
  install();
  await buildDatabase();
  seedData();
  verify();

  rl?.close();
  summary(env);
}

main().catch((error) => {
  rl?.close();
  fail(error.message, error.stack ? dim(error.stack.split('\n').slice(1, 4).join('\n')) : undefined);
});
