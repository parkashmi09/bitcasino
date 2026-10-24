'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class PrioritizedGames extends Model {}

module.exports = (sequelize) => {
  PrioritizedGames.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    vendor: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: "prioritized_games_vendor_uniq",
      field: "vendor",
    },
    game_ids: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "game_ids",
    },
  }, {
    sequelize,
    modelName: "PrioritizedGames",
    tableName: "prioritized_games",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return PrioritizedGames;
};
