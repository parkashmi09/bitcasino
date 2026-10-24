'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 069-player-bank-accounts.
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * One payout account a player has saved: a bank account (number + IFSC) or a
 * UPI id, never half of each. Why this is not the admin's bank-details table,
 * and the default / duplicate rules, are at the head of the migration.
 */
class UserBankAccount extends Model {}

module.exports = (sequelize) => {
  UserBankAccount.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      /** 'bank' or 'upi' — the withdraw form's two routes. */
      method: { type: DataTypes.STRING(10), allowNull: false, field: 'method' },
      account_holder_name: { type: DataTypes.STRING(255), allowNull: false, field: 'account_holder_name' },
      bank_name: { type: DataTypes.STRING(255), allowNull: true, field: 'bank_name' },
      account_number: { type: DataTypes.STRING(34), allowNull: true, field: 'account_number' },
      ifsc_code: { type: DataTypes.STRING(11), allowNull: true, field: 'ifsc_code' },
      upi_id: { type: DataTypes.STRING(255), allowNull: true, field: 'upi_id' },
      is_default: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_default' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
      updated_at: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
    },
    {
      sequelize,
      modelName: 'UserBankAccount',
      tableName: 'user_bank_accounts',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
      indexes: [{ name: 'idx_user_bank_accounts_user', fields: ['user_id', 'created_at'] }],
    }
  );

  return UserBankAccount;
};
