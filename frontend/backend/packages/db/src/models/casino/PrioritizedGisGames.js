'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class PrioritizedGisGames extends Model {}

module.exports = (sequelize) => {
  PrioritizedGisGames.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    provider: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: "prioritized_gis_games_provider_key",
      field: "provider",
    },
  }, {
    sequelize,
    modelName: "PrioritizedGisGames",
    tableName: "prioritized_gis_games",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_prior_gis_games_provider",
        fields: ["provider"],
      },
    ],
  });

  return PrioritizedGisGames;
};
