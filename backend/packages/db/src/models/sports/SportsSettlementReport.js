'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: sports (owned by sports-service)

const { Model, DataTypes } = require('sequelize');

class SportsSettlementReport extends Model {}

module.exports = (sequelize) => {
  SportsSettlementReport.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    job_id: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "job_id",
    },
    bet_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      unique: "ux_settlement_report_bet",
      field: "bet_id",
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
    match_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "match_id",
    },
    game_type: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "game_type",
    },
    market_type: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "market_type",
    },
    fancy_name: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "fancy_name",
    },
    selection_name: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "selection_name",
    },
    user_selection_yn: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "user_selection_yn",
    },
    resolved_winner: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "resolved_winner",
    },
    resolved_team: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "resolved_team",
    },
    actual_numeric: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      field: "actual_numeric",
    },
    rule_op: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "rule_op",
    },
    rule_threshold: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      field: "rule_threshold",
    },
    credit_amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: "0",
      field: "credit_amount",
    },
    exposures_map: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "exposures_map",
    },
    api_snapshot: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "api_snapshot",
    },
    decision_path: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "decision_path",
    },
  }, {
    sequelize,
    modelName: "SportsSettlementReport",
    tableName: "sports_settlement_report",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  });

  return SportsSettlementReport;
};
