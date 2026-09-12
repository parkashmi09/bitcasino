'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class HotGames extends Model {}

module.exports = (sequelize) => {
  HotGames.init({
    key: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
      field: "key",
    },
    game_uuids: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "game_uuids",
    },
  }, {
    sequelize,
    modelName: "HotGames",
    tableName: "hot_games",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return HotGames;
};
