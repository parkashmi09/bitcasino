// model/user/UserExposure.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes20 } from "sequelize";
var UserExposure = db_default.define(
  "UserExposure",
  {
    id: {
      type: DataTypes20.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    user_id: {
      type: DataTypes20.BIGINT,
      allowNull: false
    },
    match_id: {
      type: DataTypes20.STRING,
      allowNull: false
    },
    event_id: {
      type: DataTypes20.STRING,
      allowNull: true
    },
    team_name: {
      type: DataTypes20.STRING,
      allowNull: false
    },
    exposure_amount: {
      type: DataTypes20.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0
    },
    match_title: {
      type: DataTypes20.STRING(255),
      allowNull: true
    },
    game_type: {
      type: DataTypes20.STRING(100),
      allowNull: true
    },
    category: {
      type: DataTypes20.STRING(100),
      allowNull: true
      // or false if DB has NOT NULL
    },
    created_at: {
      type: DataTypes20.DATE,
      allowNull: false,
      defaultValue: DataTypes20.NOW
    },
    updated_at: {
      type: DataTypes20.DATE,
      allowNull: false,
      defaultValue: DataTypes20.NOW
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
