'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 001-auth-sessions.
// Domain: extended/core — owned by user-service.

const { Model, DataTypes, Op } = require('sequelize');

/**
 * Single-use tokens for password reset and email verification.
 *
 * Stored hashed and marked `consumed_at` the moment they are redeemed, inside
 * the same transaction as the password change — so a token intercepted in
 * flight cannot be redeemed a second time.
 */
class AuthVerificationToken extends Model {
  static PURPOSES = { PASSWORD_RESET: 'password_reset', EMAIL_VERIFY: 'email_verify' };

  get isUsable() {
    return !this.consumed_at && this.expires_at instanceof Date && this.expires_at.getTime() > Date.now();
  }
}

module.exports = (sequelize) => {
  AuthVerificationToken.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      purpose: { type: DataTypes.STRING(32), allowNull: false, field: 'purpose' },
      token_hash: { type: DataTypes.STRING(64), allowNull: false, field: 'token_hash' },
      expires_at: { type: DataTypes.DATE, allowNull: false, field: 'expires_at' },
      consumed_at: { type: DataTypes.DATE, allowNull: true, field: 'consumed_at' },
      created_ip: { type: DataTypes.STRING(64), allowNull: true, field: 'created_ip' },
    },
    {
      sequelize,
      modelName: 'AuthVerificationToken',
      tableName: 'auth_verification_tokens',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      scopes: {
        usable: { where: { consumed_at: null, expires_at: { [Op.gt]: new Date() } } },
      },
      indexes: [
        { name: 'idx_verification_token_hash', fields: ['token_hash'], unique: true },
        { name: 'idx_verification_user_purpose', fields: ['user_id', 'purpose'] },
      ],
    }
  );

  return AuthVerificationToken;
};
