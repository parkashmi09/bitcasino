// model/admin/UserActivityLog.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes35 } from "sequelize";
var UserActivityLog = db_default.define("UserActivityLog", {
  id: {
    type: DataTypes35.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  username: {
    type: DataTypes35.STRING,
    allowNull: false
  },
  user_id: {
    type: DataTypes35.INTEGER,
    allowNull: true,
    comment: "ID if type is USER"
  },
  staff_id: {
    type: DataTypes35.INTEGER,
    allowNull: true,
    comment: "ID if type is STAFF"
  },
  owner_id: {
    type: DataTypes35.INTEGER,
    allowNull: true,
    comment: "ID if type is OWNER"
  },
  user_type: {
    type: DataTypes35.ENUM("USER", "STAFF", "OWNER"),
    allowNull: false
  },
  action: {
    type: DataTypes35.STRING,
    allowNull: false,
    comment: "LOGIN, PASSWORD_CHANGE, STATUS_CHANGE, etc."
  },
  ip_address: {
    type: DataTypes35.STRING,
    allowNull: true
  },
  browser_detail: {
    type: DataTypes35.STRING,
    allowNull: true,
    comment: "User Agent string"
  },
  details: {
    type: DataTypes35.TEXT,
    allowNull: true,
    comment: "Additional details in JSON or text format"
  }
}, {
  tableName: "user_activity_logs",
  timestamps: true,
  updatedAt: false
  // We only care about creation time for logs
});
var UserActivityLog_default = UserActivityLog;

export { UserActivityLog_default };
