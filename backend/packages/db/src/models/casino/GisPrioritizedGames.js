'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class GisPrioritizedGames extends Model {}

module.exports = (sequelize) => {
  GisPrioritizedGames.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    vendor: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "vendor",
    },
    game_ids: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "game_ids",
    },
  }, {
    sequelize,
    modelName: "GisPrioritizedGames",
    tableName: "gis_prioritized_games",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return GisPrioritizedGames;
};
