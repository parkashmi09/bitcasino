// model/Executive.js — mssports core, moved unchanged
import { db_default, init_db } from "../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes17 } from "sequelize";
var Executive = db_default.define(
  "Executive",
  {
    id: {
      type: DataTypes17.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    parent_type: {
      type: DataTypes17.ENUM("OWNER", "STAFF"),
      allowNull: false
    },
    parent_id: {
      type: DataTypes17.INTEGER,
      allowNull: false
    },
    username: {
      type: DataTypes17.STRING,
      allowNull: false,
      unique: true
    },
    email: {
      type: DataTypes17.STRING,
      allowNull: true,
      unique: true
    },
    full_name: {
      type: DataTypes17.STRING,
      allowNull: true
    },
    password: {
      type: DataTypes17.STRING,
      allowNull: false
    },
    role: {
      type: DataTypes17.STRING,
      allowNull: false
    },
    permissions: {
      type: DataTypes17.JSON,
      allowNull: false,
      defaultValue: {}
    },
    active: {
      type: DataTypes17.BOOLEAN,
      defaultValue: true
    }
  },
  {
    tableName: "executives",
    timestamps: true
  }
);
var Executive_default = Executive;

export { Executive_default };
