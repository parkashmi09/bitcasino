'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class ProviderGames extends Model {}

module.exports = (sequelize) => {
  ProviderGames.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    provider_name: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "provider_name",
    },
    game_name: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "game_name",
    },
    image_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "image_url",
    },
  }, {
    sequelize,
    modelName: "ProviderGames",
    tableName: "provider_games",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  });

  return ProviderGames;
};
