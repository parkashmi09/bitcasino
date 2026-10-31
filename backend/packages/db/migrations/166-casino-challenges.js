'use strict';

/**
 * rainbet: casino challenges (the player site's `/challenges`, owner feature `challenges`).
 *
 * A challenge names a game and asks for a multiplier: "hit 3,500x on Dice with a bet of at least
 * $0.10, win $350". The site admin creates them; the first `winners` players to land a qualifying
 * round inside the challenge's dates each win `prize_usd` (paid in the coin they bet in). A player
 * wins a challenge once.
 *
 * Rounds are checked as they settle (casino-service in-house engine, `announceSettled`).
 * Provider rounds join when the provider integration is live (Phase 7).
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS casino_challenges (
       id             BIGSERIAL     PRIMARY KEY,
       -- The in-house game key ('dice', 'limbo', …) the round must be on.
       game           VARCHAR(64)   NOT NULL,
       game_name      VARCHAR(120)  NOT NULL,
       image_url      VARCHAR(500),
       min_multiplier NUMERIC(20,4) NOT NULL,
       min_bet_usd    NUMERIC(20,2) NOT NULL,
       prize_usd      NUMERIC(20,2) NOT NULL,
       winners        INTEGER       NOT NULL DEFAULT 1,
       starts_at      TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
       ends_at        TIMESTAMPTZ   NOT NULL,
       -- ACTIVE | CANCELLED (a challenge is complete when its winners are in or its time is up)
       status         VARCHAR(10)   NOT NULL DEFAULT 'ACTIVE',
       created_at     TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );
  await sequelize.query(`CREATE INDEX IF NOT EXISTS idx_casino_challenges_game ON casino_challenges (game, status)`, { transaction });

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS casino_challenge_winners (
       id           BIGSERIAL     PRIMARY KEY,
       challenge_id BIGINT        NOT NULL,
       user_id      BIGINT        NOT NULL,
       bet_id       VARCHAR(64)   NOT NULL,
       multiplier   NUMERIC(20,4) NOT NULL,
       bet_usd      NUMERIC(20,8) NOT NULL,
       currency     VARCHAR(20),
       amount       NUMERIC(30,8),
       ledger_id    BIGINT,
       created_at   TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS casino_challenge_winners_once ON casino_challenge_winners (challenge_id, user_id)`,
    { transaction }
  );

  logger?.info('Created casino_challenges and casino_challenge_winners');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error('Dropping these discards every challenge and the record of its winners. Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.');
  }
  await sequelize.query('DROP TABLE IF EXISTS casino_challenge_winners', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS casino_challenges', { transaction });
  logger?.warn('Dropped casino_challenges and casino_challenge_winners');
}

module.exports = { up, down };
