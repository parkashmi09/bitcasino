'use strict';

/**
 * The coin a sports bet was placed in, on its ledger rows (user, 2026-10-17).
 *
 * The exchange runs on INR: placeBet converts the stake with `toInr` and stores the player's own
 * coin and amount on the bet (`SportsBet.original_currency` / `original_amount`). The point ledger
 * and credits ledger keep INR as before; `bet_currency` only records which coin the bet was in, so
 * a listing can show a delta back in that coin later. (`credits_ledger.currency` is the WALLET
 * column that moved — INR — and stays that.)
 *
 * Filled by trigger from the bet (`bet_id`) rather than at each of the ~10 writers in sports
 * settlement, so no writer can forget it. Casino rows carry no `bet_id` and stay NULL.
 */
async function up({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });

  await q('ALTER TABLE mssports.point_ledger ADD COLUMN IF NOT EXISTS bet_currency VARCHAR(16)');
  await q('ALTER TABLE public.credits_ledger ADD COLUMN IF NOT EXISTS bet_currency VARCHAR(16)');

  await q(`CREATE OR REPLACE FUNCTION ledger_bet_currency() RETURNS trigger AS $$
           BEGIN
             IF NEW.bet_currency IS NULL AND NEW.bet_id IS NOT NULL THEN
               SELECT original_currency INTO NEW.bet_currency FROM mssports."SportsBet" WHERE id = NEW.bet_id;
             END IF;
             RETURN NEW;
           END
           $$ LANGUAGE plpgsql`);

  for (const table of ['mssports.point_ledger', 'public.credits_ledger']) {
    await q(`DROP TRIGGER IF EXISTS ledger_bet_currency ON ${table}`);
    await q(`CREATE TRIGGER ledger_bet_currency BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ledger_bet_currency()`);
  }

  // Rows already written: every bet so far was INR.
  await q(`UPDATE mssports.point_ledger l SET bet_currency = b.original_currency
             FROM mssports."SportsBet" b WHERE l.bet_id = b.id AND l.bet_currency IS NULL`);
  await q(`UPDATE public.credits_ledger l SET bet_currency = b.original_currency
             FROM mssports."SportsBet" b WHERE l.bet_id = b.id AND l.bet_currency IS NULL`);
}

async function down({ sequelize, transaction }) {
  const q = (sql) => sequelize.query(sql, { transaction });
  for (const table of ['mssports.point_ledger', 'public.credits_ledger']) {
    await q(`DROP TRIGGER IF EXISTS ledger_bet_currency ON ${table}`);
    await q(`ALTER TABLE ${table} DROP COLUMN IF EXISTS bet_currency`);
  }
  await q('DROP FUNCTION IF EXISTS ledger_bet_currency()');
}

module.exports = { up, down };
