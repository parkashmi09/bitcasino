// model/user/MarketWin.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes12 } from "sequelize";
var MarketWin = db_default.define(
  "MarketWin",
  {
    id: {
      type: DataTypes12.BIGINT,
      autoIncrement: true,
      primaryKey: true
    },
    totalbets: {
      type: DataTypes12.BIGINT,
      allowNull: false
    },
    matchid: {
      type: DataTypes12.TEXT,
      allowNull: false
    },
    eventid: {
      type: DataTypes12.TEXT,
      allowNull: false
    },
    team1ex: {
      type: DataTypes12.DECIMAL(18, 2),
      allowNull: false
    },
    team2ex: {
      type: DataTypes12.DECIMAL(18, 2),
      allowNull: false
    },
    drawex: {
      type: DataTypes12.DECIMAL(18, 2),
      allowNull: true
    },
    winteam: {
      type: DataTypes12.TEXT,
      allowNull: false
    },
    matchname: {
      type: DataTypes12.TEXT,
      allowNull: false
    },
    payout: {
      type: DataTypes12.DECIMAL(18, 2),
      allowNull: false
    },
    created_at: {
      type: DataTypes12.DATE,
      allowNull: true,
      defaultValue: DataTypes12.NOW
    },
    user_id: {
      type: DataTypes12.BIGINT,
      allowNull: true
    },
    created_at: {
      type: DataTypes12.DATE,
      allowNull: true,
      defaultValue: DataTypes12.NOW
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
