#!/usr/bin/env node
'use strict';

const path = require('path');
const { loadEnv, dbEnvShape, createLogger } = require('@ibitplay/common');
const { connect } = require('@ibitplay/db');
const { verifyPassword } = require('@ibitplay/auth');

async function main() {
  const config = loadEnv({ ...dbEnvShape }, { serviceDir: path.resolve(__dirname, '..') });
  const logger = createLogger({ level: 'error' });
  const { sequelize, models } = await connect(config, { logger });

  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@ibitplay.local').toLowerCase();
  const staff = await models.Staff.findOne({ where: { email }, raw: true });

  if (!staff) {
    console.log(`No staff row for ${email} on database "${config.DB_NAME}".`);
    const sample = await models.Staff.findAll({
      attributes: ['id', 'email', 'name', 'status', 'first_login', 'two_fa_enabled'],
      limit: 8,
      order: [['id', 'ASC']],
      raw: true,
    });
    console.log('Sample staff accounts:', JSON.stringify(sample, null, 2));
    await sequelize.close();
    return;
  }

  const candidates = [
    process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!2026',
    'ChangeMe!2026',
    // The demo player password is not hard-coded: set DEMO_PASSWORD to also test it.
    ...(process.env.DEMO_PASSWORD ? [process.env.DEMO_PASSWORD] : []),
    'Test1234!Pass',
  ];
  const passwordMatches = {};
  for (const p of [...new Set(candidates)]) {
    passwordMatches[p] = await verifyPassword(p, staff.password || '');
  }

  console.log(
    JSON.stringify(
      {
        database: config.DB_NAME,
        email: staff.email,
        name: staff.name,
        status: staff.status,
        first_login: staff.first_login,
        two_fa_enabled: staff.two_fa_enabled,
        passwordMatches,
      },
      null,
      2
    )
  );

  await sequelize.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
