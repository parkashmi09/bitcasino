// model/admin/Affiliate.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes15 } from "sequelize";
var Affiliate = db_default.define("Affiliate", {
  uid: {
    type: DataTypes15.INTEGER,
    primaryKey: true,
    allowNull: false,
    references: {
      model: "users",
      // Reference the Users table
      key: "user_id"
    }
  },
  name: {
    type: DataTypes15.STRING,
    allowNull: false
  },
  referral_link: {
    type: DataTypes15.STRING,
    allowNull: false,
    unique: true
  },
  referral_code: {
    type: DataTypes15.STRING,
    allowNull: false,
    unique: true
  },
  friends: {
    type: DataTypes15.INTEGER,
    defaultValue: 0
  }
});
