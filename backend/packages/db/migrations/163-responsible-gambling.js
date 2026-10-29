'use strict';

/**
 * rainbet: responsible gambling — a player's own breaks and limits, enforced on the server.
 *
 * The player site's `/responsible-gambling` tabs kept these in the browser, so a break stopped
 * nothing and clearing site data undid it. These two tables back the user-service
 * `responsible-gambling` module, and the wallet refuses a stake (`BET_STAKE`) while one applies.
 *
 * ── SELF-EXCLUSION ───────────────────────────────────────────────────────
 *
 * One row per break. `type` is what it covers: CASINO, SPORTS or PLATFORM (the whole account —
 * sign-in is refused too). A row is in force while `until_at` is in the future. The first step
 * of the flow is a fixed 24-hour cooldown, stamped with `cooldown_until_at`; the break the player
 * then chooses has none. Rows are never shortened or deleted by the player — that is the point.
 *
 * ── LIMITS ───────────────────────────────────────────────────────────────
 *
 * One row per limit, LOSS_LIMIT or WAGER_LIMIT, in USD over a DAYS / WEEKS / MONTHS window that
 * restarts on the anniversary of `created_at`. A player holds at most one live limit of each type.
 * Removal is not immediate: `expires_at` is stamped twelve hours out and the limit keeps biting
 * until then, so a limit cannot be lifted in the heat of a session.
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS player_self_exclusions (
       id                BIGSERIAL    PRIMARY KEY,
       user_id           BIGINT       NOT NULL,
       -- CASINO | SPORTS | PLATFORM
       type              VARCHAR(10)  NOT NULL,
       created_at        TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       -- In force until then. A permanent break is written centuries out.
       until_at          TIMESTAMPTZ  NOT NULL,
       -- Set only on the 24-hour cooldown that opens the flow.
       cooldown_until_at TIMESTAMPTZ
     )`,
    { transaction }
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_player_self_exclusions_user ON player_self_exclusions (user_id, until_at)`,
    { transaction }
  );

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS player_gambling_limits (
       id          BIGSERIAL     PRIMARY KEY,
       user_id     BIGINT        NOT NULL,
       -- LOSS_LIMIT | WAGER_LIMIT
       type        VARCHAR(12)   NOT NULL,
       usd_amount  NUMERIC(20,2) NOT NULL,
       -- DAYS | WEEKS | MONTHS — the window restarts on the anniversary of created_at.
       period_unit VARCHAR(6)    NOT NULL,
       created_at  TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
       -- Removal requested: the limit still applies until then, and is gone after.
       expires_at  TIMESTAMPTZ
     )`,
    { transaction }
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_player_gambling_limits_user ON player_gambling_limits (user_id, created_at)`,
    { transaction }
  );

  logger?.info('Created player_self_exclusions and player_gambling_limits');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping these lifts every self-exclusion and gambling limit players have set on themselves. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP TABLE IF EXISTS player_self_exclusions', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS player_gambling_limits', { transaction });
  logger?.warn('Dropped player_self_exclusions and player_gambling_limits');
}

module.exports = { up, down };
