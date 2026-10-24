'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: sports (owned by sports-service)

const { Model, DataTypes } = require('sequelize');

class Fanwins extends Model {}

module.exports = (sequelize) => {
  Fanwins.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    userid: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "userid",
    },
    fancyname: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "fancyname",
    },
    selection: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: "selection",
    },
    runsodds: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "runsodds",
    },
    payout: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      field: "payout",
    },
    eventid: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "eventid",
    },
    matchid: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: "matchid",
    },
  }, {
    sequelize,
    modelName: "Fanwins",
    tableName: "fanwins",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  });

  return Fanwins;
};
