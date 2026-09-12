'use strict';

/**
 * Proper session storage for refresh tokens.
 *
 * The legacy `tokens` table is `(uid, key)` — no expiry, no revocation, no
 * device record. That is enough to say "this token exists" and nothing else:
 * you cannot log out one device, expire an old session, or show a player where
 * they are signed in.
 *
 * `auth_sessions` replaces it for new logins. Refresh tokens are stored as a
 * SHA-256 hash, so a database leak cannot be replayed against the API.
 * The legacy table is left untouched for anything still reading it.
 */

async function up({ queryInterface, sequelize, transaction }) {
  const { DataTypes } = require('sequelize');

  await queryInterface.createTable(
    'auth_sessions',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false },
      user_id: { type: DataTypes.BIGINT, allowNull: false },

      // SHA-256 of the refresh token. Unique, so a replayed token is detectable.
      token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },

      // Rotation chain: when a refresh token is used, the new session records
      // which one replaced it. A reused old token then proves theft.
      replaced_by: { type: DataTypes.BIGINT, allowNull: true },

      ip_address: { type: DataTypes.STRING(64), allowNull: true },
      user_agent: { type: DataTypes.STRING(512), allowNull: true },
      device_label: { type: DataTypes.STRING(120), allowNull: true },

      expires_at: { type: DataTypes.DATE, allowNull: false },
      revoked_at: { type: DataTypes.DATE, allowNull: true },
      revoked_reason: { type: DataTypes.STRING(64), allowNull: true },
      last_used_at: { type: DataTypes.DATE, allowNull: true },

      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('now()') },
      updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('now()') },
    },
    { transaction }
  );

  await queryInterface.addIndex('auth_sessions', ['user_id'], { name: 'idx_auth_sessions_user', transaction });
  await queryInterface.addIndex('auth_sessions', ['expires_at'], { name: 'idx_auth_sessions_expires', transaction });

  // Partial index: session lookups only ever care about live sessions, and the
  // revoked rows are kept for audit. Indexing only the live ones keeps it small.
  await sequelize.query(
    `CREATE INDEX IF NOT EXISTS idx_auth_sessions_active
       ON auth_sessions (user_id, expires_at)
     WHERE revoked_at IS NULL`,
    { transaction }
  );

  // ── Login throttling state ──────────────────────────────────────────
  // Failed-attempt counters live in their own table rather than on `users`,
  // so a brute-force attempt writes to a small hot table instead of dirtying
  // the wide user row on every wrong password.
  await queryInterface.createTable(
    'auth_login_attempts',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false },
      // Email or username as submitted — the account may not even exist.
      identifier: { type: DataTypes.STRING(190), allowNull: false },
      ip_address: { type: DataTypes.STRING(64), allowNull: true },
      successful: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      failure_reason: { type: DataTypes.STRING(64), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('now()') },
    },
    { transaction }
  );

  await queryInterface.addIndex('auth_login_attempts', ['identifier', 'created_at'], {
    name: 'idx_login_attempts_identifier',
    transaction,
  });
  await queryInterface.addIndex('auth_login_attempts', ['ip_address', 'created_at'], {
    name: 'idx_login_attempts_ip',
    transaction,
  });

  // ── Password reset + email verification ─────────────────────────────
  await queryInterface.createTable(
    'auth_verification_tokens',
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false },
      user_id: { type: DataTypes.BIGINT, allowNull: false },
      // 'password_reset' | 'email_verify'
      purpose: { type: DataTypes.STRING(32), allowNull: false },
      token_hash: { type: DataTypes.STRING(64), allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      consumed_at: { type: DataTypes.DATE, allowNull: true },
      created_ip: { type: DataTypes.STRING(64), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('now()') },
    },
    { transaction }
  );

  await queryInterface.addIndex('auth_verification_tokens', ['token_hash'], {
    name: 'idx_verification_token_hash',
    unique: true,
    transaction,
  });
  await queryInterface.addIndex('auth_verification_tokens', ['user_id', 'purpose'], {
    name: 'idx_verification_user_purpose',
    transaction,
  });
}

async function down({ queryInterface, transaction }) {
  await queryInterface.dropTable('auth_verification_tokens', { transaction });
  await queryInterface.dropTable('auth_login_attempts', { transaction });
  await queryInterface.dropTable('auth_sessions', { transaction });
}

module.exports = { up, down };
