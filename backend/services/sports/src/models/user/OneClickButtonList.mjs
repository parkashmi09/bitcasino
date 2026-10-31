// model/user/OneClickButtonList.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes19 } from "sequelize";
var OneClickButtonList = db_default.define("OneClickButtonList", {
  id: {
    type: DataTypes19.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes19.INTEGER,
    allowNull: false,
    unique: true,
    references: {
      model: "users",
      key: "user_id"
    }
  },
  buttons: {
    type: DataTypes19.JSON,
    allowNull: false,
    defaultValue: [100, 200, 300],
    comment: "Array of 3 numbers for 1-Click Betting stakes"
  }
}, {
  tableName: "oneclick_button_lists",
  timestamps: true
});
var OneClickButtonList_default = OneClickButtonList;

export { OneClickButtonList_default };
