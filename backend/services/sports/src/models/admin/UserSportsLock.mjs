// model/admin/UserSportsLock.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes28 } from "sequelize";
var UserSportsLock = db_default.define("UserSportsLock", {
  id: {
    type: DataTypes28.BIGINT,
    autoIncrement: true,
    primaryKey: true
  },
  user_id: {
    type: DataTypes28.BIGINT,
    allowNull: false
  },
  // Dynamic String IDs
  sport_id: {
    type: DataTypes28.STRING,
    allowNull: false
  },
  series_id: {
    type: DataTypes28.STRING,
    allowNull: true
  },
  match_id: {
    type: DataTypes28.STRING,
    allowNull: true
  },
  market_id: {
    type: DataTypes28.STRING,
    allowNull: true
  },
  lock_type: {
    type: DataTypes28.STRING,
    allowNull: true
  },
  is_locked: {
    type: DataTypes28.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: "user_sports_lock",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: "updated_at",
  indexes: [
    {
      name: "user_sports_lock_unique_idx",
      unique: true,
      fields: ["user_id", "sport_id", "series_id", "match_id", "market_id"]
    }
  ]
});
var UserSportsLock_default = UserSportsLock;

export { UserSportsLock_default };
