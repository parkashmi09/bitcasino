'use strict';

/**
 * Agent-tree money: the columns three fixes need.
 *
 *   credits.credit_limit   NUMERIC DEFAULT 0
 *       `POST /admin/accounts/credit-limit` wrote `Credits.update({ credit_limit })`
 *       against a table with no such column. Sequelize drops an unknown
 *       attribute, so the UPDATE matched the row, changed nothing and the route
 *       answered success. The player's limit is stored and read back now.
 *       (`staff_balances.credit_limit` has existed since the baseline; it is the
 *       one the staff money paths enforce — see lords `debitStaffFloat`.)
 *
 *   users.lock_sources, staff.lock_sources   JSONB NOT NULL DEFAULT '{}'
 *       Why a lock column is true. Per lock column:
 *           { "<column>": { "own": bool, "by": ["<staffId>", …] } }
 *       `own` — the lock was set on this account directly. `by` — the agents
 *       whose subtree lock is holding it. Unlocking an agent removes that agent
 *       from `by` and clears the column only when nothing else holds it, so a
 *       lock set directly on a child survives its parent being unlocked.
 *       A locked row with no entry predates this column and is treated as an
 *       own lock — it is never lifted by a cascade it cannot be shown to come
 *       from.
 *
 * Idempotent (`ADD COLUMN IF NOT EXISTS`). `down` drops the three columns.
 */

const COLUMNS = [
  { table: 'credits', column: 'credit_limit', type: 'NUMERIC DEFAULT 0' },
  { table: 'users', column: 'lock_sources', type: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
  { table: 'staff', column: 'lock_sources', type: "JSONB NOT NULL DEFAULT '{}'::jsonb" },
];

async function up({ sequelize, transaction, logger }) {
  for (const { table, column, type } of COLUMNS) {
    // Identifiers come from the constant list above, never from input.
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`, { transaction });
    logger?.info(`${table}.${column} present`);
  }
}

async function down({ sequelize, transaction }) {
  for (const { table, column } of COLUMNS) {
    await sequelize.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS ${column}`, { transaction });
  }
}

module.exports = { up, down };
