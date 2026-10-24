'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 017.
// Domain: extended/casino — owned by casino-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A settlement from one of the three remaining casino aggregators.
 *
 * `(aggregator, transaction_id)` is unique — the duplicate detection none of
 * the three had. See migration 017 for why this exists rather than the three
 * legacy tables, two of which store money in BIGINT columns.
 */
class AggregatorTransaction extends Model {}

module.exports = (sequelize) => {
  AggregatorTransaction.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      /** asia | nexus | evo */
      aggregator: { type: DataTypes.STRING(20), allowNull: false, field: 'aggregator' },
      /** The provider's id for this movement — THE idempotency key. */
      transaction_id: { type: DataTypes.STRING(190), allowNull: false, field: 'transaction_id' },
      action: { type: DataTypes.STRING(20), allowNull: false, field: 'action' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      member_account: { type: DataTypes.STRING(120), allowNull: true, field: 'member_account' },
      currency: { type: DataTypes.STRING(10), allowNull: false, field: 'currency' },
      stake: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'stake' },
      payout: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'payout' },
      /** Signed net: payout - stake. What actually moved. */
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'amount' },
      game_code: { type: DataTypes.STRING(190), allowNull: true, field: 'game_code' },
      provider_code: { type: DataTypes.STRING(120), allowNull: true, field: 'provider_code' },
      round_id: { type: DataTypes.STRING(190), allowNull: true, field: 'round_id' },
      ledger_id: { type: DataTypes.BIGINT, allowNull: true, field: 'ledger_id' },
      payload: { type: DataTypes.JSONB, allowNull: true, field: 'payload' },
    },
    {
      sequelize,
      modelName: 'AggregatorTransaction',
      tableName: 'aggregator_transactions',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
    }
  );

  return AggregatorTransaction;
};
