'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: sports (owned by sports-service)

const { Model, DataTypes } = require('sequelize');

class ManualSettle extends Model {}

module.exports = (sequelize) => {
  ManualSettle.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    match_id: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: "match_id",
    },
    eventid: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "eventid",
    },
    winner_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "winner_name",
    },
    team_one: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "team_one",
    },
    team_two: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "team_two",
    },
    counts: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: "0",
      field: "counts",
    },
  }, {
    sequelize,
    modelName: "ManualSettle",
    tableName: "manual_settle",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return ManualSettle;
};
