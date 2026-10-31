// model/admin/manualresult.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes34 } from "sequelize";
var MannualResult = db_default.define("MannualResult", {
  id: {
    type: DataTypes34.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  match_title: {
    type: DataTypes34.STRING,
    allowNull: false
  },
  eventid: {
    type: DataTypes34.STRING,
    allowNull: false
  },
  match_id: {
    type: DataTypes34.STRING,
    allowNull: false
  },
  market_type: {
    type: DataTypes34.STRING,
    allowNull: false
  },
  game_type: {
    type: DataTypes34.STRING,
    allowNull: false
  },
  winnerId: {
    type: DataTypes34.INTEGER,
    allowNull: true,
    field: "winnerId"
  },
  winnerName: {
    type: DataTypes34.STRING,
    allowNull: true,
    field: "winnerName"
  },
  fancyName: {
    type: DataTypes34.STRING,
    allowNull: true,
    field: "fancyName"
  }
}, {
  tableName: "mannual_result",
  timestamps: true,
  // createdAt & updatedAt
  underscored: true
  // created_at, updated_at
});
var manualresult_default = MannualResult;

export { manualresult_default };
