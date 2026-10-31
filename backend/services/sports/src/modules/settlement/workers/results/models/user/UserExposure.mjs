// model/user/UserExposure.js — mssports results worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes12 } from "sequelize";
var UserExposure = db_default.define(
  "UserExposure",
  {
    id: {
      type: DataTypes12.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes12.BIGINT,
      allowNull: false
    },
    match_id: {
      type: DataTypes12.STRING,
      allowNull: false
    },
    event_id: {
      type: DataTypes12.STRING,
      allowNull: true
    },
    team_name: {
      type: DataTypes12.STRING,
      allowNull: false
    },
    exposure_amount: {
      type: DataTypes12.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0
    },
    match_title: {
      type: DataTypes12.STRING(255),
      allowNull: true
    },
    game_type: {
      type: DataTypes12.STRING(100),
      allowNull: true
    },
    category: {
      type: DataTypes12.STRING(100),
      allowNull: true
      // or false if DB has NOT NULL
    },
    created_at: {
      type: DataTypes12.DATE,
      allowNull: false,
      defaultValue: DataTypes12.NOW
    },
    updated_at: {
      type: DataTypes12.DATE,
      allowNull: false,
      defaultValue: DataTypes12.NOW
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
