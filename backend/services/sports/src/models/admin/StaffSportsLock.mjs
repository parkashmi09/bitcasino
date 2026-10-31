// model/admin/StaffSportsLock.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";
import { Staff_default } from "./Staff.mjs";
import { Owner_default } from "./Owner.mjs";

init_db();
import { DataTypes as DataTypes27 } from "sequelize";
var StaffSportsLock = db_default.define("StaffSportsLock", {
  id: {
    type: DataTypes27.BIGINT,
    autoIncrement: true,
    primaryKey: true
  },
  staff_id: {
    type: DataTypes27.INTEGER,
    allowNull: true,
    references: {
      model: Staff_default,
      key: "staff_id"
    },
    onDelete: "CASCADE"
  },
  owner_id: {
    type: DataTypes27.INTEGER,
    allowNull: true,
    references: {
      model: Owner_default,
      key: "owner_id"
    },
    onDelete: "CASCADE"
  },
  // Dynamic String IDs for Sports Hierarchy
  // "4", "4-0", "1.12345678", "1.12345678-0"
  sport_id: {
    type: DataTypes27.STRING,
    allowNull: false
  },
  series_id: {
    type: DataTypes27.STRING,
    allowNull: true
  },
  match_id: {
    type: DataTypes27.STRING,
    allowNull: true
  },
  market_id: {
    type: DataTypes27.STRING,
    allowNull: true
  },
  lock_type: {
    type: DataTypes27.STRING,
    allowNull: true
  },
  is_locked: {
    type: DataTypes27.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: "staff_sports_lock",
  timestamps: true,
  createdAt: "created_at",
  updatedAt: "updated_at",
  indexes: [
    {
      name: "staff_sports_lock_unique_idx",
      unique: true,
      fields: ["staff_id", "owner_id", "sport_id", "series_id", "match_id", "market_id"]
    }
  ]
});
Staff_default.hasMany(StaffSportsLock, { foreignKey: "staff_id" });
StaffSportsLock.belongsTo(Staff_default, { foreignKey: "staff_id" });
Owner_default.hasMany(StaffSportsLock, { foreignKey: "owner_id" });
StaffSportsLock.belongsTo(Owner_default, { foreignKey: "owner_id" });
var StaffSportsLock_default = StaffSportsLock;

export { StaffSportsLock_default };
