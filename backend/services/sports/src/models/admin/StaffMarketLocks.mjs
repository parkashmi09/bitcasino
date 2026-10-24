// model/admin/StaffMarketLocks.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";
import { Staff_default } from "./Staff.mjs";
import { PlatformGames_default } from "./PlatformGames.mjs";

init_db();
import { DataTypes as DataTypes29 } from "sequelize";
var StaffMarketLocks = db_default.define(
  "StaffMarketLocks",
  {
    id: {
      type: DataTypes29.BIGINT,
      autoIncrement: true,
      primaryKey: true
    },
    staff_id: {
      type: DataTypes29.INTEGER,
      allowNull: true,
      // null = Owner/Global
      references: {
        model: Staff_default,
        key: "staff_id"
      },
      onDelete: "CASCADE"
    },
    game_id: {
      type: DataTypes29.INTEGER,
      // PlatformGames uses INTEGER id
      allowNull: false,
      references: {
        model: PlatformGames_default,
        key: "id"
      },
      onDelete: "CASCADE"
    },
    market_name: {
      type: DataTypes29.STRING,
      allowNull: false
      // e.g. "Match_Odds", "ALL", "TurboGrill_Studio"
    },
    is_locked: {
      type: DataTypes29.BOOLEAN,
      defaultValue: true
    }
  },
  {
    tableName: "staff_market_locks",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        unique: true,
        fields: ["staff_id", "game_id", "market_name"]
      }
    ]
  }
);
Staff_default.hasMany(StaffMarketLocks, { foreignKey: "staff_id" });
StaffMarketLocks.belongsTo(Staff_default, { foreignKey: "staff_id" });
PlatformGames_default.hasMany(StaffMarketLocks, { foreignKey: "game_id" });
StaffMarketLocks.belongsTo(PlatformGames_default, { foreignKey: "game_id" });
var StaffMarketLocks_default = StaffMarketLocks;

export { StaffMarketLocks_default };
