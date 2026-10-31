'use strict';

/**
 * The wagering race — a daily and a weekly leaderboard paid from a prize pool.
 *
 * Every bet is converted into POINTS by a per-bucket multiplier, summed over a
 * race window, and ranked. When the window closes the top N ranks take a slice
 * of the pool, written here as a claimable reward rather than credited
 * directly — a player claims it into their wallet.
 *
 * Four tables: the per-type configuration, the windows themselves, the prizes,
 * and the operator's decorative entries.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THREE THINGS THE REFERENCE IMPLEMENTATION GOT WRONG, FIXED IN THE SCHEMA
 *
 *   1. IT NAMED A COLUMN `end`. That is a reserved word, so every statement
 *      touching it needed `"end"`, and the one SELECT that forgot to list it
 *      left `race.end` permanently `undefined` — the "is this race over"
 *      guard never fired, and a settled race went on serving live standings
 *      for three days without anything noticing. `status` here, and the
 *      invariant it was trying to express is a partial unique index instead.
 *
 *   2. ONE OPEN RACE PER TYPE WAS A CONVENTION. Creating a race marked every
 *      other open one closed, in a second statement, with no constraint
 *      behind it — two concurrent creates produced two open races and the
 *      leaderboard picked whichever sorted first. `uq_races_open` makes the
 *      database refuse the second.
 *
 *   3. SETTLEMENT INSERTED REWARDS ONE ROW AT A TIME WITH NO `ON CONFLICT`,
 *      outside a transaction, and logged the resulting unique violation to
 *      the console. A settlement that died half way could never be completed,
 *      because the retry threw on every row it had already written. The
 *      constraint stays — it is the right one — and the service inserts in
 *      one statement that tolerates it.
 * ═════════════════════════════════════════════════════════════════════════
 */

