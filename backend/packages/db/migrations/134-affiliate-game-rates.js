'use strict';

/**
 * hash.game's commission formula (Referral → Rate & Rules):
 *
 *   commission = wager × 1% × commission rate × game rate
 *
 * `affiliate_commission_rate` is the "Commission Rate" (25 = 25%), `affiliate_game_rates` the
 * per-category "game rate" (originals 28, slots 60, live 60, sports 100 — percent). Both are the
 * site admin's (Affiliate settings); the old flat `comissionpercent` no longer prices commission.
 */
const GAME_RATES = '{"originals": "28", "slots": "60", "live": "60", "sports": "100"}';

async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE siteconfig ADD COLUMN IF NOT EXISTS affiliate_commission_rate NUMERIC(6, 2) NOT NULL DEFAULT 25', { transaction });
  await sequelize.query(`ALTER TABLE siteconfig ADD COLUMN IF NOT EXISTS affiliate_game_rates JSONB NOT NULL DEFAULT '${GAME_RATES}'::jsonb`, { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE siteconfig DROP COLUMN IF EXISTS affiliate_game_rates', { transaction });
  await sequelize.query('ALTER TABLE siteconfig DROP COLUMN IF EXISTS affiliate_commission_rate', { transaction });
}

module.exports = { up, down };
