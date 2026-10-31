'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class GisGames extends Model {}

module.exports = (sequelize) => {
  GisGames.init({
    uuid: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
      field: "uuid",
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "name",
    },
    provider: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "provider",
    },
    type: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "type",
    },
    image: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "image",
    },
    technology: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "technology",
    },
    has_lobby: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "has_lobby",
    },
    is_mobile: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "is_mobile",
    },
    has_freespins: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "has_freespins",
    },
    freespin_valid_until_full_day: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "freespin_valid_until_full_day",
    },
    updated_at: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "updated_at",
    },
    api_sub_provider_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "api_sub_provider_id",
    },
    updated_at_timestamp: {
      type: 'TIMESTAMP',
      allowNull: true,
      field: "updated_at_timestamp",
    },
  }, {
    sequelize,
    modelName: "GisGames",
    tableName: "gis_games",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        name: "idx_gis_games_name",
        fields: ["name"],
      },
      {
        name: "idx_gis_games_provider",
        fields: ["provider"],
      },
      {
        name: "idx_gis_games_type",
        fields: ["type"],
      },
    ],
  });

  return GisGames;
};
