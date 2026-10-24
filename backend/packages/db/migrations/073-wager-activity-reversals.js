'use strict';

/**
 * `wager_activity.reversed_at` — a refunded or rolled-back stake stops counting.
 *
 * A stake is counted when the bet is taken (migration 071). When the provider
 * later refunds or rolls that bet back (GIS refund/rollback, x-casino cancel,
 * seamless rollback/cancel, an in-house refund), the turnover never happened,
 * so `POST /internal/user/wager/reverse` takes its USD back out of
 * `userwager` and stamps the row here. The row stays: its `(source, ref)` is
 * what stops a late or retried bet callback from counting it again. A reversal
 * that arrives BEFORE its bet writes a zero "tombstone" row with this stamp for
 * the same reason.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query(
    'ALTER TABLE wager_activity ADD COLUMN IF NOT EXISTS reversed_at timestamp with time zone',
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE wager_activity DROP COLUMN IF EXISTS reversed_at', { transaction });
}

module.exports = { up, down };
