// model/user/SportsEventResultScan.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes3 } from "sequelize";
var SportsEventResultScan = db_default.define(
  "SportsEventResultScan",
  {
    user_id: {
      type: DataTypes3.TEXT,
      allowNull: false,
      primaryKey: true
    },
    eventid: {
      type: DataTypes3.TEXT,
      allowNull: false,
      primaryKey: true
    },
    declared: {
      type: DataTypes3.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    counts: {
      type: DataTypes3.JSONB,
      allowNull: false,
      defaultValue: {}
    },
    checked_at: {
      type: DataTypes3.DATE,
      allowNull: false,
      defaultValue: DataTypes3.NOW
    }
  },
  {
    tableName: "sports_event_result_scan",
    // 👈 your table
    timestamps: false,
    indexes: [
      {
        unique: true,
        fields: ["user_id", "eventid"]
      }
    ]
  }
);
