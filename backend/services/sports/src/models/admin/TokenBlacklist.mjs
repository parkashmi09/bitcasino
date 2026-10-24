// model/admin/TokenBlacklist.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes16 } from "sequelize";
var TokenBlacklist = db_default.define("TokenBlacklist", {
  token: {
    type: DataTypes16.STRING,
    allowNull: false,
    unique: true
  },
  expiresAt: {
    type: DataTypes16.DATE,
    allowNull: false
  }
});
var TokenBlacklist_default = TokenBlacklist;

export { TokenBlacklist_default };
