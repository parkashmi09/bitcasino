// model/admin/Affiliate.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes3 } from "sequelize";
var Affiliate = db_default.define("Affiliate", {
  uid: {
    type: DataTypes3.INTEGER,
    primaryKey: true,
    allowNull: false,
    references: {
      model: "users",
      // Reference the Users table
      key: "user_id"
    }
  },
  name: {
    type: DataTypes3.STRING,
    allowNull: false
  },
  referral_link: {
    type: DataTypes3.STRING,
    allowNull: false,
    unique: true
  },
  referral_code: {
    type: DataTypes3.STRING,
    allowNull: false,
    unique: true
  },
  friends: {
    type: DataTypes3.INTEGER,
    defaultValue: 0
  }
});
