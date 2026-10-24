// model/admin/Role.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes5 } from "sequelize";
var Role = db_default.define("Role", {
  role_id: {
    type: DataTypes5.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  role: {
    type: DataTypes5.STRING,
    allowNull: false,
    unique: true
  },
  power: {
    type: DataTypes5.JSON,
    allowNull: false,
    defaultValue: []
  },
  level: {
    type: DataTypes5.STRING,
    allowNull: false
  },
  is_owner: {
    type: DataTypes5.BOOLEAN,
    defaultValue: false
  },
  is_company: {
    type: DataTypes5.BOOLEAN,
    defaultValue: false
  },
  max_downline_percentage: {
    type: DataTypes5.DECIMAL(5, 2),
    defaultValue: 100,
    comment: "Max % this role can distribute down"
  }
}, {
  timestamps: false
});
var Role_default = Role;

export { Role_default };
