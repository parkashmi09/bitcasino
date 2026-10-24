'use strict';

/**
 * Schema for the three casino provider integrations — plus the four tables they
 * were written against that never existed.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * FOUR TABLES REFERENCED BY LIVE ROUTES, NEVER CREATED
 *
 * `gis_freespins`, `gis_freevouchers`, `game_sessions` and `game_transactions`
 * appear in mounted, reachable handlers. None of them are in the baseline
 * schema, and no migration has ever created them. Every route that touches one
 * has therefore returned 500 since the day it was written:
 *
 *   POST /api/gis/freespins/set        INSERT INTO gis_freespins
 *   GET  /api/gis/freespins/get        SELECT  FROM gis_freespins
 *   POST /api/gis/freespins/cancel     UPDATE  gis_freespins
 *   POST /api/gis/freevouchers/set     INSERT INTO gis_freevouchers
 *   GET  /api/gis/freevouchers/get     SELECT  FROM gis_freevouchers
 *   POST /api/gis/freevouchers/cancel  UPDATE  gis_freevouchers
 *   POST /jsGamesv2/launch             INSERT INTO game_sessions
 *   POST /jsGamesv2/bet-callback       INSERT INTO game_transactions
 *
 * The shapes below are RECONSTRUCTED from those statements — the column list,
 * the order, and the types implied by what is bound to them. They are not a
 * recovered schema, because there is nothing to recover.
 *
 * One consequence worth stating plainly, because it changes the risk: the
 * jsGamesv2 bet callback takes the player's new balance from the REQUEST BODY
 * and writes it, with no signature, no authentication, and no arithmetic:
 *
 *     const newBalance = Number(parseFloat(balance).toFixed(8));
 *     UPDATE credits SET usdt = $1 WHERE uid = $2
 *
 * That is "post a number, own that balance". It was never exploitable only
 * because the INSERT into the missing `game_transactions` threw first and the
 * handler returned 500 before reaching the UPDATE. Creating the table here
 * removes that accident, so the ported handler computes the balance from the
 * movement and never accepts one from a caller.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * IDEMPOTENCY THE PROVIDER CALLBACKS NEVER HAD
 *
 * Neither jsGames handler checked whether it had seen a transaction before.
 * `js_game_transactions` has no unique column at all; the one `ON CONFLICT
 * (external_transaction_id)` in the codebase names a column with no constraint
 * behind it, which is a runtime error, not a guard.
 *
 * Providers retry. The unique indexes below are what makes a retry a no-op.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * UPSERT KEYS FOR THE CURATION TABLES
 *
 * `gis_prioritized_games` and `gis_prioritized_types` were written with a
 * hand-rolled UPDATE-then-INSERT-if-zero-rows. Two admins saving the same
 * vendor at once both get zero rows updated and both insert, and from then on
 * the list that wins is whichever `ORDER BY updated_at DESC LIMIT 1` happens to
 * pick. A unique key makes it one row.
 */

