'use strict';

/**
 * Indexes for the staff IP tracker (`GET /admin/reports/ip-tracker`).
 *
 * The existing indexes lead on `user_id`, which serves one player's history and
 * nothing else. The tracker reads across ALL players:
 *
 *   - the login feed is newest first over the whole table → `created_at DESC`;
 *   - the shared-IP check groups by address and counts distinct accounts, and
 *     the IP filter is an exact or prefix match → `(ip_address, user_id)`.
 *     `text_pattern_ops` so `LIKE '10.0.%'` can use it under any collation.
 */
async function up({ sequelize, transaction, logger }) {
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_user_login_history_created ON user_login_history (created_at DESC)',
    { transaction }
  );
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS idx_user_login_history_ip_user ON user_login_history (ip_address text_pattern_ops, user_id)',
    { transaction }
  );
  logger?.info('user_login_history indexed by time and by IP');
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS idx_user_login_history_ip_user', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS idx_user_login_history_created', { transaction });
}

module.exports = { up, down };
