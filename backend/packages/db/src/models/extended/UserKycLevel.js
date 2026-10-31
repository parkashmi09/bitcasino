'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 167 (rainbet).
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/** One KYC Level 3 / 4 submission — see migration 167. */
class UserKycLevel extends Model {}

module.exports = (sequelize) => {
  UserKycLevel.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      level: { type: DataTypes.SMALLINT, allowNull: false, field: 'level' },
      document_path: { type: DataTypes.STRING(200), allowNull: false, field: 'document_path' },
      status: { type: DataTypes.STRING(10), allowNull: false, field: 'status' },
      rejection_reason: { type: DataTypes.STRING(500), allowNull: true, field: 'rejection_reason' },
      reviewed_by: { type: DataTypes.BIGINT, allowNull: true, field: 'reviewed_by' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
      reviewed_at: { type: DataTypes.DATE, allowNull: true, field: 'reviewed_at' },
    },
    {
      sequelize,
      modelName: 'UserKycLevel',
      tableName: 'user_kyc_levels',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return UserKycLevel;
};
