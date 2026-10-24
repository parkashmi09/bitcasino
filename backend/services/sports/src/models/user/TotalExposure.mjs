// model/user/TotalExposure.js — mssports core, moved unchanged
import { __esm, __export } from "../../lib/esbuildRuntime.mjs";
import { db_default, init_db } from "../../lib/config/db.mjs";

var TotalExposure_exports = {};
__export(TotalExposure_exports, {
  default: () => TotalExposure_default
});
import { DataTypes as DataTypes21 } from "sequelize";
var TotalExposure, TotalExposure_default;
var init_TotalExposure = __esm({
  "model/user/TotalExposure.js"() {
    init_db();
    TotalExposure = db_default.define(
      "TotalExposure",
      {
        id: {
          type: DataTypes21.INTEGER,
          primaryKey: true,
          autoIncrement: true
        },
        user_id: {
          type: DataTypes21.INTEGER,
          allowNull: false,
          unique: true
          // 🔥 REQUIRED for upsert
        },
        total_exposure: {
          type: DataTypes21.DECIMAL(15, 2),
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
    TotalExposure_default = TotalExposure;
  }
});

export { TotalExposure_exports, TotalExposure_default, init_TotalExposure };
