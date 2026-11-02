#!/usr/bin/env node
'use strict';

/**
 * Remove the QA testers' data: every player and staff account whose name or email starts with
 * `qa` (any case), with everything hanging off it (same table list and order as the demo reset,
 * scripts/lib/demo-reset.js), plus QA gift cards and QA bank details.
 *
 *   node scripts/reset-qa-data.js         dry run: counts only, nothing deleted
 *   node scripts/reset-qa-data.js --yes   delete, in one transaction
 *
 * Back up first (pg_dump). Refuses if a non-QA player or staff account sits under a QA staff.
 */

const { connect } = require('@ibitplay/db');
const { loadEnv, coercers, dbEnvShape, createLogger } = require('@ibitplay/common');
const { resetDemo } = require('./lib/demo-reset');

const QA_MATCH = "ILIKE 'qa%'";

async function main() {
  const apply = process.argv.includes('--yes');
  const config = loadEnv({ ...dbEnvShape, NODE_ENV: coercers.str('development') }, { serviceDir: process.cwd() });
  const logger = createLogger({ name: 'reset-qa-data', level: 'error' });
  const db = await connect({ config, logger, service: 'admin-service' });
  const { sequelize } = db;
  try {
    console.log(`database ${config.DB_NAME} — ${apply ? 'DELETING' : 'dry run'}`);
    const out = await resetDemo({ sequelize, apply, logger, match: QA_MATCH });
    console.log(`QA players: ${out.users.length}, QA staff: ${out.staff.length}`);
    if (out.blocked.length) {
      console.log(`refused: ${out.blocked.join('; ')}`);
      process.exitCode = 1;
      return;
    }
    for (const s of out.steps) console.log(`  ${s.label}: ${s.count}`);

    // Content the testers created that is not keyed on an account.
    for (const [label, sql] of [
      ['gift cards (QA keys)', "FROM gift_cards WHERE unique_key ILIKE 'qa%'"],
      ['bank details (QA holders)', "FROM currency_payment_details WHERE account_holder_name ILIKE 'qa%'"],
    ]) {
      try {
        const [{ n }] = await sequelize.query(`SELECT COUNT(*)::int AS n ${sql}`, { type: 'SELECT' });
        if (n && apply) await sequelize.query(`DELETE ${sql}`);
        if (n) console.log(`  ${label}: ${n}`);
      } catch (error) {
        console.log(`  ${label}: skipped (${error.message.split('\n')[0]})`);
      }
    }
    if (!apply) console.log('dry run only — add --yes to delete');
  } finally {
    await sequelize.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
