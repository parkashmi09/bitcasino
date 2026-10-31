// model/admin/BetLock.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes5 } from "sequelize";
var BetLock = db_default.define(
  "BetLock",
  {
    id: {
      type: DataTypes5.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes5.BIGINT,
      allowNull: false,
      unique: true
      // ✅ Ensure no duplicate user_ids
    },
    MatchOdds: {
      type: DataTypes5.BOOLEAN,
      defaultValue: false
    },
    OtherMarkets: {
      type: DataTypes5.BOOLEAN,
      defaultValue: false
    }
  },
  {
    tableName: "betlocks",
    // Adds created_at and updated_at
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at"
  }
);
var BetLock_default = BetLock;

export { BetLock_default };
