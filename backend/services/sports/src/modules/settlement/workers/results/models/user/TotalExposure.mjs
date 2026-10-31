// model/user/TotalExposure.js — mssports results worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes13 } from "sequelize";
var TotalExposure = db_default.define(
  "TotalExposure",
  {
    id: {
      type: DataTypes13.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes13.INTEGER,
      allowNull: false,
      unique: true
      // 🔥 REQUIRED for upsert
    },
    total_exposure: {
      type: DataTypes13.DECIMAL(15, 2),
      // ✅ money-safe
      allowNull: false,
      defaultValue: 0
    }
  },
  {
    tableName: "total_exposures",
    timestamps: true
  }
);
var TotalExposure_default = TotalExposure;

export { TotalExposure_default };
