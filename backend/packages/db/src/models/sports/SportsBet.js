'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: sports (owned by sports-service)

const { Model, DataTypes } = require('sequelize');

class SportsBet extends Model {}

module.exports = (sequelize) => {
  SportsBet.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "user_id",
    },
    game_type: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "game_type",
    },
    match_title: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "match_title",
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
    selection_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "selection_name",
    },
    category: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "category",
    },
    bet_type: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "bet_type",
    },
    market_type: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "market_type",
    },
    odds: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: true,
      field: "odds",
    },
    stake_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      field: "stake_amount",
    },
    original_currency: {
      type: DataTypes.STRING(10),
      allowNull: true,
      defaultValue: "INR",
      field: "original_currency",
    },
    original_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      field: "original_amount",
    },
    usd_amount: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      field: "usd_amount",
    },
    liability: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      field: "liability",
    },
    match_start_time: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "match_start_time",
    },
    match_end_time: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "match_end_time",
    },
    match_id: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "match_id",
    },
    exposure_after_bet: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: true,
      field: "exposure_after_bet",
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "status",
    },
    eventid: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "eventid",
    },
    job_id: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "job_id",
    },
    ip_address: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "ip_address",
    },
    fancy_name: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "fancy_name",
    },
    result_status: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: "pending",
      field: "result_status",
    },
    fixed: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: "0",
      field: "fixed",
    },
    counts: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: "2",
      field: "counts",
    },
    sport_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "sport_id",
    },
    unmatched: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "unmatched",
    },
    unmatched_odds: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: true,
      field: "unmatched_odds",
    },
    runners: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "runners",
    },
    size: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "size",
    },
    event_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "event_name",
    },
    lay_size: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      field: "lay_size",
    },
    back_size: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      field: "back_size",
    },
  }, {
    sequelize,
    modelName: "SportsBet",
    tableName: "SportsBet",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return SportsBet;
};
