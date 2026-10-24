// model/user/SportsBetResultCache.js — mssports results worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes4 } from "sequelize";
var SportsBetResultCache = db_default.define(
  "SportsBetResultCache",
  {
    user_id: {
      type: DataTypes4.TEXT,
      allowNull: false,
      primaryKey: true
    },
    eventid: {
      type: DataTypes4.TEXT,
      allowNull: false,
      primaryKey: true
    },
    match_id: {
      type: DataTypes4.TEXT,
      allowNull: false,
      primaryKey: true
    },
    bucket: {
      type: DataTypes4.TEXT,
      allowNull: false,
      primaryKey: true
    },
    declared: {
      type: DataTypes4.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    is_match_over: {
      type: DataTypes4.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    winner_name: {
      type: DataTypes4.TEXT,
      allowNull: true
    },
    winner_id: {
      type: DataTypes4.BIGINT,
      allowNull: true
    },
    market_id: {
      type: DataTypes4.TEXT,
      allowNull: true
    },
    market_name: {
      type: DataTypes4.TEXT,
      allowNull: true
    },
    provider: {
      type: DataTypes4.TEXT,
      allowNull: true
    },
    betting_type: {
      type: DataTypes4.TEXT,
      allowNull: true
    },
    declared_at: {
      type: DataTypes4.DATE,
      allowNull: true
    },
    api_snapshot: {
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
    tableName: "sports_bet_result_cache",
    timestamps: false,
    // no auto createdAt/updatedAt
    indexes: [
      {
        unique: true,
        fields: ["user_id", "eventid", "match_id", "bucket"]
        // composite PK
      },
      {
        fields: ["declared"]
      },
      {
        fields: ["is_match_over"]
      }
    ]
  }
);
var SportsBetResultCache_default = SportsBetResultCache;

export { SportsBetResultCache_default };
