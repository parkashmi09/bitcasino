'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 130. Domain: extended — written by
// casino-service's original-games module (raw SQL); read here for the bet history.

const { Model, DataTypes } = require('sequelize');

/** One Original Games aggregator wallet movement: `kind` bet | win | rollback, `amount` unsigned. */
class OgTransactions extends Model {}

module.exports = (sequelize) => {
  OgTransactions.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      transaction_id: { type: DataTypes.TEXT, allowNull: false, field: 'transaction_id' },
      kind: { type: DataTypes.TEXT, allowNull: false, field: 'kind' },
      status: { type: DataTypes.TEXT, allowNull: false, field: 'status' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      session_id: { type: DataTypes.TEXT, allowNull: true, field: 'session_id' },
      round_id: { type: DataTypes.TEXT, allowNull: true, field: 'round_id' },
      game_code: { type: DataTypes.TEXT, allowNull: true, field: 'game_code' },
      currency: { type: DataTypes.TEXT, allowNull: false, field: 'currency' },
      amount: { type: DataTypes.DECIMAL(24, 8), allowNull: false, field: 'amount' },
      reference_transaction_id: { type: DataTypes.TEXT, allowNull: true, field: 'reference_transaction_id' },
      balance_after: { type: DataTypes.DECIMAL(24, 8), allowNull: true, field: 'balance_after' },
    },
    {
      sequelize,
      modelName: 'OgTransactions',
      tableName: 'og_transactions',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );
  return OgTransactions;
};
