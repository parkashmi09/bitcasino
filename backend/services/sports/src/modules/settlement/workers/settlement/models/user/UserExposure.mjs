// model/user/UserExposure.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes9 } from "sequelize";
var UserExposure = db_default.define(
  "UserExposure",
  {
    id: {
      type: DataTypes9.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes9.BIGINT,
      allowNull: false
    },
    match_id: {
      type: DataTypes9.STRING,
      allowNull: false
    },
    event_id: {
      type: DataTypes9.STRING,
      allowNull: true
    },
    team_name: {
      type: DataTypes9.STRING,
      allowNull: false
    },
    exposure_amount: {
      type: DataTypes9.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0
    },
    match_title: {
      type: DataTypes9.STRING(255),
      allowNull: true
    },
    game_type: {
      type: DataTypes9.STRING(100),
      allowNull: true
    },
    category: {
      type: DataTypes9.STRING(100),
      allowNull: true
      // or false if DB has NOT NULL
    },
    created_at: {
      type: DataTypes9.DATE,
      allowNull: false,
      defaultValue: DataTypes9.NOW
    },
    updated_at: {
      type: DataTypes9.DATE,
      allowNull: false,
      defaultValue: DataTypes9.NOW
    }
  },
  {
    tableName: "user_exposures",
    timestamps: false,
    // we manually manage timestamps
    indexes: [
      {
        unique: true,
        fields: ["user_id", "match_id", "team_name", "game_type"]
      }
    ]
  }
);
var UserExposure_default = UserExposure;

export { UserExposure_default };
