'use strict';

/**
 * rainbet: a third wagering race, `monthly` — the player site's Monthly Race (sidebar row and
 * `/monthly-race`), which had no race behind it.
 *
 * It runs the same way as the daily and weekly races (migration 039): standings from the wager
 * activity inside the window, prizes from the stored curve. The window is the local calendar
 * month in `RACE_TIMEZONE`. What changes here:
 *
 *   - the two CHECKs that named `daily` and `weekly` now allow `monthly`
 *   - `race_config` gets a `monthly` row, copied from `weekly` and switched OFF, so the site
 *     admin sets its pool before it runs
 *   - `race_boats` (decorative booked seats) gets the monthly columns the other two have
 */

const TYPES = "('daily', 'weekly', 'monthly')";

async function up({ sequelize, transaction, logger }) {
  for (const [table, name] of [['race_config', 'race_config_type_check'], ['races', 'races_type_check']]) {
    await sequelize.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`, { transaction });
    await sequelize.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (type IN ${TYPES})`, { transaction });
  }

  await sequelize.query(
    `INSERT INTO race_config (type, enabled, sports_points, casino_points, slot_points, crash_points, other_points,
       prize_pool, currency, platform_fee_percent, winner_count, top3_percentage, rank_percentage, min_points,
       booked_seats_enabled, booked_seats, created_at, updated_at)
     SELECT 'monthly', false, sports_points, casino_points, slot_points, crash_points, other_points,
       prize_pool, currency, platform_fee_percent, winner_count, top3_percentage, rank_percentage, min_points,
       false, '[]'::jsonb, now(), now()
       FROM race_config WHERE type = 'weekly'
        AND NOT EXISTS (SELECT 1 FROM race_config WHERE type = 'monthly')`,
    { transaction }
  );

  await sequelize.query(
    `ALTER TABLE race_boats
       ADD COLUMN IF NOT EXISTS monthly_points NUMERIC(30,8) NOT NULL DEFAULT 0,
       ADD COLUMN IF NOT EXISTS monthly_rank INTEGER`,
    { transaction }
  );

  logger?.info('Races: monthly type allowed, monthly config row added (off), race_boats monthly columns');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error('This deletes every monthly race and its config. Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.');
  }
  await sequelize.query(`DELETE FROM races WHERE type = 'monthly'`, { transaction });
  await sequelize.query(`DELETE FROM race_config WHERE type = 'monthly'`, { transaction });
  for (const [table, name] of [['race_config', 'race_config_type_check'], ['races', 'races_type_check']]) {
    await sequelize.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name}`, { transaction });
    await sequelize.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (type IN ('daily', 'weekly'))`, { transaction });
  }
  await sequelize.query('ALTER TABLE race_boats DROP COLUMN IF EXISTS monthly_points, DROP COLUMN IF EXISTS monthly_rank', { transaction });
  logger?.warn('Removed the monthly race');
}

module.exports = { up, down };
