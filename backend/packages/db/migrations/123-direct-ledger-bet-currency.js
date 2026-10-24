'use strict';

/**
 * `bet_currency` on the DIRECT users' point ledger too (user, 2026-10-17) — the same key and the
 * same trigger as migration 122 put on `mssports.point_ledger` and `credits_ledger`, so a direct
 * user's sports rows also say which coin the bet was placed in. Only sports writes `bet_id` here
 * (casino rows carry none), so the lookup into `SportsBet` is safe.
 */
async function up({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });

  await q('ALTER TABLE mssports.point_ledger_direct ADD COLUMN IF NOT EXISTS bet_currency VARCHAR(16)');
  await q('DROP TRIGGER IF EXISTS ledger_bet_currency ON mssports.point_ledger_direct');
  await q(`CREATE TRIGGER ledger_bet_currency BEFORE INSERT ON mssports.point_ledger_direct
             FOR EACH ROW EXECUTE FUNCTION ledger_bet_currency()`);
  await q(`UPDATE mssports.point_ledger_direct l SET bet_currency = b.original_currency
             FROM mssports."SportsBet" b WHERE l.bet_id = b.id AND l.bet_currency IS NULL`);
}

async function down({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q('DROP TRIGGER IF EXISTS ledger_bet_currency ON mssports.point_ledger_direct');
  await q('ALTER TABLE mssports.point_ledger_direct DROP COLUMN IF EXISTS bet_currency');
}

module.exports = { up, down };
