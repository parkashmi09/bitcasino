// model/admin/UserEventMarketLocks.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes24 } from "sequelize";
var UserEventMarketLocks = db_default.define(
  "UserEventMarketLocks",
  {
    id: {
      type: DataTypes24.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    account_id: {
      type: DataTypes24.BIGINT,
      allowNull: false,
      comment: "staff_id or user_id"
    },
    account_type: {
      type: DataTypes24.ENUM("staff", "user"),
      allowNull: false
    },
    event_id: {
      type: DataTypes24.STRING,
      allowNull: false
    },
    market_id: {
      type: DataTypes24.STRING,
      allowNull: true,
      comment: "Primary identifier for the market (mid)"
    },
    market_name: {
      type: DataTypes24.STRING,
      allowNull: true,
      comment: "Fallback: e.g. MATCH_ODDS, bookmaker, Normal, fancy1, etc."
    },
    is_locked: {
      type: DataTypes24.BOOLEAN,
      defaultValue: true
    },
    locked_by: {
      type: DataTypes24.BIGINT,
      allowNull: true,
      comment: "staff_id or owner_id who locked"
    }
  },
  {
    tableName: "user_event_market_locks",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        name: "uq_event_market_lock",
        fields: ["account_id", "account_type", "event_id", "market_id"]
      }
    ]
  }
);
var UserEventMarketLocks_default = UserEventMarketLocks;

export { UserEventMarketLocks_default };
