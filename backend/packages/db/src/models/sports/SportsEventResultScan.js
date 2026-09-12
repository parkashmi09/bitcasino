'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: sports (owned by sports-service)

const { Model, DataTypes } = require('sequelize');

class SportsEventResultScan extends Model {}

module.exports = (sequelize) => {
  SportsEventResultScan.init({
    user_id: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
      field: "user_id",
    },
    eventid: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
      field: "eventid",
    },
    declared: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "declared",
    },
    counts: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: JSON.parse("{}"),
      field: "counts",
    },
    checked_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "checked_at",
    },
  }, {
    sequelize,
    modelName: "SportsEventResultScan",
    tableName: "sports_event_result_scan",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return SportsEventResultScan;
};