async function up({ sequelize, transaction, logger }) {
  // ══════════════════════════════════════════════════════════════════════
  //  Slotegrator freespin campaigns
  // ══════════════════════════════════════════════════════════════════════
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS gis_freespins (
       id            BIGSERIAL PRIMARY KEY,
       user_id       BIGINT       NOT NULL,

       -- The provider's campaign id. Ours to choose, theirs to echo back.
       freespin_id   VARCHAR(190) NOT NULL UNIQUE,
       game_uuid     VARCHAR(190) NOT NULL,
       currency      VARCHAR(10)  NOT NULL,

       -- How many were granted, and how many are left. Legacy seeded both from
       -- the same bind parameter ($5 twice) and then never decremented
       -- quantity_left, so it is granted-count until something spends it.
       quantity      INTEGER      NOT NULL DEFAULT 0,
       quantity_left INTEGER      NOT NULL DEFAULT 0,

       valid_from    TIMESTAMPTZ,
       valid_until   TIMESTAMPTZ,

       -- Either (bet_id + denomination) or total_bet_id — the provider accepts
       -- one pair or the other, which is why all three are nullable.
       bet_id        VARCHAR(190),
       total_bet_id  VARCHAR(190),
       denomination  NUMERIC(30,8),

       status        VARCHAR(20)  NOT NULL DEFAULT 'active',
       is_canceled   SMALLINT     NOT NULL DEFAULT 0,

       created_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_gis_freespins_user
       ON gis_freespins (user_id, created_at DESC)`,
    { transaction }
  );

  // ══════════════════════════════════════════════════════════════════════
  //  Slotegrator free vouchers (live-casino table credit)
  // ══════════════════════════════════════════════════════════════════════
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS gis_freevouchers (
       id              BIGSERIAL PRIMARY KEY,
       user_id         BIGINT       NOT NULL,
       voucher_id      VARCHAR(190) NOT NULL UNIQUE,

       title           TEXT         NOT NULL,
       currency        VARCHAR(10)  NOT NULL,

       -- What the voucher is worth, and the ceiling on what it can win.
       initial_balance NUMERIC(30,8) NOT NULL DEFAULT 0,
       max_winnings    NUMERIC(30,8) NOT NULL DEFAULT 0,
       -- Remaining playable credit. Legacy seeded it from initial_balance.
       playable        NUMERIC(30,8) NOT NULL DEFAULT 0,

       valid_until     TIMESTAMPTZ,

       -- Which live tables it may be played at. An array, because the provider
       -- sends an array and legacy bound one straight into the column.
       table_ids       TEXT[]       NOT NULL DEFAULT '{}',

       short_terms     TEXT,
       terms_and_conds TEXT,

       -- Active | Canceled | Forfeited — the provider's own vocabulary.
       state           VARCHAR(20)  NOT NULL DEFAULT 'Active',

       created_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at      TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_gis_freevouchers_user
       ON gis_freevouchers (user_id, created_at DESC)`,
    { transaction }
  );

  // ══════════════════════════════════════════════════════════════════════
  //  jsGamesv2 sessions
  // ══════════════════════════════════════════════════════════════════════
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS game_sessions (
       id            BIGSERIAL PRIMARY KEY,
       user_id       BIGINT       NOT NULL,
       game_uid      VARCHAR(190) NOT NULL,

       -- Issued by the provider, and the only thing tying a later callback back
       -- to the player who opened the game.
       session_token VARCHAR(190) NOT NULL UNIQUE,
       launch_url    TEXT,

       created_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at    TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_game_sessions_user
       ON game_sessions (user_id, created_at DESC)`,
    { transaction }
  );

  // ══════════════════════════════════════════════════════════════════════
  //  jsGamesv2 transactions
  // ══════════════════════════════════════════════════════════════════════
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS game_transactions (
       id                      BIGSERIAL PRIMARY KEY,
       user_id                 BIGINT       NOT NULL,
       game_uid                VARCHAR(190),

       -- bet | win | loss
       transaction_type        VARCHAR(20)  NOT NULL,
       amount                  NUMERIC(30,8) NOT NULL DEFAULT 0,
       currency                VARCHAR(10)  NOT NULL,

       -- THE idempotency key. Legacy defaulted it to the string 'unknown' when
       -- the provider omitted one, which would make every such call collide;
       -- the ported handler refuses the request instead, because a movement we
       -- cannot identify is a movement we cannot safely retry.
       external_transaction_id VARCHAR(190) NOT NULL,

       -- The ledger row this produced, so a movement traces both ways.
       ledger_id               BIGINT,

       additional_data         JSONB,
       created_at              TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at              TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
    { transaction }
  );

  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_game_transactions_external
       ON game_transactions (external_transaction_id)`,
    { transaction }
  );

  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_game_transactions_user
       ON game_transactions (user_id, created_at DESC)`,
    { transaction }
  );

  // ══════════════════════════════════════════════════════════════════════
  //  jsGames (v1): the idempotency key it never had
  // ══════════════════════════════════════════════════════════════════════

  /**
   * `serial_number` is the provider's per-callback id. Existing rows may repeat
   * it — every retry since launch was recorded as a fresh transaction AND paid
   * again — so duplicates are resolved before the index goes on.
   *
   * The OLDEST row of each group keeps the serial number. The later ones are
   * marked `superseded` rather than deleted: each is the record of money that
   * really did move, and a deleted row cannot explain a balance.
   */
  await sequelize.query(
    `ALTER TABLE js_game_transactions
       ADD COLUMN IF NOT EXISTS superseded BOOLEAN NOT NULL DEFAULT FALSE`,
    { transaction }
  );

  await sequelize.query(
    `ALTER TABLE js_game_transactions
       ADD COLUMN IF NOT EXISTS ledger_id BIGINT`,
    { transaction }
  );

  /**
   * `game_uid` is NOT NULL, and the provider does not always send one.
   *
   * A wallet callback that omits it is still a real movement — money left or
   * arrived, and the round it belonged to is recorded in `additional_data`
   * either way. With the constraint in place the INSERT throws, the handler
   * returns an error, and the provider retries forever against a payout that
   * can never be recorded. Losing the attribution is bad; losing the movement
   * is worse.
   *
   * `amount` keeps its NOT NULL: a movement with no amount is not a movement.
   */
  await sequelize.query('ALTER TABLE js_game_transactions ALTER COLUMN game_uid DROP NOT NULL', { transaction });

  const [duplicates] = await sequelize.query(
    `UPDATE js_game_transactions t
        SET superseded = TRUE
      WHERE t.serial_number IS NOT NULL
        AND t.id <> (
              SELECT MIN(x.id) FROM js_game_transactions x
               WHERE x.serial_number = t.serial_number
            )
      RETURNING t.id, t.serial_number`,
    { transaction }
  );

  if (duplicates?.length) {
    logger?.warn(
      { count: duplicates.length },
      'js_game_transactions had repeated serial numbers — every one is a provider retry that was paid twice. ' +
        'Later rows marked superseded; the money they moved is NOT reversed by this migration.'
    );
  }

  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_js_game_transactions_serial
       ON js_game_transactions (serial_number)
     WHERE serial_number IS NOT NULL AND NOT superseded`,
    { transaction }
  );

  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_js_game_transactions_user
       ON js_game_transactions (user_id, "timestamp" DESC)`,
    { transaction }
  );

  // ══════════════════════════════════════════════════════════════════════
  //  Curation tables: one row per vendor, one row per type
  // ══════════════════════════════════════════════════════════════════════

  // Same treatment — collapse to the most recently updated row, then key it.
  await sequelize.query(
    `DELETE FROM gis_prioritized_games a
      WHERE a.id <> (
              SELECT b.id FROM gis_prioritized_games b
               WHERE LOWER(b.vendor) = LOWER(a.vendor)
               ORDER BY b.updated_at DESC NULLS LAST, b.id DESC
               LIMIT 1
            )`,
    { transaction }
  );

  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_gis_prioritized_games_vendor
       ON gis_prioritized_games (LOWER(vendor))`,
    { transaction }
  );

  await sequelize.query(
    `DELETE FROM gis_prioritized_types a
      WHERE a.id <> (
              SELECT b.id FROM gis_prioritized_types b
               WHERE LOWER(TRIM(b.type)) = LOWER(TRIM(a.type))
               ORDER BY b.updated_at DESC NULLS LAST, b.id DESC
               LIMIT 1
            )`,
    { transaction }
  );

  await sequelize.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS uq_gis_prioritized_types_type
       ON gis_prioritized_types (LOWER(TRIM(type)))`,
    { transaction }
  );

  logger?.info(
    'Casino provider schema in place — 4 tables that live routes referenced but that never existed, ' +
      'plus the idempotency keys the jsGames callbacks were missing'
  );
}

async function down({ sequelize, transaction, logger }) {
  if (process.env.ALLOW_DESTRUCTIVE_MIGRATION !== 'true') {
    throw new Error(
      'Dropping these removes the ONLY duplicate detection on the jsGames wallet callbacks, and ' +
        'discards freespin, voucher and game-session records. ' +
        'Re-run with ALLOW_DESTRUCTIVE_MIGRATION=true if that is intended.'
    );
  }

  for (const sql of [
    'DROP INDEX IF EXISTS uq_gis_prioritized_types_type',
    'DROP INDEX IF EXISTS uq_gis_prioritized_games_vendor',
    'DROP INDEX IF EXISTS uq_js_game_transactions_serial',
    'DROP INDEX IF EXISTS idx_js_game_transactions_user',
    'ALTER TABLE js_game_transactions DROP COLUMN IF EXISTS superseded',
    'ALTER TABLE js_game_transactions DROP COLUMN IF EXISTS ledger_id',
    'DROP TABLE IF EXISTS game_transactions',
    'DROP TABLE IF EXISTS game_sessions',
    'DROP TABLE IF EXISTS gis_freevouchers',
    'DROP TABLE IF EXISTS gis_freespins',
  ]) {
    await sequelize.query(sql, { transaction });
  }

  logger?.warn('Dropped the casino provider schema — jsGames retries will be double-paid again');
}

module.exports = { up, down };
