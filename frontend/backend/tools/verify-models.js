#!/usr/bin/env node
'use strict';

/**
 * Diff every Sequelize model against the real database schema.
 *
 *   DB_NAME=ibitplay_test node tools/verify-models.js
 *
 * Two failure modes this catches, both silent and both expensive:
 *
 *   MISSING IN MODEL   the table has a column the model does not declare.
 *                      Sequelize simply never reads or writes it — an INSERT
 *                      succeeds and the column is left null. `vault_pro` was
 *                      found this way: the model declared `userid` and `coin`
 *                      but not `vaultBalance`, so a vault deposit would have
 *                      recorded no balance at all.
 *
 *   MISSING IN DB      the model declares a column the table does not have.
 *                      Every query touching it errors at runtime.
 *
 * The generator reads `000_baseline_schema.sql`; anything applied to the
 * database outside that file drifts, and quoted camelCase columns were dropped
 * by the parser.
 */

const { loadEnv, dbEnvShape, createLogger } = require('@ibitplay/common');
const { createSequelize, authenticate } = require('@ibitplay/db/src/sequelize');
const { registerModels } = require('@ibitplay/db/src/models');

const config = loadEnv({ ...dbEnvShape });
const logger = createLogger({ name: 'verify-models', level: 'silent' });

/**
 * Tables that legitimately have no model.
 *
 * Migration bookkeeping is owned by the migrator, not by application code.
 * Anything else appearing in the orphan list is a gap, not an exemption —
 * add a model rather than adding a name here.
 */
const IGNORED_TABLES = new Set(['sequelize_meta', 'SequelizeMeta', 'migrations', 'schema_migrations']);

/**
 * Views are not tables and have no business being models — they are derived,
 * read-only, and their definition lives in SQL. `information_schema.columns`
 * lists them alongside tables, so they are excluded by name prefix rather than
 * being enumerated one by one.
 */
const isView = (name) => name.startsWith('v_');

async function main() {
  const sequelize = createSequelize(config, logger);
  await authenticate(sequelize, logger);

  const models = registerModels(sequelize, { logger });

  const columns = await sequelize.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = :schema`,
    { replacements: { schema: config.DB_SCHEMA || 'public' }, type: sequelize.QueryTypes.SELECT }
  );

  const byTable = new Map();
  for (const { table_name: table, column_name: column } of columns) {
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table).add(column);
  }

  const problems = [];
  let checked = 0;

  for (const [name, model] of Object.entries(models)) {
    if (typeof model?.getTableName !== 'function') continue;

    const table = typeof model.getTableName() === 'string'
      ? model.getTableName()
      : model.getTableName().tableName;

    const actual = byTable.get(table);
    if (!actual) {
      problems.push({ model: name, table, kind: 'TABLE MISSING', detail: 'no such table in the database' });
      continue;
    }

    checked += 1;

    const declared = new Set(
      Object.values(model.rawAttributes).map((a) => a.field || a.fieldName)
    );

    const missingInModel = [...actual].filter((c) => !declared.has(c));
    const missingInDb = [...declared].filter((c) => !actual.has(c));

    if (missingInModel.length) {
      problems.push({ model: name, table, kind: 'MISSING IN MODEL', detail: missingInModel.join(', ') });
    }
    if (missingInDb.length) {
      problems.push({ model: name, table, kind: 'MISSING IN DB', detail: missingInDb.join(', ') });
    }
  }

  /**
   * Tables nothing maps to.
   *
   * This check exists because the tool passed while it was silently missing
   * five of them. `bonus_history` is a real table with live rows and no model —
   * the generator normalises table names to PascalCase, so `bonus_history` and
   * `bonushistory` both want to be `BonusHistory`, and the second silently won.
   *
   * A model that does not match its table is loud. A table with NO model is
   * quiet: the code that needs it simply reaches for raw SQL instead, which is
   * exactly what this port is trying to stop.
   *
   * Reported as a warning rather than a failure — some tables genuinely have no
   * business being an ORM model (migration bookkeeping, provider response
   * caches) — but reported every time, by name.
   */
  // `models` holds a few non-model exports (helpers, the sequelize instance),
  // which is why the loop above guards on `getTableName` too.
  const mapped = new Set(
    Object.values(models)
      .filter((m) => typeof m?.getTableName === 'function')
      .map((m) => (typeof m.getTableName() === 'string' ? m.getTableName() : m.getTableName().tableName))
  );
  const orphans = [...byTable.keys()].filter((t) => !mapped.has(t) && !IGNORED_TABLES.has(t) && !isView(t)).sort();

  console.log(`Checked ${checked} model(s) against ${byTable.size} table(s) in "${config.DB_NAME}"\n`);

  if (orphans.length) {
    console.log(`TABLES WITH NO MODEL  (${orphans.length})`);
    console.log('─'.repeat(70));
    for (const table of orphans) {
      console.log(`  ${table.padEnd(40)} nothing maps to this table`);
    }
    console.log('');
  }

  if (!problems.length) {
    console.log(orphans.length ? 'Every model matches its table.' : 'Every model matches the database.');
  } else {
    const grouped = {};
    for (const p of problems) (grouped[p.kind] ??= []).push(p);

    for (const [kind, list] of Object.entries(grouped)) {
      console.log(`\n${kind}  (${list.length})`);
      console.log('─'.repeat(70));
      for (const p of list) {
        console.log(`  ${p.model.padEnd(28)} ${p.table.padEnd(28)} ${p.detail}`);
      }
    }
  }

  await sequelize.close();
  process.exitCode = problems.some((p) => p.kind === 'MISSING IN DB') ? 1 : 0;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
