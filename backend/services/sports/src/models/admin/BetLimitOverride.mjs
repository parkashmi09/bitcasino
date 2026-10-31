// model/admin/BetLimitOverride.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes8 } from "sequelize";
var BetLimitOverride = db_default.define("BetLimitOverride", {
  id: {
    type: DataTypes8.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  scope: {
    type: DataTypes8.STRING(10),
    allowNull: false,
    comment: "'sports'"
  },
  sport_id: {
    type: DataTypes8.INTEGER,
    allowNull: true
  },
  event_id: {
    type: DataTypes8.STRING(40),
    allowNull: true,
    comment: "sports scope only \u2014 feed gmid"
  },
  market_id: {
    type: DataTypes8.STRING(60),
    allowNull: true,
    comment: "sports scope only \u2014 feed mid"
  },
  market_name: {
    type: DataTypes8.STRING(120),
    allowNull: true,
    comment: "display only (admin list)"
  },
  gtype: {
    type: DataTypes8.STRING(30),
    allowNull: true,
    comment: "display only (admin list)"
  },
  event_name: {
    type: DataTypes8.STRING(200),
    allowNull: true,
    comment: "display only (admin list)"
  },
  min_stake: {
    type: DataTypes8.DECIMAL(15, 2),
    allowNull: true,
    comment: "NULL = use the feed value"
  },
  max_stake: {
    type: DataTypes8.DECIMAL(15, 2),
    allowNull: true,
    comment: "NULL = use the feed value"
  },
  is_active: {
    type: DataTypes8.BOOLEAN,
    allowNull: false,
    defaultValue: true
  },
  // Sports scope only. Stamped the first time the cleanup job finds the
  // event gone from the live board; cleared again if it comes back. The row
  // is deleted once this is older than the grace window (see
  // jobs/betLimitCleanupJob.js). NULL = the match is still running.
  ended_at: {
    type: DataTypes8.DATE,
    allowNull: true,
    comment: "when the event left the live board; row is purged after the grace window"
  }
}, {
  tableName: "bet_limit_overrides",
  timestamps: true,
  // See BetBufferConfig for why uniqueness is declared here and not inline.
  indexes: [
    {
      name: "bet_limit_overrides_sports_uniq",
      unique: true,
      fields: ["scope", "event_id", "market_id"]
    }
  ]
});
BetLimitOverride.SCOPES = ["sports"];
var BetLimitOverride_default = BetLimitOverride;

export { BetLimitOverride_default };
