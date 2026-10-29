'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 165 (rainbet).
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/** One reload reward claimed — see migration 165. */
class ReloadClaim extends Model {}

module.exports = (sequelize) => {
  ReloadClaim.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      program: { type: DataTypes.STRING(16), allowNull: false, field: 'program' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      period_key: { type: DataTypes.STRING(10), allowNull: false, field: 'period_key' },
      wagered_usd: { type: DataTypes.DECIMAL(30, 8), allowNull: false, field: 'wagered_usd' },
      amount_usd: { type: DataTypes.DECIMAL(30, 8), allowNull: false, field: 'amount_usd' },
      currency: { type: DataTypes.STRING(20), allowNull: false, field: 'currency' },
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, field: 'amount' },
      ledger_id: { type: DataTypes.BIGINT, allowNull: true, field: 'ledger_id' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'ReloadClaim',
      tableName: 'reload_claims',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return ReloadClaim;
};
