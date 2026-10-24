// model/user/SportsAutoVoidState.js — mssports results worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes8 } from "sequelize";
var SportsAutoVoidState = db_default.define("SportsAutoVoidState", {
  eventid: {
    type: DataTypes8.STRING,
    primaryKey: true
  },
  sport_id: {
    type: DataTypes8.STRING,
    allowNull: true
  },
  match_title: {
    type: DataTypes8.STRING,
    allowNull: true
  },
  anchor_market: {
    type: DataTypes8.STRING(32),
    allowNull: false,
    comment: "MATCH_ODDS | BOOKMAKER \u2014 the feed market that started the timer"
  },
  anchor_status: {
    type: DataTypes8.STRING(16),
    allowNull: false,
    comment: "SETTLE | VOID as the feed reported it"
  },
  anchor_seen_at: {
    type: DataTypes8.DATE,
    allowNull: false
  },
  last_fired_at: {
    type: DataTypes8.DATE,
    allowNull: true
  },
  fire_count: {
    type: DataTypes8.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  bets_voided: {
    type: DataTypes8.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  void_group_ids: {
    type: DataTypes8.JSONB,
    allowNull: true,
    comment: "bet_void_audit.void_group_id of every group this row fired"
  },
  last_error: {
    type: DataTypes8.TEXT,
    allowNull: true
  }
}, {
  tableName: "sports_auto_void_state",
  timestamps: true
});
var SportsAutoVoidState_default = SportsAutoVoidState;

export { SportsAutoVoidState_default };
