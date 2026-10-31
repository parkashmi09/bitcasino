// model/admin/BetBufferConfig.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";
import { CommissionConfig_default } from "./CommissionConfig.mjs";
import { DEFAULT_LEAGUE_KEY, isValidLeagueKey, leagueKeyFromName } from "../../lib/constants/commissionLeagues.mjs";

init_db();
import { DataTypes as DataTypes10 } from "sequelize";
var BetBufferConfig = db_default.define("BetBufferConfig", {
  id: {
    type: DataTypes10.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  scope: {
    type: DataTypes10.STRING(10),
    allowNull: false,
    comment: "'sports'"
  },
  sport_id: {
    type: DataTypes10.INTEGER,
    allowNull: true,
    comment: "sports scope only \u2014 feed etid (4 = Cricket)"
  },
  league_key: {
    type: DataTypes10.STRING(32),
    allowNull: false,
    defaultValue: DEFAULT_LEAGUE_KEY,
    comment: "sports scope only \u2014 default | ecricket | t10xi | t5xi | vcl | wwevirtual"
  },
  category: {
    type: DataTypes10.STRING(20),
    allowNull: true,
    comment: "sports scope only \u2014 market key (CommissionConfig.MARKETS)"
  },
  buffer_seconds: {
    type: DataTypes10.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 0,
    comment: "0 = unset, caller uses its env default"
  }
}, {
  tableName: "bet_buffer_configs",
  timestamps: true,
  // Uniqueness lives here, never inline on the column: an inline `unique`
  // makes Sequelize emit a fresh ADD CONSTRAINT on every sync, which is how
  // this platform's DBs collected thousands of duplicate unique constraints.
  indexes: [
    {
      name: "bet_buffer_configs_sports_league_uniq",
      unique: true,
      fields: ["scope", "sport_id", "league_key", "category"]
    }
  ]
});
BetBufferConfig.SCOPES = ["sports"];
BetBufferConfig.MARKETS = CommissionConfig_default.MARKETS;
BetBufferConfig.MARKET_KEYS = CommissionConfig_default.MARKET_KEYS;
BetBufferConfig.DEFAULT_LEAGUE_KEY = DEFAULT_LEAGUE_KEY;
BetBufferConfig.isValidLeagueKey = isValidLeagueKey;
BetBufferConfig.LEGACY_CATEGORY_EXPANSION = {
  match_odds: ["matchodds", "match_other"],
  bookmaker: ["bookmaker", "match1_other"],
  fancy: ["fancy", "fancy1", "fancy2", "oddeven", "khado", "meter", "cricketcasino", "other"]
};
BetBufferConfig.CATEGORIES = Object.keys(BetBufferConfig.LEGACY_CATEGORY_EXPANSION);
BetBufferConfig.marketKeyOf = (bet) => CommissionConfig_default.marketKeyOfBet(bet);
BetBufferConfig.leagueKeyOf = (bet) => leagueKeyFromName(bet?.sport_id, bet?.league_name);
BetBufferConfig.categoryFromGtype = (gtype) => {
  const g = String(gtype || "").toLowerCase();
  if (g === "match") return "match_odds";
  if (g === "match1") return "bookmaker";
  return "fancy";
};
var BetBufferConfig_default = BetBufferConfig;

export { BetBufferConfig_default };
