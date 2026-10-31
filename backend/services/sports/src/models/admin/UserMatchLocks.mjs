// model/admin/UserMatchLocks.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes23 } from "sequelize";
var UserMatchLocks = db_default.define(
  "UserMatchLocks",
  {
    id: {
      type: DataTypes23.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes23.BIGINT,
      allowNull: false
    },
    event_id: {
      type: DataTypes23.STRING,
      allowNull: false
    },
    is_locked: {
      type: DataTypes23.BOOLEAN,
      defaultValue: true
    }
  },
  {
    tableName: "user_match_locks",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        fields: ["user_id", "event_id"]
      }
    ]
  }
);
var UserMatchLocks_default = UserMatchLocks;

export { UserMatchLocks_default };
