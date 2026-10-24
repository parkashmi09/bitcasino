'use strict';

// HAND-WRITTEN model (not generated). Backed by migration 131: the Original Games aggregator's
// catalogue as `GET /v1/games` last answered (scripts/sync-original-games.js).

const { Model, DataTypes } = require('sequelize');

class OgGames extends Model {}

module.exports = (sequelize) => {
  OgGames.init(
    {
      code: { type: DataTypes.TEXT, primaryKey: true, allowNull: false, field: 'code' },
      name: { type: DataTypes.TEXT, allowNull: false, field: 'name' },
      position: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'position' },
      data: { type: DataTypes.JSONB, allowNull: false, defaultValue: {}, field: 'data' },
      synced_at: { type: DataTypes.DATE, allowNull: false, field: 'synced_at' },
    },
    {
      sequelize,
      modelName: 'OgGames',
      tableName: 'og_games',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      timestamps: false,
    }
  );
  return OgGames;
};
