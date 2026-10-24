'use strict';

/**
 * Reversals that reach everything a stake paid for — partially, exactly once, and retried.
 *
 * ── rewards.source / rewards.ref ─────────────────────────────────────────
 *
 * An affiliate commission row is written for ONE counted stake (the USD delta that stake
 * added to `userwager`), but nothing tied it back to that stake, so a refund / rollback /
 * sports void (`POST /internal/user/wager/reverse`) could not find it. The stake's
 * `(source, ref)` from `wager_activity` is stored on the row now; a reversal voids the
 * matching UNCLAIMED row (already-claimed commission is not clawed back). Older rows stay
 * NULL and are never matched.
 *
 * ── reversed_amount (wager_activity, rakeback_accruals, player_bonus_wagers, rewards) ──
 *
 * A provider can refund PART of a stake. `wager_activity.reversed_amount` is the
 * cumulative refunded stake (in the stake's currency), so several partial refunds add up
 * and can never exceed the stake; `reversed_at` is stamped only once it is fully reversed.
 * On each per-stake item (rakeback accrual, bonus wagering allocation, commission row)
 * `amount` stays what still counts and `reversed_amount` what was taken back out, so the
 * original is always `amount + reversed_amount` and a reversal can set the item to its
 * exact pro-rated target (idempotent, order-independent).
 *
 * ── wager_reversals ──────────────────────────────────────────────────────
 *
 * One row per applied reversal. `(source, ref, refund_ref)` is unique: the same provider
 * refund id twice is a duplicate. A full reversal without a refund id has a NULL
 * `refund_ref` (it is exactly-once through `wager_activity.reversed_at`).
 *
 * ── wager_reverse_outbox ─────────────────────────────────────────────────
 *
 * sports-service (void after settlement) and casino-service (GIS refund / rollback) call the
 * reverse route AFTER their own commit, best-effort. A failed call used to be logged and
 * lost — the stake kept counting toward VIP, rakeback, commission and bonus wagering. It is
 * written here instead and the user-service worker (`wager:reverse-outbox`) retries it with
 * backoff until it succeeds (the reverse is idempotent) or gives up after N attempts.
 */

const ITEM_TABLES = ['wager_activity', 'rakeback_accruals', 'player_bonus_wagers', 'rewards'];

async function up({ sequelize, transaction, logger }) {
  await sequelize.query('ALTER TABLE rewards ADD COLUMN IF NOT EXISTS source text', { transaction });
  await sequelize.query('ALTER TABLE rewards ADD COLUMN IF NOT EXISTS ref text', { transaction });
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_rewards_source_ref ON rewards (source, ref) WHERE source IS NOT NULL',
    { transaction }
  );

  for (const table of ITEM_TABLES) {
    await sequelize.query(
      `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS reversed_amount numeric(30,8) DEFAULT 0 NOT NULL`,
      { transaction }
    );
  }
  // Stakes reversed before this migration were reversed in full.
  await sequelize.query(
    'UPDATE wager_activity SET reversed_amount = amount WHERE reversed_at IS NOT NULL AND reversed_amount = 0',
    { transaction }
  );

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS wager_reversals (
       id          bigserial PRIMARY KEY,
       user_id     bigint NOT NULL,
       source      text NOT NULL,
       ref         text NOT NULL,
       refund_ref  text,
       amount      numeric(30,8) NOT NULL,
       usd_amount  numeric(30,8) NOT NULL,
       created_at  timestamp with time zone DEFAULT now() NOT NULL
     )`,
    { transaction }
  );
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_wager_reversals_refund ON wager_reversals (source, ref, refund_ref)',
    { transaction }
  );

  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS wager_reverse_outbox (
       id               bigserial PRIMARY KEY,
       origin           text NOT NULL,
       user_id          bigint NOT NULL,
       source           text NOT NULL,
       ref              text NOT NULL,
       amount           numeric(30,8),
       refund_ref       text NOT NULL DEFAULT '',
       status           text NOT NULL DEFAULT 'pending',
       attempts         integer NOT NULL DEFAULT 0,
       next_attempt_at  timestamp with time zone DEFAULT now() NOT NULL,
       last_error       text,
       created_at       timestamp with time zone DEFAULT now() NOT NULL,
       updated_at       timestamp with time zone DEFAULT now() NOT NULL,
       done_at          timestamp with time zone
     )`,
    { transaction }
  );
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_wager_reverse_outbox_key ON wager_reverse_outbox (source, ref, refund_ref)',
    { transaction }
  );
  await sequelize.query(
    "CREATE INDEX IF NOT EXISTS idx_wager_reverse_outbox_due ON wager_reverse_outbox (next_attempt_at) WHERE status = 'pending'",
    { transaction }
  );

  logger?.info('rewards linked to stakes; partial reversals and the reverse outbox added');
}

async function down({ sequelize, transaction, logger }) {
  await sequelize.query('DROP TABLE IF EXISTS wager_reverse_outbox', { transaction });
  await sequelize.query('DROP TABLE IF EXISTS wager_reversals', { transaction });
  for (const table of ITEM_TABLES) {
    await sequelize.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS reversed_amount`, { transaction });
  }
  await sequelize.query('DROP INDEX IF EXISTS idx_rewards_source_ref', { transaction });
  await sequelize.query('ALTER TABLE rewards DROP COLUMN IF EXISTS ref', { transaction });
  await sequelize.query('ALTER TABLE rewards DROP COLUMN IF EXISTS source', { transaction });
  logger?.warn('Dropped the reversal links, wager_reversals and wager_reverse_outbox');
}

module.exports = { up, down };
