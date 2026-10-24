'use strict';

/**
 * USD wager counting, and claimable affiliate commission.
 *
 * ── wager_activity ───────────────────────────────────────────────────────
 *
 * One row per stake that has moved `userwager`, keyed `(source, ref)` —
 * `inhouse:<bet id>`, `gis:<transaction id>`, `sports:<bet id>`, … The VIP
 * ladder, the bonus gates and affiliate commission are all sized in USD, so
 * `userwager.wager` is now a USD figure: each stake is converted through
 * `exchangerate` before it is added (`amount`/`currency` keep the original,
 * `usd_amount` what was counted). The unique index is what makes the count
 * exactly-once per bet whichever settlement path retries.
 *
 * ── rewards (affiliate commission) ───────────────────────────────────────
 *
 * Commission rows were written here but nothing could ever claim them — the
 * claim paths only read `unlocked_rewards`. This adds what a payable needs:
 *
 *   owner_id    the referrer's user id (names and codes are mutable)
 *   claimed     set by the conditional claim UPDATE
 *   claimed_at  when
 *   ledger_id   the credits_ledger row that paid it
 *   voided      not payable. Backfilled TRUE for every commission row that
 *               existed before this migration: they were computed from the
 *               referee's raw wager in the bet currency (₹1,000 → 50 USDT),
 *               so paying them would pay the wrong amount.
 */

async function columnExists(sequelize, transaction, table, column) {
  const { QueryTypes } = require('sequelize');
  const [row] = await sequelize.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = :table AND column_name = :column`,
    { transaction, type: QueryTypes.SELECT, replacements: { table, column } }
  );
  return Boolean(row);
}

const REWARD_COLUMNS = [
  { column: 'owner_id', ddl: 'bigint' },
  { column: 'claimed', ddl: 'boolean DEFAULT false NOT NULL' },
  { column: 'claimed_at', ddl: 'timestamp with time zone' },
  { column: 'ledger_id', ddl: 'bigint' },
  { column: 'voided', ddl: 'boolean DEFAULT false NOT NULL' },
];

async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS wager_activity (
       id          bigserial PRIMARY KEY,
       user_id     bigint NOT NULL,
       source      text NOT NULL,
       ref         text NOT NULL,
       currency    text NOT NULL,
       amount      numeric(30,8) NOT NULL,
       usd_amount  numeric(30,8) NOT NULL,
       created_at  timestamp with time zone DEFAULT now() NOT NULL
     )`,
    { transaction }
  );
  await sequelize.query(
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_wager_activity_source_ref ON wager_activity (source, ref)',
    { transaction }
  );
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_wager_activity_user_created ON wager_activity (user_id, created_at)',
    { transaction }
  );

  const added = [];
  for (const { column, ddl } of REWARD_COLUMNS) {
    if (await columnExists(sequelize, transaction, 'rewards', column)) continue;
    await sequelize.query(`ALTER TABLE rewards ADD COLUMN ${column} ${ddl}`, { transaction });
    added.push(column);
  }

  if (added.includes('voided')) {
    const [, meta] = await sequelize.query(
      "UPDATE rewards SET voided = true WHERE type = 'commission'",
      { transaction }
    );
    logger?.warn(`Voided ${meta?.rowCount ?? 0} pre-USD commission row(s) — computed from unconverted wagers`);
  }

  if (added.includes('owner_id')) {
    // The referral code is the stable key (`myRewards` matches on it); the
    // display name is the fallback for rows written without one.
    await sequelize.query(
      `UPDATE rewards r SET owner_id = u.id
         FROM users u
        WHERE r.owner_id IS NULL AND r."referalCode" IS NOT NULL AND u.referalcode = r."referalCode"`,
      { transaction }
    );
    await sequelize.query(
      `UPDATE rewards r SET owner_id = u.id
         FROM users u
        WHERE r.owner_id IS NULL AND u.name = r.ownername`,
      { transaction }
    );
  }

  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_rewards_owner_unclaimed ON rewards (owner_id) WHERE claimed = false AND voided = false',
    { transaction }
  );

  logger?.info('wager_activity created; rewards made claimable');
}

async function down({ sequelize, transaction, logger }) {
  await sequelize.query('DROP INDEX IF EXISTS idx_rewards_owner_unclaimed', { transaction });
  for (const { column } of REWARD_COLUMNS) {
    await sequelize.query(`ALTER TABLE rewards DROP COLUMN IF EXISTS ${column}`, { transaction });
  }
  await sequelize.query('DROP TABLE IF EXISTS wager_activity', { transaction });
  logger?.warn('Dropped wager_activity and the rewards claim columns');
}

module.exports = { up, down };
