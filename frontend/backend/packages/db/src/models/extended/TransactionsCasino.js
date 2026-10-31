'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 028.
// Domain: extended — written and read by casino-service.

const { Model, DataTypes } = require('sequelize');

/**
 * One XGaming / GamingHub360 transaction.
 *
 * The table legacy read and wrote in four places and nobody ever created — so
 * every one of those calls threw, the changebalance handler's catch turned it
 * into "Internal server error", and the balance had ALREADY moved by then.
 * See migration 028.
 */
class TransactionsCasino extends Model {}

module.exports = (sequelize) => {
  TransactionsCasino.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      /** The provider's id. UNIQUE — this is the idempotency key. */
      transaction_id: { type: DataTypes.STRING(120), allowNull: false, field: 'transaction_id' },
      round_id: { type: DataTypes.STRING(120), allowNull: true, field: 'round_id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      session: { type: DataTypes.STRING(255), allowNull: true, field: 'session' },
      /** BET | WIN | REFUND */
      transaction_type: { type: DataTypes.STRING(20), allowNull: false, field: 'transaction_type' },
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'amount' },
      currency_code: { type: DataTypes.STRING(20), allowNull: true, field: 'currency_code' },
      /** The wallet column the money moved on, resolved from a fixed map. */
      wallet: { type: DataTypes.STRING(20), allowNull: true, field: 'wallet' },
      transaction_timestamp: { type: DataTypes.DATE, allowNull: true, field: 'transaction_timestamp' },
      reason: { type: DataTypes.TEXT, allowNull: true, field: 'reason' },
      round_finished: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'round_finished' },
      transaction_status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'OK', field: 'transaction_status' },
      /** So a disputed round can be reconstructed. Legacy stored neither. */
      balance_before: { type: DataTypes.DECIMAL(30, 8), allowNull: true, field: 'balance_before' },
      balance_after: { type: DataTypes.DECIMAL(30, 8), allowNull: true, field: 'balance_after' },
      game_id: { type: DataTypes.STRING(120), allowNull: true, field: 'game_id' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
      updated_at: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
    },
    {
      sequelize,
      modelName: 'TransactionsCasino',
      tableName: 'transactionscasino',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return TransactionsCasino;
};
