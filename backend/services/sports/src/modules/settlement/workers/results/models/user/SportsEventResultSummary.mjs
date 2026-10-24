// model/user/SportsEventResultSummary.js — mssports results worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes2 } from "sequelize";
var SportsEventResultSummary = db_default.define(
  "SportsEventResultSummary",
  {
    id: {
      type: DataTypes2.BIGINT,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes2.TEXT,
      allowNull: false
    },
    eventid: {
      type: DataTypes2.TEXT,
      allowNull: false
    },
    declared: {
      type: DataTypes2.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    counts: {
      type: DataTypes2.JSONB,
      allowNull: false,
      defaultValue: {}
    },
    result_meta: {
      type: DataTypes2.JSONB,
      allowNull: true
    },
    sections: {
      type: DataTypes2.JSONB,
      allowNull: true
    },
    recorded_at: {
      type: DataTypes2.DATE,
      allowNull: false,
      defaultValue: DataTypes2.NOW
    }
  },
  {
    tableName: "sports_event_result_summary",
    timestamps: false
    // no createdAt/updatedAt
  }
);
var SportsEventResultSummary_default = SportsEventResultSummary;

export { SportsEventResultSummary_default };
