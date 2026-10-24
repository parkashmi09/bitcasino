'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 150-f2pay-deposits.
// Domain: extended/payments — owned by user-service.

const { Model, DataTypes } = require('sequelize');

/** One F2Pay INR deposit order. `mch_order_no` is our reference; the PSP callback settles it. */
class F2payDeposits extends Model {}

module.exports = (sequelize) => {
  F2payDeposits.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      mch_order_no: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: 'mch_order_no' },
      plat_no: { type: DataTypes.STRING(64), allowNull: true, field: 'plat_no' },
      amount: { type: DataTypes.DECIMAL(20, 8), allowNull: false, field: 'amount' },
      currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'INR', field: 'currency' },
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'Pending', field: 'status' },
      utr_number: { type: DataTypes.STRING(64), allowNull: true, field: 'utr_number' },
      error_reason: { type: DataTypes.TEXT, allowNull: true, field: 'error_reason' },
    },
    {
      sequelize,
      modelName: 'F2payDeposits',
      tableName: 'f2paydeposits',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return F2payDeposits;
};
