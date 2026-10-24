// model/user/FanWin.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes13 } from "sequelize";
var FanWin = db_default.define(
  "FanWin",
  {
    id: {
      type: DataTypes13.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes13.BIGINT,
      allowNull: false,
      field: "user_id"
      // maps correctly to DB
    },
    fancyname: {
      type: DataTypes13.STRING(255),
      allowNull: false
    },
    selection: {
      type: DataTypes13.STRING(100),
      allowNull: false
    },
    runsodds: {
      type: DataTypes13.DECIMAL(10, 4),
      // allows 1.4600
      allowNull: false
    },
    payout: {
      type: DataTypes13.DECIMAL(15, 2),
      allowNull: false
    },
    created_at: {
      type: DataTypes13.DATE,
      allowNull: true,
      defaultValue: DataTypes13.NOW
    },
    eventid: {
      type: DataTypes13.TEXT,
      allowNull: false
    },
    matchid: {
      type: DataTypes13.STRING(100),
      allowNull: false
    }
  },
  {
    tableName: "fanwins",
    schema: "public",
    timestamps: false
  }
);
var FanWin_default = FanWin;

export { FanWin_default };
