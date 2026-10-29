'use strict';

/**
 * rainbet: the Rewards popup's Daily Reload and Pre-Monthly Bonus.
 *
 *   DAILY_RELOAD  `percent` of what the player wagered yesterday (UTC), claimable once per UTC day.
 *   PRE_MONTHLY   `percent` of what the player wagered from the 1st to the 14th (UTC), claimable
 *                 once from the 15th to the month's end.
 *
 * Wagered = stakes less refunds, in USD (the ledger reading the gambling limits and the raffle
 * share); paid in the owner's reward coin. `min_vip_level` gates a program to a VIP rank.
 *
 *   reload_programs  one row per program — the site admin's switch, rate and rank gate
 *   reload_claims    one row per claim; unique per (program, player, period) so a reward is
 *                    claimed once however many times the button is pressed
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS reload_programs (
       key           VARCHAR(16)   PRIMARY KEY,
       enabled       BOOLEAN       NOT NULL DEFAULT true,
       -- Percent of the wagered USD, e.g. 0.10 = 0.1%.
       percent       NUMERIC(6,3)  NOT NULL,
       min_vip_level INTEGER       NOT NULL DEFAULT 0,
       updated_at    TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );
  await sequelize.query(
    `INSERT INTO reload_programs (key, percent) VALUES ('DAILY_RELOAD', 0.10), ('PRE_MONTHLY', 0.10)
     ON CONFLICT (key) DO NOTHING`,
    { transaction }
  );

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS reload_claims (
       id           BIGSERIAL     PRIMARY KEY,
       program      VARCHAR(16)   NOT NULL,
       user_id      BIGINT        NOT NULL,
       -- '2026-10-28' for a daily reload, '2026-10' for a pre-monthly.
       period_key   VARCHAR(10)   NOT NULL,
       wagered_usd  NUMERIC(30,8) NOT NULL,
       amount_usd   NUMERIC(30,8) NOT NULL,
       currency     VARCHAR(20)   NOT NULL,
       amount       NUMERIC(30,8) NOT NULL,
       ledger_id    BIGINT,
       created_at   TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS reload_claims_once ON reload_claims (program, user_id, period_key)`,
    { transaction }
  );

  logger?.info('Created reload_programs and reload_claims');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error('Dropping these discards the record of every reload bonus paid. Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.');
  }
  await sequelize.query('DROP TABLE IF EXISTS reload_claims', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS reload_programs', { transaction });
  logger?.warn('Dropped reload_programs and reload_claims');
}

module.exports = { up, down };
