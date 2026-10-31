'use strict';

/**
 * The demo credentials file — the ONLY place a demo password is ever written.
 *
 *   backend/.demo-credentials.local.md      (gitignored — backend/.gitignore)
 *
 * ── WHY A FILE AND NOT THE TERMINAL ──────────────────────────────────────
 *
 * The data runner used to print one shared password for every demo account.
 * Terminal output ends up in CI logs, screen shares and pasted bug reports;
 * a password that is the same on every developer's database is a password
 * for every one of them. Each demo account now gets its own random password,
 * the terminal only says how many accounts were made and where this file is,
 * and the file is mode 0600 and never committed.
 *
 * ── RE-RUNS NEVER ROTATE ─────────────────────────────────────────────────
 *
 * A password is generated only when its account is CREATED. A re-run finds
 * the account, leaves its hash alone, and adds nothing here — so the row from
 * the first run stays true. New accounts are appended.
 *
 * Rows carry the database they belong to, because one checkout seeds more
 * than one database (the dev DB, `ibitplay_test`). `--reset-demo --yes`
 * removes only the rows of the database it reset.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_FILE = path.join(ROOT, '.demo-credentials.local.md');

/** Where the file lives; `DEMO_CREDENTIALS_FILE` moves it (the test writes to a temp dir). */
const credentialsPath = () => process.env.DEMO_CREDENTIALS_FILE || DEFAULT_FILE;

const HEADER = `# Demo credentials (LOCAL ONLY)

Written by \`node scripts/seed-data.js --demo\`. Gitignored (\`backend/.gitignore\`) — never commit,
paste or share this file. Every account is \`demo_\`-prefixed and is removed by
\`node scripts/seed-data.js --reset-demo --yes\` (which also removes its rows here).

- **Staff** sign in to the site admin with the email + password. The transaction password is what
  the admin asks for before a transfer or a setting change.
- **Players** sign in to the site with the username (or email) + password.

| db | kind | login | email | password | role | transaction password | note |
|---|---|---|---|---|---|---|---|
`;

const SYMBOLS = '!@#$%^*-_+=';
const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** One random character from `alphabet`, from `crypto`. */
const pick = (alphabet) => alphabet[crypto.randomInt(0, alphabet.length)];

/**
 * A random password every validator on the platform accepts: 18 characters with
 * at least one upper, lower, digit and symbol, no look-alike characters, and no
 * `|` (it would break the markdown table it is written into).
 */
