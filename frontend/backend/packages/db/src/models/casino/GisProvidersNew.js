'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class GisProvidersNew extends Model {}

module.exports = (sequelize) => {
  GisProvidersNew.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: "gis_providers_new_name_key",
      field: "name",
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "enabled",
    },
  }, {
    sequelize,
    modelName: "GisProvidersNew",
    tableName: "gis_providers_new",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  });

  return GisProvidersNew;
};
