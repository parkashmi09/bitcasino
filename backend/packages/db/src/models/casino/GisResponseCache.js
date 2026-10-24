'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class GisResponseCache extends Model {}

module.exports = (sequelize) => {
  GisResponseCache.init({
    transaction_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      field: "transaction_id",
    },
    response_body: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: "response_body",
    },
  }, {
    sequelize,
    modelName: "GisResponseCache",
    tableName: "gis_response_cache",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return GisResponseCache;
};
