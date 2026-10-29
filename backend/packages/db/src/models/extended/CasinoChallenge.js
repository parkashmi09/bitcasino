'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 166 (rainbet).
// Domain: extended — written and read by casino-service.

const { Model, DataTypes } = require('sequelize');

/** One casino challenge — see migration 166. */
class CasinoChallenge extends Model {}

module.exports = (sequelize) => {
  CasinoChallenge.init(
    {
      id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true, allowNull: false, field: 'id' },
      game: { type: DataTypes.STRING(64), allowNull: false, field: 'game' },
      game_name: { type: DataTypes.STRING(120), allowNull: false, field: 'game_name' },
      image_url: { type: DataTypes.STRING(500), allowNull: true, field: 'image_url' },
      min_multiplier: { type: DataTypes.DECIMAL(20, 4), allowNull: false, field: 'min_multiplier' },
      min_bet_usd: { type: DataTypes.DECIMAL(20, 2), allowNull: false, field: 'min_bet_usd' },
      prize_usd: { type: DataTypes.DECIMAL(20, 2), allowNull: false, field: 'prize_usd' },
      winners: { type: DataTypes.INTEGER, allowNull: false, field: 'winners' },
      starts_at: { type: DataTypes.DATE, allowNull: false, field: 'starts_at' },
      ends_at: { type: DataTypes.DATE, allowNull: false, field: 'ends_at' },
      status: { type: DataTypes.STRING(10), allowNull: false, field: 'status' },
      created_at: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    },
    {
      sequelize,
      modelName: 'CasinoChallenge',
      tableName: 'casino_challenges',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return CasinoChallenge;
};