function generatePassword(length = 18) {
  const required = [
    pick('ABCDEFGHJKLMNPQRSTUVWXYZ'),
    pick('abcdefghijkmnopqrstuvwxyz'),
    pick('23456789'),
    pick(SYMBOLS),
  ];
  const rest = Array.from({ length: length - required.length }, () => pick(ALNUM + SYMBOLS));
  const chars = [...required, ...rest];
  // Fisher–Yates with crypto, so the required classes are not always first.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const cell = (value) => String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/**
 * A buffer of accounts created by one dataset. Rows are only written once the
 * dataset's writes have committed (`flush`) — a rolled-back dataset discards
 * its buffer (`discard`), so the file never lists an account that does not exist.
 */
function createCredentialsBook({ dbLabel }) {
  let pending = [];
  let written = 0;

  return {
    /** Record a NEW account. Never call this for an account that already existed. */
    add({ kind, login, email = '', password, role = '', transactionPassword = '', note = '' }) {
      pending.push({ kind, login, email, password, role, transactionPassword, note });
    },

    get pendingCount() {
      return pending.length;
    },

    get written() {
      return written;
    },

    discard() {
      pending = [];
    },

    /** Append the buffered rows (creating the file, mode 0600, on first use). */
    flush() {
      if (!pending.length) return 0;
      const file = credentialsPath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      if (!fs.existsSync(file)) fs.writeFileSync(file, HEADER, { mode: 0o600 });
      const lines = pending.map((r) =>
        `| ${cell(dbLabel)} | ${cell(r.kind)} | ${cell(r.login)} | ${cell(r.email)} | ${cell(r.password)} | ${cell(r.role)} | ${cell(r.transactionPassword)} | ${cell(r.note)} |\n`
      );
      fs.appendFileSync(file, lines.join(''), { mode: 0o600 });
      try {
        fs.chmodSync(file, 0o600);
      } catch {
        /* best effort on filesystems without modes */
      }
      const count = pending.length;
      written += count;
      pending = [];
      return count;
    },
  };
}

/**
 * Remove every row that belongs to `dbLabel` (after a reset of that database).
 * Rows of other databases are kept. Returns how many rows were removed.
 */
function removeRowsFor(dbLabel) {
  const file = credentialsPath();
  if (!fs.existsSync(file)) return 0;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const prefix = `| ${cell(dbLabel)} |`;
  const kept = lines.filter((line) => !line.startsWith(prefix));
  const removed = lines.length - kept.length;
  if (removed) fs.writeFileSync(file, kept.join('\n'), { mode: 0o600 });
  return removed;
}

/**
 * The transaction password recorded for a staff login on `dbLabel`, or null.
 *
 * Used for one thing: funding a NEW agent-tree player under an agent created
 * by an earlier run (LordsService requires the agent's transaction password,
 * and the seed never rotates it). Read from this file — the seed's own output.
 */
function lookupTransactionPassword(dbLabel, login) {
  const file = credentialsPath();
  if (!login || !fs.existsSync(file)) return null;
  const prefix = `| ${cell(dbLabel)} | staff | ${cell(login)} |`;
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith(prefix));
  if (!line) return null;
  // | db | kind | login | email | password | role | transaction password | note |
  const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((v) => v.trim().replace(/\\\|/g, '|'));
  return cells[6] || null;
}

/**
 * The sign-in password recorded for a demo account (`login` is its username or
 * email), for scripts that sign in as it — `verify-*.mjs`, the hub's `e2e.mjs`.
 *
 * `db` (or `DEMO_CREDENTIALS_DB`) narrows the rows to one database: a DB name
 * (`bc_games`) or a full `db@host:port` label. Without it the account must be
 * unambiguous — one checkout can seed several databases, each with its own
 * random password.
 *
 * Throws, with a message that never contains a password, when the file or the
 * account is missing. Callers must never print the value either.
 */
function lookupPassword(login, { db = process.env.DEMO_CREDENTIALS_DB } = {}) {
  const file = credentialsPath();
  const reseed = 'run node scripts/seed-data.js --demo first';
  if (!fs.existsSync(file)) {
    throw new Error(`Demo credentials file not found (${file}) — ${reseed}.`);
  }
  // | db | kind | login | email | password | role | transaction password | note |
  const rows = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| db |') && !line.startsWith('|---'))
    .map((line) => line.split(/(?<!\\)\|/).slice(1, -1).map((v) => v.trim().replace(/\\\|/g, '|')))
    .filter((c) => c.length >= 5 && (c[2] === login || (c[3] && c[3] === login)))
    .filter((c) => !db || c[0] === db || c[0].startsWith(`${db}@`));
  const scope = db ? ` for database ${db}` : '';
  if (!rows.length || !rows[0][4]) {
    throw new Error(`Demo account "${login}" is not in ${file}${scope} — ${reseed}.`);
  }
  const distinct = new Set(rows.map((c) => c[4]));
  if (distinct.size > 1) {
    const labels = [...new Set(rows.map((c) => c[0]))].join(', ');
    throw new Error(
      `Demo account "${login}" is listed for more than one database (${labels}) — set DEMO_CREDENTIALS_DB to the one this script talks to.`
    );
  }
  return rows[0][4];
}

/** `db@host` — the label rows are filed under. */
const dbLabelOf = (config) => `${config.DB_NAME}@${config.DB_HOST}:${config.DB_PORT}`;

module.exports = {
  credentialsPath,
  createCredentialsBook,
  generatePassword,
  removeRowsFor,
  lookupTransactionPassword,
  lookupPassword,
  dbLabelOf,
  DEFAULT_FILE,
};
