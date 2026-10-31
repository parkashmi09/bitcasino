'use strict';

/**
 * `auth_sessions.last_activity_at`: the player's last interaction with the site on this session
 * (sign-in, or the player site's `POST /user/auth/activity` heartbeat; a refresh carries it over).
 * Read by idle logout (user-service AuthService.idleCheck and the user-worker sweep). NULL on rows
 * from before this column: the sweep reads those as their `created_at`.
 * The partial index is the sweep's scan of live chain heads; `replaced_by` is its walk back up a chain.
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ', { transaction });
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_auth_sessions_live_activity ON auth_sessions (last_activity_at)
      WHERE revoked_at IS NULL AND replaced_by IS NULL`,
    { transaction }
  );
  await sequelize.query('CREATE INDEX IF NOT EXISTS idx_auth_sessions_replaced_by ON auth_sessions (replaced_by)', { transaction });
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS idx_auth_sessions_replaced_by', { transaction });
  await sequelize.query('DROP INDEX IF EXISTS idx_auth_sessions_live_activity', { transaction });
  await sequelize.query('ALTER TABLE auth_sessions DROP COLUMN IF EXISTS last_activity_at', { transaction });
}

module.exports = { up, down };
