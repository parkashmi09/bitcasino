// model/user/MarketWin.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes15 } from "sequelize";
var MarketWin = db_default.define(
  "MarketWin",
  {
    id: {
      type: DataTypes15.BIGINT,
      autoIncrement: true,
      primaryKey: true
    },
    totalbets: {
      type: DataTypes15.BIGINT,
      allowNull: false
    },
    matchid: {
      type: DataTypes15.TEXT,
      allowNull: false
    },
    eventid: {
      type: DataTypes15.TEXT,
      allowNull: false
    },
    team1ex: {
      type: DataTypes15.DECIMAL(18, 2),
      allowNull: false
    },
    team2ex: {
      type: DataTypes15.DECIMAL(18, 2),
      allowNull: false
    },
    drawex: {
      type: DataTypes15.DECIMAL(18, 2),
      allowNull: true
    },
    winteam: {
      type: DataTypes15.TEXT,
      allowNull: false
    },
    matchname: {
      type: DataTypes15.TEXT,
      allowNull: false
    },
    payout: {
      type: DataTypes15.DECIMAL(18, 2),
      allowNull: false
    },
    created_at: {
      type: DataTypes15.DATE,
      allowNull: true,
      defaultValue: DataTypes15.NOW
    },
    user_id: {
      type: DataTypes15.BIGINT,
      allowNull: true
    },
    created_at: {
      type: DataTypes15.DATE,
      allowNull: true,
      defaultValue: DataTypes15.NOW
    }
  },
  {
    tableName: "marketwins",
    schema: "public",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at"
  }
);
var MarketWin_default = MarketWin;

export { MarketWin_default };
