'use strict';

/**
 * Idle logout (owner, 2026-11-11): `users.socket_disconnected_at` — when the player's last socket
 * to the site closed (screen off, phone locked, tab closed); NULL while one is connected. The
 * user-worker signs out every player whose time is 10 minutes old (auth `idleLogoutSweep`).
 */
async function up({ sequelize, transaction }) {
  await sequelize.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS socket_disconnected_at TIMESTAMPTZ', { transaction });
  await sequelize.query(
    'CREATE INDEX IF NOT EXISTS users_socket_disconnected_idx ON users (socket_disconnected_at) WHERE socket_disconnected_at IS NOT NULL',
    { transaction }
  );
}

async function down({ sequelize, transaction }) {
  await sequelize.query('DROP INDEX IF EXISTS users_socket_disconnected_idx', { transaction });
  await sequelize.query('ALTER TABLE users DROP COLUMN IF EXISTS socket_disconnected_at', { transaction });
}

module.exports = { up, down };
