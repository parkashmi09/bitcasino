'use strict';

/**
 * `delta_currency` on the DIRECT users' point ledger (user, 2026-10-17): the row's `delta` is INR,
 * this is the same figure in the coin the bet was placed in (`bet_currency`), sign kept — written by
 * `writeDirectEntry` through `inrToCurrency`. Direct users only for now; the agent `point_ledger`
 * does not get it. Existing sports rows were all INR bets, so their delta carries over unchanged.
 */
async function up({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q('ALTER TABLE mssports.point_ledger_direct ADD COLUMN IF NOT EXISTS delta_currency NUMERIC(30, 8)');
  await q(`UPDATE mssports.point_ledger_direct SET delta_currency = delta
            WHERE bet_id IS NOT NULL AND bet_currency = 'INR' AND delta_currency IS NULL`);
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE mssports.point_ledger_direct DROP COLUMN IF EXISTS delta_currency', { transaction });
}

module.exports = { up, down };
