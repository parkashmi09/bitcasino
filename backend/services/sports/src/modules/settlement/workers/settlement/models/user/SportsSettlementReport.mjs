// model/user/SportsSettlementReport.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes2 } from "sequelize";
var SportsSettlementReport = db_default.define(
  "SportsSettlementReport",
  {
    id: {
      type: DataTypes2.BIGINT,
      primaryKey: true,
      autoIncrement: true
      // uses nextval('sports_settlement_report_id_seq') in Postgres
    },
    job_id: {
      type: DataTypes2.UUID,
      allowNull: true
    },
    bet_id: {
      type: DataTypes2.BIGINT,
      allowNull: false,
      unique: true
      // UNIQUE constraint
    },
    user_id: {
      type: DataTypes2.TEXT,
      allowNull: false
    },
    eventid: {
      type: DataTypes2.TEXT,
      allowNull: false
    },
    match_id: {
      type: DataTypes2.TEXT,
      allowNull: true
    },
    game_type: {
      type: DataTypes2.TEXT,
      allowNull: false
    },
    market_type: {
      type: DataTypes2.TEXT,
      allowNull: true
    },
    fancy_name: {
      type: DataTypes2.TEXT,
      allowNull: true
    },
    selection_name: {
      type: DataTypes2.TEXT,
      allowNull: true
    },
    user_selection_yn: {
      type: DataTypes2.TEXT,
      allowNull: true
    },
    resolved_winner: {
      type: DataTypes2.TEXT,
      allowNull: true
    },
    resolved_team: {
      type: DataTypes2.TEXT,
      allowNull: true
    },
    actual_numeric: {
      type: DataTypes2.DECIMAL,
      allowNull: true
    },
    rule_op: {
      type: DataTypes2.TEXT,
      allowNull: true
    },
    rule_threshold: {
      type: DataTypes2.DECIMAL,
      allowNull: true
    },
    credit_amount: {
      type: DataTypes2.DECIMAL,
      allowNull: false,
      defaultValue: 0
    },
    exposures_map: {
      type: DataTypes2.JSONB,
      allowNull: true
    },
    api_snapshot: {
      type: DataTypes2.JSONB,
      allowNull: true
    },
    decision_path: {
      type: DataTypes2.JSONB,
      allowNull: true
    },
    created_at: {
      type: DataTypes2.DATE,
      allowNull: true,
      defaultValue: DataTypes2.NOW
    }
  },
  {
    tableName: "sports_settlement_report",
    timestamps: false
    // created_at handled manually
  }
);
var SportsSettlementReport_default = SportsSettlementReport;

export { SportsSettlementReport_default };
