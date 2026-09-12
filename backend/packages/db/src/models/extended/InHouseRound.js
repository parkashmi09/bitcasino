'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 030.
// Domain: extended — written and read by casino-service.

const { Model, DataTypes } = require('sequelize');

/**
 * One in-flight multi-step game round.
 *
 * Replaces legacy's in-process `General/Queue`, which lost every open round on
 * restart and could not be read by a second cluster worker. See migration 030.
 */
class InHouseRound extends Model {}

module.exports = (sequelize) => {
  InHouseRound.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      bet_id: { type: DataTypes.BIGINT, allowNull: false, field: 'bet_id' },
      user_id: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
      game: { type: DataTypes.STRING(40), allowNull: false, field: 'game' },
      coin: { type: DataTypes.STRING(20), allowNull: false, field: 'coin' },
      amount: { type: DataTypes.DECIMAL(30, 8), allowNull: false, field: 'amount' },
      /** The drawn outcome, hidden from the player until the round ends. */
      state: { type: DataTypes.JSONB, allowNull: false, field: 'state' },
      selected: { type: DataTypes.JSONB, allowNull: false, defaultValue: [], field: 'selected' },
      steps: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'steps' },
      profit: { type: DataTypes.DECIMAL(30, 8), allowNull: false, defaultValue: '0', field: 'profit' },
      hash: { type: DataTypes.TEXT, allowNull: true, field: 'hash' },
      /** open | cashed_out | lost | expired */
      status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'open', field: 'status' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
      updated_at: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
    },
    {
      sequelize,
      modelName: 'InHouseRound',
      tableName: 'in_house_rounds',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return InHouseRound;
};
