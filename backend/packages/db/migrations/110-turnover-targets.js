'use strict';

/**
 * Main → Turnover Report (admin-structure.zip `TurnoverReport` jaisa): har direct user ka
 * wager target = total deposit × TargetX.
 *
 *   turnover_settings   ek row — default TargetX (zip `wager_multiplier_common`, default 3)
 *   turnover_targets    user ka apna TargetX; `locked` = "Update All TargetX" isko nahi badlta
 *
 * Row nahi = default chalta hai. Sirf report / target hai — withdrawal ke rules nahi badle.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS turnover_settings (
       id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
       multiplier  NUMERIC(6,2) NOT NULL DEFAULT 3,
       updated_by  BIGINT,
       updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    { transaction }
  );
  await sequelize.query('INSERT INTO turnover_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING', { transaction });
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS turnover_targets (
       user_id     BIGINT PRIMARY KEY,
       multiplier  NUMERIC(6,2) NOT NULL,
       locked      BOOLEAN NOT NULL DEFAULT FALSE,
       updated_by  BIGINT,
       updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP TABLE IF EXISTS turnover_targets', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS turnover_settings', { transaction });
}

module.exports = { up, down };
