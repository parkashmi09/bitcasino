'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 016.
// Domain: extended/casino — owned by casino-service.

const { Model, DataTypes } = require('sequelize');

/**
 * A jsGamesv2 wallet movement.
 *
 * RECONSTRUCTED. `game_transactions` was referenced by
 * `POST /jsGamesv2/bet-callback` and never existed.
 *
 * That absence is the only reason the endpoint was not catastrophic: it took
 * the player's new balance from the request body, unauthenticated and
 * unsigned, and the missing table made the INSERT throw before the UPDATE ran.
 * The ported handler derives the balance from the movement, so the table
 * existing changes nothing about who may write one.
 *
 * `external_transaction_id` is unique — the idempotency the callback never had.
 */
class GameTransaction extends Model {}

module.exports = (sequelize) => {
  GameTransaction.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      game_uid: { type: DataTypes.STRING(190), allowNull: true, field: 'game_uid' },
      /** bet | win | loss */
      transaction_type: { type: DataTypes.STRING(20), allowNull: false, field: 'transaction_type' },
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'amount' },
      currency: { type: DataTypes.STRING(10), allowNull: false, field: 'currency' },
      /** The provider's id for this movement — THE idempotency key. */
      external_transaction_id: {
        type: DataTypes.STRING(190),
        allowNull: false,
        field: 'external_transaction_id',
      },
      ledger_id: { type: DataTypes.BIGINT, allowNull: true, field: 'ledger_id' },
      additional_data: { type: DataTypes.JSONB, allowNull: true, field: 'additional_data' },
    },
    {
      sequelize,
      modelName: 'GameTransaction',
      tableName: 'game_transactions',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
  );

  return GameTransaction;
};
