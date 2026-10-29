'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 164 (rainbet).
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/** One weekly draw, keyed by its number — see migration 164. */
class RaffleDraw extends Model {}

module.exports = (sequelize) => {
  RaffleDraw.init(
    {
      number: { type: DataTypes.INTEGER, primaryKey: true, allowNull: false, field: 'number' },
      starts_at: { type: DataTypes.DATE, allowNull: false, field: 'starts_at' },
      draw_at: { type: DataTypes.DATE, allowNull: false, field: 'draw_at' },
      status: { type: DataTypes.STRING(8), allowNull: false, field: 'status' },
      prize_pool_usd: { type: DataTypes.DECIMAL(20, 2), allowNull: false, field: 'prize_pool_usd' },
      winners: { type: DataTypes.INTEGER, allowNull: false, field: 'winners' },
      wager_per_ticket_usd: { type: DataTypes.DECIMAL(20, 2), allowNull: false, field: 'wager_per_ticket_usd' },
      ticket_count: { type: DataTypes.INTEGER, allowNull: true, field: 'ticket_count' },
      drawn_at: { type: DataTypes.DATE, allowNull: true, field: 'drawn_at' },
    },
    {
      sequelize,
      modelName: 'RaffleDraw',
      tableName: 'raffle_draws',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return RaffleDraw;
};
