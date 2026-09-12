'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: sports (owned by sports-service)

const { Model, DataTypes } = require('sequelize');

class Fancyresultsummary extends Model {}

module.exports = (sequelize) => {
  Fancyresultsummary.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    fancyname: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "fancyname",
    },
    eventid: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "eventid",
    },
    matchid: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "matchid",
    },
    lastfetchdate: {
      type: 'TIMESTAMP',
      allowNull: true,
      defaultValue: DataTypes.NOW,
      field: "lastfetchdate",
    },
  }, {
    sequelize,
    modelName: "Fancyresultsummary",
    tableName: "fancyresultsummary",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return Fancyresultsummary;
};
