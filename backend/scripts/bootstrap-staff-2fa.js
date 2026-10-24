#!/usr/bin/env node
'use strict';

/**
 * Enable TOTP for a staff account that cannot sign in yet (senior roles require
 * 2FA before a session is issued). Use on local / dev databases only.
 *
 *   node scripts/bootstrap-staff-2fa.js
 *   node scripts/bootstrap-staff-2fa.js --email admin@ibitplay.local
 *   node scripts/bootstrap-staff-2fa.js --secret JBSWY3DPEHPK3PXP
 *
 * Prints the base32 secret and a one-time otpauth URL. Add the secret to any
 * authenticator app, then sign in with email + password + the current 6-digit code.
 */

const path = require('path');
const speakeasy = require('speakeasy');

const {
  loadEnv,
  coercers,
  dbEnvShape,
  secretEncryptionEnvShape,
  jwtEnvShape,
  adminJwtEnvShape,
  createLogger,
} = require('@ibitplay/common');
const { createSecretBox, totp } = require('@ibitplay/auth');
const { connect } = require('@ibitplay/db');

const DEFAULT_EMAIL = 'admin@ibitplay.local';
const DEFAULT_SECRET = 'JBSWY3DPEHPK3PXP';

const ALLOWED_NAME = /(test|restore|dev|local|sandbox|staging|shuffle)/i;

function parseArgs(argv) {
  const args = { email: DEFAULT_EMAIL, secret: DEFAULT_SECRET };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--email') args.email = String(argv[i + 1] || '').toLowerCase();
    if (argv[i] === '--secret') args.secret = String(argv[i + 1] || '').replace(/\s/g, '');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const logger = createLogger({ name: 'bootstrap-staff-2fa', pretty: true });

  const config = loadEnv(
    {
      ...dbEnvShape,
      ...secretEncryptionEnvShape,
      ...jwtEnvShape,
      ...adminJwtEnvShape,
      NODE_ENV: coercers.str('development'),
    },
    { serviceDir: path.resolve(__dirname, '..') }
  );

  if (!ALLOWED_NAME.test(config.DB_NAME)) {
    logger.error(
      { database: config.DB_NAME },
      'Refusing to run: database name does not look like a dev copy (rename or pass a safer DB)'
    );
    process.exit(1);
  }

  const db = await connect({ config, logger, domains: ['admin'] });
  const staff = await db.models.Staff.findOne({ where: { email: args.email }, raw: true });
  if (!staff) {
    logger.error({ email: args.email }, 'No staff row with that email');
    process.exit(1);
  }

  const secrets = createSecretBox({ config, logger });

  if (staff.two_fa_enabled) {
    logger.info({ staffId: staff.id, email: args.email }, '2FA is already enabled on this account');
    await db.sequelize.close();
    return;
  }

  const label = staff.email || `staff-${staff.id}`;
  const otpauthUrl = speakeasy.otpauthURL({
    secret: args.secret,
    label,
    issuer: 'iBitPlay Admin',
    encoding: 'base32',
  });

  const code = speakeasy.totp({ secret: args.secret, encoding: 'base32' });
  const result = totp.verifyCodeOnce({ secret: args.secret, code, lastUsedStep: null });
  if (!result.valid) {
    logger.error('Generated TOTP code did not verify — retry in a few seconds');
    process.exit(1);
  }

  await db.models.Staff.update(
    {
      two_fa_enabled: true,
      two_fa_secret: secrets.seal(args.secret),
      two_fa_last_step: result.step,
      two_fa_enrolled_at: new Date(),
    },
    { where: { id: staff.id } }
  );

  logger.info(
    {
      staffId: staff.id,
      email: args.email,
      secret: args.secret,
      otpauthUrl,
      currentCode: speakeasy.totp({ secret: args.secret, encoding: 'base32' }),
    },
    'Staff 2FA enabled — add the secret to your authenticator, then sign in with password + 6-digit code'
  );

  await db.sequelize.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
