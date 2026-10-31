'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 039.
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/**
 * One withdrawal address a player has approved.
 *
 * Unique per `(user_id, currency, address)` and NOT per `(user_id, address)`:
 * the same string can be a valid address on more than one chain. The argument
 * in full, including why the address is not format-checked here and why the
 * master switch lives on `users`, is at the head of migration 039.
 */
class UserWithdrawalWhitelist extends Model {}

module.exports = (sequelize) => {
  UserWithdrawalWhitelist.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      /** The player's own name for it. Free text, not part of the key. */
      label: { type: DataTypes.STRING(60), allowNull: false, field: 'label' },
      currency: { type: DataTypes.STRING(20), allowNull: false, field: 'currency' },
      /** Null where the currency has one chain and there is nothing to say. */
      network: { type: DataTypes.STRING(40), allowNull: true, field: 'network' },
      address: { type: DataTypes.STRING(190), allowNull: false, field: 'address' },
      /** Destination tag / memo — required by some chains, absent on most. */
      memo: { type: DataTypes.STRING(120), allowNull: true, field: 'memo' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
      updated_at: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
    },
    {
      sequelize,
      modelName: 'UserWithdrawalWhitelist',
      tableName: 'user_withdrawal_whitelist',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
      indexes: [
        { name: 'user_withdrawal_whitelist_uniq', fields: ['user_id', 'currency', 'address'], unique: true },
        { name: 'idx_user_withdrawal_whitelist_user', fields: ['user_id', 'created_at'] },
      ],
    }
  );

  return UserWithdrawalWhitelist;
};
