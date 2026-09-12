'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 015.
// Domain: extended/casino — owned by casino-service.

const { Model, DataTypes } = require('sequelize');

/**
 * Every money instruction the casino provider has sent.
 *
 * The unique index on (transaction_id, action) is the duplicate detection the
 * legacy integration did not have — its check was a stub returning `false`, so
 * every provider retry was paid again. See migration 015.
 */
class SeamlessTransaction extends Model {}

module.exports = (sequelize) => {
  SeamlessTransaction.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      /** The provider's id for this movement — the idempotency key. */
      transaction_id: { type: DataTypes.STRING(190), allowNull: false, field: 'transaction_id' },
      action: { type: DataTypes.STRING(20), allowNull: false, field: 'action' },
      member_account: { type: DataTypes.STRING(120), allowNull: false, field: 'member_account' },
      user_id: { type: DataTypes.BIGINT, allowNull: true, field: 'user_id' },
      operator_code: { type: DataTypes.STRING(60), allowNull: true, field: 'operator_code' },
      product_code: { type: DataTypes.STRING(60), allowNull: true, field: 'product_code' },
      game_code: { type: DataTypes.STRING(120), allowNull: true, field: 'game_code' },
      round_id: { type: DataTypes.STRING(190), allowNull: true, field: 'round_id' },
      currency: { type: DataTypes.STRING(10), allowNull: false, field: 'currency' },
      /** As quoted by the provider, before the thousands scaling. */
      provider_amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'provider_amount' },
      /** What actually moved, in the settlement currency. */
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'amount' },
      ledger_id: { type: DataTypes.BIGINT, allowNull: true, field: 'ledger_id' },
      /** For a rollback or cancel: the transaction being reversed. */
      reverses_id: { type: DataTypes.STRING(190), allowNull: true, field: 'reverses_id' },
      payload: { type: DataTypes.JSONB, allowNull: true, field: 'payload' },
    },
    {
      sequelize,
      modelName: 'SeamlessTransaction',
      tableName: 'seamless_transactions',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return SeamlessTransaction;
};
