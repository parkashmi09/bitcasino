'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 019.
// Domain: extended/club — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A device push token.
 *
 * RECONSTRUCTED. `user_fcm_tokens` was referenced by mounted routes and never existed.
 */
class UserFcmToken extends Model {}

module.exports = (sequelize) => {
  UserFcmToken.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      token: { type: DataTypes.TEXT, allowNull: false, field: 'token' },
      platform: { type: DataTypes.STRING(20), allowNull: true, field: 'platform' },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    },
    {
      sequelize,
      modelName: 'UserFcmToken',
      tableName: 'user_fcm_tokens',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return UserFcmToken;
};