async function up({ sequelize, transaction, logger }) {
  // ── The configuration, one row per race type ────────────────────────
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS race_config (
       id                   BIGSERIAL PRIMARY KEY,
       -- UNIQUE, not just CHECKed: the whole module addresses a config by its
       -- type, and a second 'daily' row would be read by nothing.
       type                 VARCHAR(10)  NOT NULL UNIQUE
                              CHECK (type IN ('daily', 'weekly')),

       -- The switch. DEFAULT FALSE: a race that pays real money out of a pool
       -- should start off and be turned on deliberately. The reference
       -- implementation treated a NULL as "on", so a half-applied migration
       -- opened a promotion nobody had configured.
       enabled              BOOLEAN      NOT NULL DEFAULT FALSE,

       -- Points per USD wagered, by game bucket. Five, not four: the
       -- reference had no bucket for roulette, table games or an unknown
       -- game type and swept all of them into the SLOT multiplier, which was
       -- configured at zero — so a third of all turnover silently scored
       -- nothing. 'other_points' is that fall-through, made visible and
       -- configurable rather than disguised as something else.
       sports_points        NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (sports_points >= 0),
       casino_points        NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (casino_points >= 0),
       slot_points          NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (slot_points >= 0),
       crash_points         NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (crash_points >= 0),
       other_points         NUMERIC(12,4) NOT NULL DEFAULT 0 CHECK (other_points >= 0),

       -- The pool, gross. 'platform_fee_percent' comes off it before any rank
       -- is paid, so what the ranks add up to is always less than this.
       prize_pool           NUMERIC(30,8) NOT NULL DEFAULT 0 CHECK (prize_pool >= 0),
       currency             VARCHAR(10)   NOT NULL DEFAULT 'USDT',
       platform_fee_percent NUMERIC(5,2)  NOT NULL DEFAULT 0
                              CHECK (platform_fee_percent >= 0 AND platform_fee_percent <= 100),

       -- How many ranks are paid. Also caps the leaderboard: there is no
       -- "see the ranks below the payout line" view, by design.
       winner_count         INTEGER       NOT NULL DEFAULT 10 CHECK (winner_count >= 1),
       -- Share of the net pool taken by ranks 1-3.
       top3_percentage      NUMERIC(5,2)  NOT NULL DEFAULT 60
                              CHECK (top3_percentage >= 0 AND top3_percentage <= 100),
       -- The computed curve: [{rank, percentage, amount}]. Derived on save and
       -- stored so the table an operator approved is the table that pays.
       rank_percentage      JSONB         NOT NULL DEFAULT '[]'::jsonb,

       -- Below this, a player is on the board but not in the prizes. Stops a
       -- thin race paying out to someone who placed one bet.
       min_points           NUMERIC(30,8) NOT NULL DEFAULT 0 CHECK (min_points >= 0),

       -- Decorative entries. See race_boats.
       booked_seats_enabled BOOLEAN       NOT NULL DEFAULT FALSE,
       booked_seats         JSONB         NOT NULL DEFAULT '[]'::jsonb,

       created_at           TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at           TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  // ── The windows ─────────────────────────────────────────────────────
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS races (
       id                   BIGSERIAL PRIMARY KEY,
       type                 VARCHAR(10)  NOT NULL CHECK (type IN ('daily', 'weekly')),

       -- Half-open: >= starts_at, < ends_at. The reference used BETWEEN, which
       -- is closed at both ends, so a bet placed on the boundary instant
       -- counted towards two adjacent races.
       starts_at            TIMESTAMPTZ  NOT NULL,
       ends_at              TIMESTAMPTZ  NOT NULL CHECK (ends_at > starts_at),

       -- open | settled. NOT a column called "end" — see the header.
       status               VARCHAR(10)  NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'settled')),
       settled_at           TIMESTAMPTZ,

       -- The configuration AS IT WAS when this race settled, so that changing
       -- the config tomorrow does not rewrite what yesterday paid. Null while
       -- the race is open: there is nothing to snapshot until it closes.
       snapshot             JSONB,
       prize_pool           NUMERIC(30,8) NOT NULL DEFAULT 0,
       platform_fee_percent NUMERIC(5,2)  NOT NULL DEFAULT 0,
       winner_count         INTEGER       NOT NULL DEFAULT 0,
       total_awarded        NUMERIC(30,8) NOT NULL DEFAULT 0,

       created_at           TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at           TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  /**
   * ONE OPEN RACE PER TYPE, enforced.
   *
   * The reference expressed this as "insert, then UPDATE every other open race
   * of this type to closed" — two statements, no constraint, and a second
   * caller arriving between them produced two open races. The leaderboard then
   * read `ORDER BY start_time DESC LIMIT 1`, so which one a player saw
   * depended on row order.
   */
  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_races_open
       ON races (type) WHERE status = 'open'`,
    { transaction }
  );

  /** A window is identified by its start, so rolling twice is idempotent. */
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_races_window ON races (type, starts_at)',
    { transaction }
  );

  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_races_type_recent ON races (type, starts_at DESC)',
    { transaction }
  );

  // ── The prizes ──────────────────────────────────────────────────────
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS race_rewards (
       id             BIGSERIAL PRIMARY KEY,
       race_id        BIGINT       NOT NULL REFERENCES races (id) ON DELETE CASCADE,
       -- A REAL player. Decorative entries never reach this table — see the
       -- note on race_boats.
       user_id        BIGINT       NOT NULL,
       type           VARCHAR(10)  NOT NULL,
       rank           INTEGER      NOT NULL CHECK (rank >= 1),
       points         NUMERIC(30,8) NOT NULL DEFAULT 0,
       currency       VARCHAR(10)  NOT NULL DEFAULT 'USDT',
       amount         NUMERIC(30,8) NOT NULL CHECK (amount > 0),

       -- Written at claim time, so a support desk can see the movement without
       -- joining the ledger.
       claimed        BOOLEAN      NOT NULL DEFAULT FALSE,
       claimed_at     TIMESTAMPTZ,
       balance_before NUMERIC(30,8),
       balance_after  NUMERIC(30,8),

       created_at     TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,

       -- One prize per player per race. Settlement writes every row in a single
       -- statement that tolerates this, so a retry completes a partial run
       -- instead of throwing on the rows it already wrote.
       CONSTRAINT uq_race_rewards_player UNIQUE (race_id, user_id)
     )`,
    { transaction }
  );

  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_race_rewards_unclaimed
       ON race_rewards (user_id) WHERE claimed = FALSE`,
    { transaction }
  );

  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_race_rewards_user ON race_rewards (user_id, created_at DESC)',
    { transaction }
  );

  // ── The decorative entries ──────────────────────────────────────────
  /**
   * A "booked seat" is a leaderboard entry the operator parks at a chosen rank.
   *
   * ── IT HAS NO user_id, AND THAT IS THE POINT ─────────────────────────
   *
   * The reference gave these rows fake user ids starting at 900001 so they
   * could flow through the same code paths as real players. They then flowed
   * through SETTLEMENT too, and were awarded prizes — rows in `race_rewards`
   * against accounts that do not exist in `users` or `credits`, which can
   * never be claimed by anyone. With eleven of twenty-five daily ranks booked,
   * a large share of every pool was written to unreachable rows.
   *
   * Here they are not users, cannot be mistaken for one, and the settlement
   * query reads `race_rewards`-eligible entries only — so a booked seat
   * displaces a real player on the BOARD and never in the PRIZES.
   */
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS race_boats (
       id            BIGSERIAL PRIMARY KEY,
       name          VARCHAR(60)  NOT NULL,
       daily_points  NUMERIC(30,8) NOT NULL DEFAULT 0,
       weekly_points NUMERIC(30,8) NOT NULL DEFAULT 0,
       daily_rank    INTEGER,
       weekly_rank   INTEGER,
       is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
       created_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  /**
   * The two race types, switched OFF.
   *
   * Seeded so that the config screen has a row to edit and the public endpoint
   * has something to answer — a missing row and a disabled race are different
   * states, and only one of them is normal.
   */
  await sequelize.query(
    `INSERT INTO race_config (type, enabled, sports_points, casino_points, slot_points, crash_points, other_points,
                              prize_pool, platform_fee_percent, winner_count, top3_percentage)
     VALUES ('daily',  FALSE, 1, 1, 1, 1, 1,  0, 0, 10, 60),
            ('weekly', FALSE, 1, 1, 1, 1, 1,  0, 0, 25, 60)
     ON CONFLICT (type) DO NOTHING`,
    { transaction }
  );

  logger?.info('Created race_config, races, race_rewards and race_boats — the wagering race');
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping this discards every settled race and every UNCLAIMED prize with it — ' +
        'money owed to players that exists nowhere else. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if intended.'
    );
  }
  await sequelize.query('DROP TABLE IF EXISTS race_rewards', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS races', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS race_boats', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS race_config', { transaction });
  logger?.warn('Dropped the wagering-race tables');
}

module.exports = { up, down };
