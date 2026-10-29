'use strict';

/**
 * rainbet: the weekly raffle (the player site's `/raffle`, owner feature `raffles`).
 *
 * ── THE RULES ─────────────────────────────────────────────────────────────
 *
 * A draw runs every Sunday 00:00 UTC and covers the week before it. Each player may claim one
 * free ticket per draw and earns one more ticket for every `wager_per_ticket_usd` staked in that
 * week (counted from the ledger, stakes less refunds). At the draw `winners` tickets are picked at
 * random from every ticket in it, and each pays `prize_pool_usd / winners` in the owner's reward
 * coin. A player can hold several winning tickets.
 *
 * ── THE TABLES ────────────────────────────────────────────────────────────
 *
 *   raffle_config   one row (id 1): the site admin's settings, used by the NEXT draw opened
 *   raffle_draws    one row per draw, keyed by its number; the settings are copied in when the
 *                   draw opens, so changing them never alters a draw already running
 *   raffle_tickets  seven-digit numbers, unique within a draw; one FREE ticket per player per draw
 *   raffle_winners  one row per winning ticket; `ledger_id` is set once the prize is credited, so a
 *                   failed credit is retried by the next job tick rather than lost
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS raffle_config (
       id                  SMALLINT      PRIMARY KEY DEFAULT 1 CHECK (id = 1),
       enabled             BOOLEAN       NOT NULL DEFAULT true,
       prize_pool_usd      NUMERIC(20,2) NOT NULL DEFAULT 20000,
       winners             INTEGER       NOT NULL DEFAULT 50,
       wager_per_ticket_usd NUMERIC(20,2) NOT NULL DEFAULT 500,
       updated_at          TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );
  await sequelize.query(`INSERT INTO raffle_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`, { transaction });

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS raffle_draws (
       number               INTEGER       PRIMARY KEY,
       starts_at            TIMESTAMPTZ   NOT NULL,
       draw_at              TIMESTAMPTZ   NOT NULL,
       -- OPEN | DRAWN
       status               VARCHAR(8)    NOT NULL DEFAULT 'OPEN',
       prize_pool_usd       NUMERIC(20,2) NOT NULL,
       winners              INTEGER       NOT NULL,
       wager_per_ticket_usd NUMERIC(20,2) NOT NULL,
       ticket_count         INTEGER,
       drawn_at             TIMESTAMPTZ
     )`,
    { transaction }
  );

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS raffle_tickets (
       id            BIGSERIAL   PRIMARY KEY,
       draw_number   INTEGER     NOT NULL,
       user_id       BIGINT      NOT NULL,
       ticket_number INTEGER     NOT NULL,
       -- FREE | WAGER
       source        VARCHAR(5)  NOT NULL,
       created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS raffle_tickets_number_uniq ON raffle_tickets (draw_number, ticket_number)`,
    { transaction }
  );
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS raffle_tickets_free_uniq ON raffle_tickets (draw_number, user_id) WHERE source = 'FREE'`,
    { transaction }
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_raffle_tickets_user ON raffle_tickets (user_id, draw_number)`,
    { transaction }
  );

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS raffle_winners (
       id          BIGSERIAL     PRIMARY KEY,
       draw_number INTEGER       NOT NULL,
       ticket_id   BIGINT        NOT NULL UNIQUE,
       user_id     BIGINT        NOT NULL,
       prize_usd   NUMERIC(20,2) NOT NULL,
       -- What was credited, in the reward coin. Null until paid.
       currency    VARCHAR(20),
       amount      NUMERIC(30,8),
       ledger_id   BIGINT,
       created_at  TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_raffle_winners_draw ON raffle_winners (draw_number)`,
    { transaction }
  );

  logger?.info('Created raffle_config, raffle_draws, raffle_tickets and raffle_winners');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping these discards every raffle ticket and the record of every prize paid. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  for (const table of ['raffle_winners', 'raffle_tickets', 'raffle_draws', 'raffle_config']) {
    await sequelize.query(`DROP TABLE IF EXISTS ${table}`, { transaction });
  }
  logger?.warn('Dropped the raffle tables');
}

module.exports = { up, down };
