// model/user/SportsBet.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes11 } from "sequelize";
var SportsBet = db_default.define(
  "SportsBet",
  {
    id: {
      type: DataTypes11.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes11.BIGINT,
      allowNull: false
    },
    game_type: {
      type: DataTypes11.STRING(100),
      allowNull: false
    },
    match_title: {
      type: DataTypes11.STRING(255)
    },
    team_one: {
      type: DataTypes11.STRING(255),
      allowNull: true
    },
    team_two: {
      type: DataTypes11.STRING(255),
      allowNull: true
    },
    selection_name: {
      type: DataTypes11.STRING(255),
      allowNull: true
    },
    category: {
      type: DataTypes11.STRING(100),
      allowNull: true
    },
    bet_type: {
      type: DataTypes11.STRING(100),
      allowNull: false
    },
    market_type: {
      type: DataTypes11.STRING(100),
      allowNull: true,
      defaultValue: null
      // or "Over By Over" if you want
    },
    odds: {
      type: DataTypes11.DECIMAL(10, 4),
      allowNull: false
    },
    stake_amount: {
      type: DataTypes11.DECIMAL(15, 2),
      allowNull: false
    },
    event_name: {
      type: DataTypes11.STRING(255)
    },
    original_currency: {
      type: DataTypes11.STRING(10),
      allowNull: true,
      defaultValue: "INR"
    },
    original_amount: {
      type: DataTypes11.DECIMAL(24, 8),
      allowNull: true
    },
    usd_amount: {
      type: DataTypes11.DECIMAL(15, 2),
      allowNull: true
    },
    liability: {
      type: DataTypes11.DECIMAL(15, 2),
      allowNull: true
    },
    match_start_time: {
      type: DataTypes11.DATE,
      allowNull: true
    },
    match_end_time: {
      type: DataTypes11.DATE,
      allowNull: true
    },
    created_at: {
      type: DataTypes11.DATE,
      defaultValue: DataTypes11.NOW
    },
    updated_at: {
      type: DataTypes11.DATE,
      defaultValue: DataTypes11.NOW
    },
    match_id: {
      type: DataTypes11.STRING(100),
      allowNull: true
    },
    exposure_after_bet: {
      type: DataTypes11.DECIMAL(15, 2),
      allowNull: true
    },
    status: {
      type: DataTypes11.STRING(20),
      allowNull: true
    },
    eventid: {
      type: DataTypes11.TEXT
    },
    job_id: {
      type: DataTypes11.UUID,
      allowNull: true
    },
    ip_address: {
      type: DataTypes11.TEXT,
      allowNull: true
    },
    browser: {
      type: DataTypes11.TEXT,
      allowNull: true
    },
    fancy_name: {
      type: DataTypes11.TEXT,
      allowNull: true
    },
    result_status: {
      type: DataTypes11.TEXT,
      defaultValue: "pending"
    },
    fixed: {
      type: DataTypes11.INTEGER,
      defaultValue: 0
    },
    counts: {
      type: DataTypes11.INTEGER,
      defaultValue: 2
    },
    sport_id: {
      type: DataTypes11.TEXT,
      allowNull: true
    },
    unmatched: {
      type: DataTypes11.BOOLEAN,
      defaultValue: false
    },
    unmatched_odds: {
      type: DataTypes11.DECIMAL(10, 4),
      allowNull: true
    },
    size: {
      type: DataTypes11.INTEGER,
      allowNull: true
    },
    runners: {
      type: DataTypes11.JSON,
      allowNull: true
    },
    gtype: {
      type: DataTypes11.TEXT,
      allowNull: true
    },
    // League / competition name from the feed (cname), sent by the client at
    // placement. Only used for display — the statement Result modal prints
    // "Sport -> League -> Match -> Market". Column is added on boot by
    // ensureSportsBetLeagueColumn() in config/dbInit.js.
    league_name: {
      type: DataTypes11.STRING(255),
      allowNull: true
    },
    // Badlo is an EXACT-RUN swap that lives INSIDE an ordinary session market
    // ("Normal"), flagged per runner by the feed's `ik`. It is a property of
    // the BET, not of the market — so it is a flag here rather than a
    // market_type value. Overloading market_type with 'badlo' (the first
    // attempt) put these rows in their own market bucket, printed "badlo" as
    // the market name in the bet list, and split the runner's Normal book.
    // See helper/badloMarket.js.
    badlo: {
      type: DataTypes11.BOOLEAN,
      allowNull: false,
      defaultValue: false
    }
  },
  {
    tableName: "SportsBet",
    timestamps: false,
    indexes: [
      { fields: ["user_id"] },
      { fields: ["match_id"] },
      { fields: ["eventid"] },
      { fields: ["status"] },
      { fields: ["result_status"] },
      { fields: ["sport_id"] },
      { fields: ["job_id"] },
      { fields: ["user_id", "status"] },
      { fields: ["user_id", "match_id"] },
      { fields: ["user_id", "eventid", "status"] }
    ]
  }
);
var SportsBet_default = SportsBet;

export { SportsBet_default };
