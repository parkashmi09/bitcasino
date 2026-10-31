// model/admin/Role.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes } from "sequelize";
var Role = db_default.define("Role", {
  role_id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  role: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  power: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  },
  level: {
    type: DataTypes.STRING,
    allowNull: false
  },
  is_owner: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  is_company: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  max_downline_percentage: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 100,
    comment: "Max % this role can distribute down"
  }
}, {
  timestamps: false
});
var Role_default = Role;

export { Role_default };
