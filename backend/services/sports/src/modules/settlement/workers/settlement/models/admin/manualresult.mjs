// model/admin/manualresult.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes21 } from "sequelize";
var MannualResult = db_default.define("MannualResult", {
  id: {
    type: DataTypes21.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  match_title: {
    type: DataTypes21.STRING,
    allowNull: false
  },
  eventid: {
    type: DataTypes21.STRING,
    allowNull: false
  },
  match_id: {
    type: DataTypes21.STRING,
    allowNull: false
  },
  market_type: {
    type: DataTypes21.STRING,
    allowNull: false
  },
  game_type: {
    type: DataTypes21.STRING,
    allowNull: false
  },
  winnerId: {
    type: DataTypes21.INTEGER,
    allowNull: true,
    field: "winnerId"
  },
  winnerName: {
    type: DataTypes21.STRING,
    allowNull: true,
    field: "winnerName"
  },
  fancyName: {
    type: DataTypes21.STRING,
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
