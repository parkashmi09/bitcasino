// model/user/Tokens.js — mssports results worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes5 } from "sequelize";
var Tokens = db_default.define(
  "Tokens",
  {
    uid: {
      type: DataTypes5.NUMERIC,
      allowNull: false,
      primaryKey: true
    },
    key: {
      type: DataTypes5.TEXT,
      allowNull: false
    }
  },
  {
    tableName: "tokens",
    // explicitly set table name
    timestamps: false
    // disable createdAt/updatedAt if not needed
  }
);
