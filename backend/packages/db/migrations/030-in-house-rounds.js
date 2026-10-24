'use strict';

/**
 * `in_house_rounds` — the state of a multi-step game round.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT THIS REPLACES
 *
 * Ten of the twenty in-house games are not a single message. Mines, Tower,
 * Goal, HiLo, HighLow, Blackjack, Snake and Ladders, Roulette, Keno and Crash
 * all open a round, take one or more steps, and settle on a cash-out.
 *
 * Legacy held that state in `General/Queue` — an in-process array:
 *
 *     Queue.update(self.id, "uid", "mines", mine);
 *     Queue.update(self.id, "uid", "result", result);
 *     Queue.update(self.id, "uid", "selected", []);
 *
 * Three consequences, all of which cost real money:
 *
 *   1. ONE PROCESS ONLY. The platform is a `cluster` fork per CPU
 *      (`const totalCPUs = require("os").cpus().length`), and Socket.io is not
 *      sticky by default — so a player's cash-out could land on a worker that
 *      has never heard of their round. `Queue.getOne` returns undefined and
 *      the handler does `console.log('Client Not Playing!')` and drops it. The
 *      stake is already gone.
 *
 *   2. LOST ON RESTART. Every open round is a stake taken and never settled.
 *      There is no reconciliation path — the rows in `bets` stay open forever.
 *
 *   3. NO EXPIRY. A round nobody cashes out sits in memory for the life of the
 *      process, and the player's stake with it.
 *
 * The round is a row here, so a cash-out finds it whichever worker serves it,
 * a restart does not lose it, and an abandoned one can be swept.
 * ═════════════════════════════════════════════════════════════════════════
 */

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS in_house_rounds (
       id          BIGSERIAL PRIMARY KEY,
       -- The bet this round belongs to. The stake is already taken by the time
       -- a round exists, so this is never null.
       bet_id      BIGINT       NOT NULL,
       user_id     BIGINT       NOT NULL,
       game        VARCHAR(40)  NOT NULL,
       coin        VARCHAR(20)  NOT NULL,
       amount      NUMERIC(30,8) NOT NULL,
       -- The drawn outcome, hidden until the round ends: the mine positions,
       -- the tower rows, the shuffled cards.
       state       JSONB        NOT NULL,
       -- What the player has done so far.
       selected    JSONB        NOT NULL DEFAULT '[]'::jsonb,
       steps       INTEGER      NOT NULL DEFAULT 0,
       -- Accumulated across steps; paid on cash-out.
       profit      NUMERIC(30,8) NOT NULL DEFAULT 0,
       hash        TEXT,
       -- open | cashed_out | lost | expired
       status      VARCHAR(20)  NOT NULL DEFAULT 'open',
       created_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  /**
   * ONE open round per player per game.
   *
   * Legacy's `Queue.exists(id)` was the equivalent check and it was skipped
   * entirely for plinko (`if (game === "plinko") exists = false;`), so that
   * game could have several rounds open at once. A partial unique index is the
   * same rule enforced by the database rather than by remembering.
   */
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_in_house_rounds_open
       ON in_house_rounds (user_id, game) WHERE status = 'open'`,
    { transaction }
  );

  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_in_house_rounds_bet ON in_house_rounds (bet_id)',
    { transaction }
  );

  /** For the sweep of abandoned rounds. */
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_in_house_rounds_stale
       ON in_house_rounds (created_at) WHERE status = 'open'`,
    { transaction }
  );

  logger?.info('Created in_house_rounds — multi-step game state, previously an in-process array');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping this discards every open game round — each one is a stake already taken. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP TABLE IF EXISTS in_house_rounds', { transaction });
  logger?.warn('Dropped in_house_rounds');
}

module.exports = { up, down };
