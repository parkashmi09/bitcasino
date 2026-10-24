'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)
//
// NOTE: this table has no PRIMARY KEY in the database. Sequelize needs a row
// identity, so the model uses UNIQUE constraint gis_providers_name_key.
// Uniqueness is NOT enforced by the database — do not assume it.

const { Model, DataTypes } = require('sequelize');

class GisProviders extends Model {}

module.exports = (sequelize) => {
  GisProviders.init({
    name: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
      unique: "gis_providers_name_key",
      field: "name",
    },
  }, {
    sequelize,
    modelName: "GisProviders",
    tableName: "gis_providers",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return GisProviders;
};
