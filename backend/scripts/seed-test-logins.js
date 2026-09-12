#!/usr/bin/env node
'use strict';

/**
 * Give a handful of restored accounts KNOWN passwords, so the two frontends can
 * actually be signed into against real data.
 *
 *   node scripts/seed-test-logins.js
 *   node scripts/seed-test-logins.js --password 'some-other-password'
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────
 *
 * `db_backups/` restores a real hierarchy — 17 staff across five roles, 84
 * players with balances, 963 sports bets, 2,818 casino games. What it does not
 * restore is anybody's plaintext password: the dump carries bcrypt hashes, and
 * that is the whole point of them.
 *
 * So this rewrites the hash on a chosen few. It goes through the platform's own
 * `hashPassword`, at the platform's own cost factor, so the rows it writes are
 * indistinguishable from ones the application would have written — a seed that
 * produces a hash the login path then rejects is worse than no seed at all.
 *
 * ── IT REFUSES TO RUN AGAINST ANYTHING THAT LOOKS LIVE ──────────────────
 *
 * The whole file is a password reset on accounts somebody may be using. The
 * guard below is deliberately blunt: the database name must contain `test`,
 * `restore`, `dev` or `local`. Point it at `ibitplay` proper and it stops.
 */

const path = require('path');

const { hashPassword } = require('@ibitplay/auth');
const { connect } = require('@ibitplay/db');
const { loadEnv, coercers, dbEnvShape, createLogger } = require('@ibitplay/common');

/** Long enough to satisfy the 10-character floor the platform enforces. */
const DEFAULT_PASSWORD = 'Test1234!Pass';

/** Database names this may touch. Anything else is assumed to be real. */
const ALLOWED_NAME = /(test|restore|dev|local|sandbox|staging)/i;

/**
 * Who gets a known password.
 *
 * One per staff role, so the panel's permission differences are exercisable
 * rather than only testable as the owner — most of what goes wrong in an RBAC
 * surface goes wrong for somebody who is NOT the superadmin.
 */
const STAFF_TARGETS = ['Super Admin', 'agent001', 'agent002', 'subagent001', 'Arjun'];

function parseArgs(argv) {
  const args = { password: DEFAULT_PASSWORD, players: 3 };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--password') args.password = argv[i + 1];
    if (argv[i] === '--players') args.players = Number(argv[i + 1]) || 3;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const logger = createLogger({ name: 'seed-test-logins', pretty: true });

  const config = loadEnv({ ...dbEnvShape, NODE_ENV: coercers.str('development') }, {
    serviceDir: path.resolve(__dirname, '..'),
  });

  if (!ALLOWED_NAME.test(config.DB_NAME)) {
    logger.error(
      { database: config.DB_NAME },
      'Refusing to run: this rewrites passwords, and the database name does not look like a test or restored copy'
    );
    process.exit(1);
  }

  // Raw SQL only, so the model registry is irrelevant — but `connect` insists
  // on one. `core` is the domain `users` and `staff` live in.
  const db = await connect({ config, logger, domains: ['core', 'admin'] });

  const password = args.password;
  const hash = await hashPassword(password);

  const results = { staff: [], players: [] };

  // ── staff ─────────────────────────────────────────────────────────────
  for (const name of STAFF_TARGETS) {
    const [rows] = await db.sequelize.query(
      `UPDATE staff
          SET password = :hash,
              password2 = '',
              first_login = false,
              status = 'active'
        WHERE name = :name
        RETURNING id, name, email, role_id`,
      { replacements: { hash, name } }
    );
    if (rows.length) results.staff.push(rows[0]);
    else logger.warn({ name }, 'No staff row with that name — skipped');
  }

  /**
   * `transaction_password` is a SECOND factor on every money-moving admin
   * write — a transfer, a refill, a password reset. Without one seeded, those
   * screens cannot be exercised at all.
   */
  await db.sequelize.query(
    `UPDATE staff SET transaction_password = :hash WHERE name IN (:names)`,
    { replacements: { hash, names: STAFF_TARGETS } }
  );

  // ── players ───────────────────────────────────────────────────────────
  //
  // The ones with a balance, because a player with nothing to bet exercises
  // very little of the app.
  const [players] = await db.sequelize.query(
    `SELECT u.id, u.name, u.email
       FROM users u
       JOIN credits c ON c.uid = u.id
      WHERE u.status = 'active' OR u.status IS NULL
      ORDER BY COALESCE(c.inr, 0) DESC
      LIMIT :limit`,
    { replacements: { limit: args.players } }
  );

  for (const player of players) {
    await db.sequelize.query(
      `UPDATE users
          SET password = :hash,
              password2 = '',
              two_fa_status = false
        WHERE id = :id`,
      { replacements: { hash, id: player.id } }
    );
    results.players.push(player);
  }

  // ── report ────────────────────────────────────────────────────────────
  const line = '─'.repeat(70);
  console.log(`\n${line}\nTest logins seeded on "${config.DB_NAME}"\n${line}`);
  console.log(`\nPassword for every account below:  ${password}\n`);

  console.log('STAFF — sign in at the admin panel');
  for (const s of results.staff) {
    console.log(`  ${String(s.name).padEnd(14)} ${s.email ?? '(no email)'}`);
  }
  console.log(`\n  Transaction password (money-moving writes): ${password}`);

  console.log('\nPLAYERS — sign in at the Addaplay front end');
  for (const p of results.players) {
    console.log(`  ${String(p.name).padEnd(14)} ${p.email ?? '(no email)'}`);
  }

  console.log(
    '\nThe login form takes a username, an email or a phone number in one field.\n'
  );

  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
