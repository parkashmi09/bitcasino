'use strict';

/**
 * `delta_currency` on the agent `mssports.point_ledger` too (user, 2026-10-17) — as 125 did for the
 * direct ledger: the row's INR `delta` in the bet's coin, sign kept, written by
 * `updateAllPointHierarchy` through `inrToCurrency`. Existing bet rows were INR bets: delta as is.
 */
async function up({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q('ALTER TABLE mssports.point_ledger ADD COLUMN IF NOT EXISTS delta_currency NUMERIC(30, 8)');
  await q(`UPDATE mssports.point_ledger SET delta_currency = delta
            WHERE bet_id IS NOT NULL AND bet_currency = 'INR' AND delta_currency IS NULL`);
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE mssports.point_ledger DROP COLUMN IF EXISTS delta_currency', { transaction });
}

module.exports = { up, down };
