'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Baseline: loads `000_baseline_schema.sql` — the full pg_dump of the live
 * schema (127 tables, sequences, constraints, indexes and views).
 *
 * This runs once on an empty database and is the floor every later migration
 * builds on. It is deliberately NOT generated from the models: the dump is the
 * source of truth, and the models were generated from it.
 *
 * Safe to run against a database that already has the tables — the dump uses
 * IF NOT EXISTS, and anything that is already present is skipped below.
 */

const SQL_FILE = path.join(__dirname, '..', '000_baseline_schema.sql');

/** Errors that just mean "this object already exists" — expected on a re-run. */
const ALREADY_EXISTS = new Set([
  '42P07', // duplicate_table
  '42710', // duplicate_object (constraint, index)
  '42P06', // duplicate_schema
  '42701', // duplicate_column
  '42723', // duplicate_function
]);

/** Split the dump into statements, respecting $$-quoted function bodies and strings. */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;
  let dollarTag = null;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += char;
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      current += char;
      if (char === '*' && next === '/') {
        current += next;
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (dollarTag) {
      current += char;
      if (char === '$' && sql.startsWith(dollarTag, i)) {
        current += sql.slice(i + 1, i + dollarTag.length);
        i += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote) {
      if (char === '-' && next === '-') {
        inLineComment = true;
        current += char;
        continue;
      }
      if (char === '/' && next === '*') {
        inBlockComment = true;
        current += char;
        continue;
      }
      const dollarMatch = char === '$' && sql.slice(i).match(/^\$[A-Za-z_]*\$/);
      if (dollarMatch) {
        dollarTag = dollarMatch[0];
        current += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }

    if (char === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
    else if (char === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;

    if (char === ';' && !inSingleQuote && !inDoubleQuote) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);

  // Drop comment-only statements, psql meta commands, and the pg_dump session
  // preamble. The preamble matters: `set_config('search_path','')` sticks for
  // the rest of the connection, and every migration after this one would then
  // fail with "no schema has been selected to create in". The dump fully
  // qualifies every object as public.x, so dropping it changes nothing.
  const PREAMBLE = /^(SET\s+\w+|SELECT\s+pg_catalog\.set_config)\b/i;

  return statements.filter((s) => {
    const stripped = s.replace(/--[^\n]*\n?/g, '').trim();
    if (!stripped || stripped.startsWith('\\')) return false;
    return !PREAMBLE.test(stripped);
  });
}

async function up({ sequelize, transaction, logger }) {
  if (!fs.existsSync(SQL_FILE)) {
    throw new Error(`Baseline schema not found at ${SQL_FILE}`);
  }

  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const statements = splitStatements(sql);

  // Be explicit about the target schema rather than inheriting whatever the
  // connection happened to have.
  await sequelize.query('SET LOCAL search_path TO public', { transaction, raw: true });

  logger?.info(`Applying baseline schema: ${statements.length} statements`);

  let applied = 0;
  let skipped = 0;

  for (const statement of statements) {
    try {
      await sequelize.query(statement, { transaction, raw: true });
      applied += 1;
    } catch (error) {
      const code = error?.parent?.code || error?.original?.code;
      if (ALREADY_EXISTS.has(code)) {
        skipped += 1;
        continue;
      }
      logger?.error({ code, statement: statement.slice(0, 200) }, 'Baseline statement failed');
      throw error;
    }
  }

  logger?.info(`Baseline schema applied: ${applied} statements, ${skipped} already present`);
}

async function down({ sequelize, transaction, logger }) {
  // Reverting the baseline means dropping every table in the schema. That is
  // destructive enough that it is gated behind an explicit env flag rather
  // than being one mistyped command away.
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Reverting the baseline drops every table. Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if that is really what you want.'
    );
  }

  logger?.warn('Dropping and recreating the public schema');
  await sequelize.query('DROP SCHEMA public CASCADE', { transaction, raw: true });
  await sequelize.query('CREATE SCHEMA public', { transaction, raw: true });
}

module.exports = { up, down, splitStatements };
