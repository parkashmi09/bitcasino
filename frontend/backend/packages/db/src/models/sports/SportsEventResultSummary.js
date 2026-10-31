'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: sports (owned by sports-service)

const { Model, DataTypes } = require('sequelize');

class SportsEventResultSummary extends Model {}

module.exports = (sequelize) => {
  SportsEventResultSummary.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    user_id: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "user_id",
    },
    eventid: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "eventid",
    },
    declared: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: "declared",
    },
    counts: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: "counts",
    },
    result_meta: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "result_meta",
    },
    sections: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "sections",
    },
    recorded_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: "recorded_at",
    },
  }, {
    sequelize,
    modelName: "SportsEventResultSummary",
    tableName: "sports_event_result_summary",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return SportsEventResultSummary;
};
