// model/user/SportsEventResultSummary.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes4 } from "sequelize";
var SportsEventResultSummary = db_default.define(
  "SportsEventResultSummary",
  {
    id: {
      type: DataTypes4.BIGINT,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes4.TEXT,
      allowNull: false
    },
    eventid: {
      type: DataTypes4.TEXT,
      allowNull: false
    },
    declared: {
      type: DataTypes4.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    counts: {
      type: DataTypes4.JSONB,
      allowNull: false,
      defaultValue: {}
    },
    result_meta: {
      type: DataTypes4.JSONB,
      allowNull: true
    },
    sections: {
      type: DataTypes4.JSONB,
      allowNull: true
    },
    recorded_at: {
      type: DataTypes4.DATE,
      allowNull: false,
      defaultValue: DataTypes4.NOW
    }
  },
  {
    tableName: "sports_event_result_summary",
    timestamps: false
    // no createdAt/updatedAt
  }
);
