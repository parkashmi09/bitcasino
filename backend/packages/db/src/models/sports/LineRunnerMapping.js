'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: sports (owned by sports-service)

const { Model, DataTypes } = require('sequelize');

class LineRunnerMapping extends Model {}

module.exports = (sequelize) => {
  LineRunnerMapping.init({
    eventid: {
      type: DataTypes.TEXT,
      primaryKey: true,
      allowNull: false,
      field: "eventid",
    },
    winner_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      field: "winner_id",
    },
    market_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "market_id",
    },
    outcome: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "outcome",
    },
  }, {
    sequelize,
    modelName: "LineRunnerMapping",
    tableName: "line_runner_mapping",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return LineRunnerMapping;
};
