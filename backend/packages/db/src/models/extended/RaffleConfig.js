'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 164 (rainbet).
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/** The raffle settings, one row — see migration 164. */
class RaffleConfig extends Model {}

module.exports = (sequelize) => {
  RaffleConfig.init(
    {
      id: { type: DataTypes.SMALLINT, primaryKey: true, allowNull: false, field: 'id' },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, field: 'enabled' },
      prize_pool_usd: { type: DataTypes.DECIMAL(20, 2), allowNull: false, field: 'prize_pool_usd' },
      winners: { type: DataTypes.INTEGER, allowNull: false, field: 'winners' },
      wager_per_ticket_usd: { type: DataTypes.DECIMAL(20, 2), allowNull: false, field: 'wager_per_ticket_usd' },
      updated_at: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
    },
    {
      sequelize,
      modelName: 'RaffleConfig',
      tableName: 'raffle_config',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return RaffleConfig;
};
