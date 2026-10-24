// model/user/SportsEventResultScan.js — mssports results worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes } from "sequelize";
var SportsEventResultScan = db_default.define(
  "SportsEventResultScan",
  {
    user_id: {
      type: DataTypes.TEXT,
      allowNull: false,
      primaryKey: true
    },
    eventid: {
      type: DataTypes.TEXT,
      allowNull: false,
      primaryKey: true
    },
    declared: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    counts: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {}
    },
    checked_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
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
var SportsEventResultScan_default = SportsEventResultScan;

export { SportsEventResultScan_default };
