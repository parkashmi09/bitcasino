#!/usr/bin/env node
'use strict';

/**
 * Set a known password on a staff account (local / dev databases only).
 *
 *   node scripts/reset-staff-password.js
 *   node scripts/reset-staff-password.js --email admin@ibitplay.local --password 'ChangeMe!2026'
 */

const path = require('path');
const { hashPassword } = require('@ibitplay/auth');
const { connect } = require('@ibitplay/db');
const { loadEnv, coercers, dbEnvShape, createLogger } = require('@ibitplay/common');

const ALLOWED_NAME = /(test|restore|dev|local|sandbox|staging|shuffle)/i;
const DEFAULT_EMAIL = 'admin@ibitplay.local';
const DEFAULT_PASSWORD = 'ChangeMe!2026';

function parseArgs(argv) {
  const args = { email: DEFAULT_EMAIL, password: DEFAULT_PASSWORD };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--email') args.email = String(argv[i + 1] || '').toLowerCase();
    if (argv[i] === '--password') args.password = String(argv[i + 1] || '');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.password || args.password.length < 10) {
    console.error('Password must be at least 10 characters (platform rule).');
    process.exit(1);
  }

  const logger = createLogger({ name: 'reset-staff-password', pretty: true });
  const config = loadEnv(
    { ...dbEnvShape, NODE_ENV: coercers.str('development') },
    { serviceDir: path.resolve(__dirname, '..') }
  );

  if (!ALLOWED_NAME.test(config.DB_NAME)) {
    logger.error(
      { database: config.DB_NAME },
      'Refusing to run: database name does not look like a dev copy'
    );
    process.exit(1);
  }

  const db = await connect({ config, logger, domains: ['admin'] });
  const staff = await db.models.Staff.findOne({ where: { email: args.email }, raw: true });
  if (!staff) {
    logger.error({ email: args.email }, 'No staff row with that email');
    process.exit(1);
  }

  const hash = await hashPassword(args.password, Number(process.env.BCRYPT_ROUNDS || 12));
  await db.models.Staff.update(
    { password: hash, first_login: false },
    { where: { id: staff.id } }
  );

  logger.info(
    { staffId: staff.id, email: args.email, database: config.DB_NAME },
    'Staff password updated — sign in with POST /api/v1/admin/auth/login'
  );

  await db.sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
