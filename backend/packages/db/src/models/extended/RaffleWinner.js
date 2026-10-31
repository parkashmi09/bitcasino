'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 164 (rainbet).
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/** One winning ticket and its prize — see migration 164. */
class RaffleWinner extends Model {}

module.exports = (sequelize) => {
  RaffleWinner.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      draw_number: { type: DataTypes.INTEGER, allowNull: false, field: 'draw_number' },
      ticket_id: { type: DataTypes.BIGINT, allowNull: false, field: 'ticket_id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      prize_usd: { type: DataTypes.DECIMAL(20, 2), allowNull: false, field: 'prize_usd' },
      currency: { type: DataTypes.STRING(20), allowNull: true, field: 'currency' },
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: true, field: 'amount' },
      ledger_id: { type: DataTypes.BIGINT, allowNull: true, field: 'ledger_id' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'RaffleWinner',
      tableName: 'raffle_winners',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return RaffleWinner;
};
