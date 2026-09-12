#!/usr/bin/env node
'use strict';

/**
 * Database CLI.
 *
 *   node src/cli.js migrate          apply pending migrations
 *   node src/cli.js migrate:undo     revert the last migration
 *   node src/cli.js status           show applied vs pending
 *   node src/cli.js seed             run pending seeders
 *   node src/cli.js seed:undo        revert the last seeder
 *   node src/cli.js verify           check every model against the real schema
 *   node src/cli.js create           create the database if it does not exist
 *
 * Run from the repo root as `npm run db:migrate`.
 */

const { loadEnv, dbEnvShape, coercers, createLogger } = require('@ibitplay/common');
const { createSequelize, authenticate } = require('./sequelize');
const { registerModels } = require('./models');
const { createMigrator } = require('./migrator');

const config = loadEnv({
  ...dbEnvShape,
  SEED_ADMIN_USERNAME: coercers.str('superadmin'),
  SEED_ADMIN_EMAIL: coercers.str('admin@ibitplay.local'),
  SEED_ADMIN_PASSWORD: coercers.str('ChangeMe!2026'),
  SEED_DEMO_DATA: coercers.bool(false),
  BCRYPT_ROUNDS: coercers.int(12),
  LOG_PRETTY: coercers.bool(true),
});

const logger = createLogger({ service: 'db-cli', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY });

/** Connect to the maintenance database so we can CREATE DATABASE. */
async function createDatabase() {
  const { Client } = require('pg');
  const client = new Client({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD || undefined,
    database: 'postgres',
  });

  await client.connect();
  try {
    const { rows } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.DB_NAME]);
    if (rows.length) {
      logger.info(`Database "${config.DB_NAME}" already exists`);
      return;
    }
    // Identifiers cannot be parameterised; the name comes from our own env and
    // is quoted to keep it a single identifier regardless of content.
    await client.query(`CREATE DATABASE "${config.DB_NAME.replace(/"/g, '""')}"`);
    logger.info(`Created database "${config.DB_NAME}"`);
  } finally {
    await client.end();
  }
}

/**
 * Compare every model's attributes against the live schema.
 *
 * This is the check that catches the failure mode nobody notices until
 * production: a model that names a column the database does not have. Sequelize
 * happily builds the SELECT and Postgres rejects it at runtime.
 */
async function verify(sequelize) {
  const models = registerModels(sequelize, { logger });
  const queryInterface = sequelize.getQueryInterface();

  const problems = [];
  let checked = 0;

  for (const [name, model] of Object.entries(models)) {
    if (typeof model?.getTableName !== 'function') continue;
    checked += 1;

    let describe;
    try {
      describe = await queryInterface.describeTable(model.getTableName());
    } catch {
      problems.push({ model: name, issue: 'table missing from database', table: model.tableName });
      continue;
    }

    const dbColumns = new Set(Object.keys(describe));
    for (const [attribute, definition] of Object.entries(model.rawAttributes)) {
      const column = definition.field || attribute;
      if (!dbColumns.has(column)) {
        problems.push({ model: name, table: model.tableName, issue: `column "${column}" not in database` });
      }
    }
  }

  if (problems.length) {
    logger.error({ problems }, `Schema verification failed: ${problems.length} problem(s) across ${checked} models`);
    for (const p of problems) logger.error(`  ${p.model} (${p.table}): ${p.issue}`);
    process.exitCode = 1;
    return;
  }

  logger.info(`Schema verification passed — ${checked} models match the database`);
}

async function main() {
  const command = process.argv[2] || 'status';

  if (command === 'create') {
    await createDatabase();
    return;
  }

  const sequelize = createSequelize(config, logger);
  await authenticate(sequelize, logger);

  const { migrations, seeders } = createMigrator({ sequelize, logger });

  try {
    switch (command) {
      case 'migrate': {
        const applied = await migrations.up();
        logger.info(applied.length ? `Applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(', ')}` : 'No pending migrations');
        break;
      }
      case 'migrate:undo': {
        const reverted = await migrations.down();
        logger.info(reverted.length ? `Reverted: ${reverted.map((m) => m.name).join(', ')}` : 'Nothing to revert');
        break;
      }
      case 'seed': {
        const applied = await seeders.up();
        logger.info(applied.length ? `Ran ${applied.length} seeder(s): ${applied.map((m) => m.name).join(', ')}` : 'No pending seeders');
        break;
      }
      case 'seed:undo': {
        const reverted = await seeders.down();
        logger.info(reverted.length ? `Reverted: ${reverted.map((m) => m.name).join(', ')}` : 'Nothing to revert');
        break;
      }
      case 'verify':
        await verify(sequelize);
        break;
      case 'status': {
        const [pendingMigrations, executedMigrations, pendingSeeders] = await Promise.all([
          migrations.pending(),
          migrations.executed(),
          seeders.pending(),
        ]);
        logger.info(`Migrations — applied: ${executedMigrations.length}, pending: ${pendingMigrations.length}`);
        for (const m of executedMigrations) logger.info(`  [x] ${m.name}`);
        for (const m of pendingMigrations) logger.info(`  [ ] ${m.name}`);
        logger.info(`Seeders — pending: ${pendingSeeders.length}`);
        for (const s of pendingSeeders) logger.info(`  [ ] ${s.name}`);
        break;
      }
      default:
        logger.error(`Unknown command "${command}". Try: create | migrate | migrate:undo | status | seed | seed:undo | verify`);
        process.exitCode = 1;
    }
  } finally {
    await sequelize.close();
  }
}

main().catch((error) => {
  // Umzug attaches the whole migration context to the error; dumping it produces
  // pages of noise that bury the one line that matters.
  const cause = error?.cause || error?.parent || error?.original;
  logger.fatal(`Database command failed: ${error.message}`);
  if (cause?.message && cause.message !== error.message) logger.fatal(`  caused by: ${cause.message}`);
  if (cause?.sql) logger.fatal(`  sql: ${String(cause.sql).slice(0, 300)}`);
  process.exit(1);
});
