'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: sports (owned by sports-service)

const { Model, DataTypes } = require('sequelize');

class Marketwins extends Model {}

module.exports = (sequelize) => {
  Marketwins.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    totalbets: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "totalbets",
    },
    matchid: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "matchid",
    },
    eventid: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "eventid",
    },
    team1ex: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      field: "team1ex",
    },
    team2ex: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      field: "team2ex",
    },
    drawex: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: true,
      field: "drawex",
    },
    winteam: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "winteam",
    },
    matchname: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "matchname",
    },
    payout: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      field: "payout",
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "user_id",
    },
  }, {
    sequelize,
    modelName: "Marketwins",
    tableName: "marketwins",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  });

  return Marketwins;
};
