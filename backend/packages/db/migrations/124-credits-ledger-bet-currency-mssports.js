'use strict';

/**
 * Migration 122 put `bet_currency` (and its trigger) on `public.credits_ledger`, but sports writes
 * its credits ledger into `mssports.credits_ledger` — its pool's search_path is `mssports,public`.
 * Move both to the table sports actually writes, backfill it, and take them off the public one
 * (no public row ever had a `bet_id`, so nothing was stamped there).
 */
async function up({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });

  await q('ALTER TABLE mssports.credits_ledger ADD COLUMN IF NOT EXISTS bet_currency VARCHAR(16)');
  await q('DROP TRIGGER IF EXISTS ledger_bet_currency ON mssports.credits_ledger');
  await q(`CREATE TRIGGER ledger_bet_currency BEFORE INSERT ON mssports.credits_ledger
             FOR EACH ROW EXECUTE FUNCTION ledger_bet_currency()`);
  await q(`UPDATE mssports.credits_ledger l SET bet_currency = b.original_currency
             FROM mssports."SportsBet" b WHERE l.bet_id = b.id AND l.bet_currency IS NULL`);

  await q('DROP TRIGGER IF EXISTS ledger_bet_currency ON public.credits_ledger');
  await q('ALTER TABLE public.credits_ledger DROP COLUMN IF EXISTS bet_currency');
}

async function down({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  await q('DROP TRIGGER IF EXISTS ledger_bet_currency ON mssports.credits_ledger');
  await q('ALTER TABLE mssports.credits_ledger DROP COLUMN IF EXISTS bet_currency');
  await q('ALTER TABLE public.credits_ledger ADD COLUMN IF NOT EXISTS bet_currency VARCHAR(16)');
  await q(`CREATE TRIGGER ledger_bet_currency BEFORE INSERT ON public.credits_ledger
             FOR EACH ROW EXECUTE FUNCTION ledger_bet_currency()`);
}

module.exports = { up, down };
