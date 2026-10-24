// model/user/StakeButtonValue.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes18 } from "sequelize";
var StakeButtonValue = db_default.define("StakeButtonValue", {
  id: {
    type: DataTypes18.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes18.INTEGER,
    allowNull: false,
    references: {
      model: "users",
      // Assuming your user table is named 'users'
      key: "user_id"
    }
  },
  game_buttons: {
    type: DataTypes18.JSON,
    allowNull: false,
    defaultValue: [],
    comment: "Array of { label: string, value: number } for Sports"
  }
}, {
  tableName: "stake_button_values",
  timestamps: true
});
var StakeButtonValue_default = StakeButtonValue;

export { StakeButtonValue_default };
