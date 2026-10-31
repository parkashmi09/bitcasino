'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 164 (rainbet).
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/** One raffle ticket — see migration 164. */
class RaffleTicket extends Model {}

module.exports = (sequelize) => {
  RaffleTicket.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      draw_number: { type: DataTypes.INTEGER, allowNull: false, field: 'draw_number' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      ticket_number: { type: DataTypes.INTEGER, allowNull: false, field: 'ticket_number' },
      source: { type: DataTypes.STRING(5), allowNull: false, field: 'source' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'RaffleTicket',
      tableName: 'raffle_tickets',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return RaffleTicket;
};
