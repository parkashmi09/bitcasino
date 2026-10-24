'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class GameRuns extends Model {}

module.exports = (sequelize) => {
  GameRuns.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    game_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "game_id",
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "user_id",
    },
    currency: {
      type: DataTypes.STRING(10),
      allowNull: true,
      field: "currency",
    },
    mode: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "mode",
    },
    language: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "language",
    },
    home_url: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "home_url",
    },
    device: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "device",
    },
    vendor: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "vendor",
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "title",
    },
    session_id: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "session_id",
    },
    url: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "url",
    },
    coin: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "coin",
    },
  }, {
    sequelize,
    modelName: "GameRuns",
    tableName: "game_runs",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  });

  return GameRuns;
};
