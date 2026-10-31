'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class WagerMultiplierCommon extends Model {}

module.exports = (sequelize) => {
  WagerMultiplierCommon.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    multiplier: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "multiplier",
    },
  }, {
    sequelize,
    modelName: "WagerMultiplierCommon",
    tableName: "wager_multiplier_common",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return WagerMultiplierCommon;
};
