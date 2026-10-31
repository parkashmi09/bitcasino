// model/admin/Role.js — mssports results worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes9 } from "sequelize";
var Role = db_default.define("Role", {
  role_id: {
    type: DataTypes9.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  role: {
    type: DataTypes9.STRING,
    allowNull: false,
    unique: true
  },
  power: {
    type: DataTypes9.JSON,
    allowNull: false,
    defaultValue: []
  },
  level: {
    type: DataTypes9.STRING,
    allowNull: false
  },
  is_owner: {
    type: DataTypes9.BOOLEAN,
    defaultValue: false
  },
  is_company: {
    type: DataTypes9.BOOLEAN,
    defaultValue: false
  },
  max_downline_percentage: {
    type: DataTypes9.DECIMAL(5, 2),
    defaultValue: 100,
    comment: "Max % this role can distribute down"
  }
}, {
  timestamps: false
});
var Role_default = Role;

export { Role_default };
