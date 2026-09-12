'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 001-auth-sessions.
// Domain: extended/core — owned by user-service.

const { Model, DataTypes, Op } = require('sequelize');

/**
 * One row per active login. The refresh token itself is never stored — only its
 * SHA-256 hash — so the table is useless to anyone who steals a database dump.
 */
class AuthSession extends Model {
  get isExpired() {
    return this.expires_at instanceof Date && this.expires_at.getTime() <= Date.now();
  }

  get isRevoked() {
    return this.revoked_at !== null && this.revoked_at !== undefined;
  }

  get isUsable() {
    return !this.isExpired && !this.isRevoked;
  }
}

module.exports = (sequelize) => {
  AuthSession.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: 'token_hash' },
      replaced_by: { type: DataTypes.BIGINT, allowNull: true, field: 'replaced_by' },
      ip_address: { type: DataTypes.STRING(64), allowNull: true, field: 'ip_address' },
      user_agent: { type: DataTypes.STRING(512), allowNull: true, field: 'user_agent' },
      device_label: { type: DataTypes.STRING(120), allowNull: true, field: 'device_label' },
      expires_at: { type: DataTypes.DATE, allowNull: false, field: 'expires_at' },
      revoked_at: { type: DataTypes.DATE, allowNull: true, field: 'revoked_at' },
      revoked_reason: { type: DataTypes.STRING(64), allowNull: true, field: 'revoked_reason' },
      last_used_at: { type: DataTypes.DATE, allowNull: true, field: 'last_used_at' },
    },
    {
      sequelize,
      modelName: 'AuthSession',
      tableName: 'auth_sessions',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      // The hash is a credential equivalent: never select it unless a lookup
      // explicitly asks for it.
      defaultScope: { attributes: { exclude: ['token_hash'] } },
      scopes: {
        withHash: {},
        active: { where: { revoked_at: null, expires_at: { [Op.gt]: new Date() } } },
      },
      indexes: [
        { name: 'idx_auth_sessions_user', fields: ['user_id'] },
        { name: 'idx_auth_sessions_expires', fields: ['expires_at'] },
      ],
    }
  );

  return AuthSession;
};
