// model/user/FanWin.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes14 } from "sequelize";
var FanWin = db_default.define(
  "FanWin",
  {
    id: {
      type: DataTypes14.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes14.BIGINT,
      allowNull: false,
      field: "user_id"
      // maps correctly to DB
    },
    fancyname: {
      type: DataTypes14.STRING(255),
      allowNull: false
    },
    selection: {
      type: DataTypes14.STRING(100),
      allowNull: false
    },
    runsodds: {
      type: DataTypes14.DECIMAL(10, 4),
      // allows 1.4600
      allowNull: false
    },
    payout: {
      type: DataTypes14.DECIMAL(15, 2),
      allowNull: false
    },
    created_at: {
      type: DataTypes14.DATE,
      allowNull: true,
      defaultValue: DataTypes14.NOW
    },
    eventid: {
      type: DataTypes14.TEXT,
      allowNull: false
    },
    matchid: {
      type: DataTypes14.STRING(100),
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
