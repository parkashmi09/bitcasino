// model/user/SportsAutoVoidState.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes37 } from "sequelize";
var SportsAutoVoidState = db_default.define("SportsAutoVoidState", {
  eventid: {
    type: DataTypes37.STRING,
    primaryKey: true
  },
  sport_id: {
    type: DataTypes37.STRING,
    allowNull: true
  },
  match_title: {
    type: DataTypes37.STRING,
    allowNull: true
  },
  anchor_market: {
    type: DataTypes37.STRING(32),
    allowNull: false,
    comment: "MATCH_ODDS | BOOKMAKER \u2014 the feed market that started the timer"
  },
  anchor_status: {
    type: DataTypes37.STRING(16),
    allowNull: false,
    comment: "SETTLE | VOID as the feed reported it"
  },
  anchor_seen_at: {
    type: DataTypes37.DATE,
    allowNull: false
  },
  last_fired_at: {
    type: DataTypes37.DATE,
    allowNull: true
  },
  fire_count: {
    type: DataTypes37.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  bets_voided: {
    type: DataTypes37.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  void_group_ids: {
    type: DataTypes37.JSONB,
    allowNull: true,
    comment: "bet_void_audit.void_group_id of every group this row fired"
  },
  last_error: {
    type: DataTypes37.TEXT,
    allowNull: true
  }
}, {
  tableName: "sports_auto_void_state",
  timestamps: true
});
