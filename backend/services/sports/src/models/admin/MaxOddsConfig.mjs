// model/admin/MaxOddsConfig.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";
import { DEFAULT_LEAGUE_KEY, isValidLeagueKey } from "../../lib/constants/commissionLeagues.mjs";

init_db();
import { DataTypes as DataTypes12 } from "sequelize";
var MaxOddsConfig = db_default.define("MaxOddsConfig", {
  id: {
    type: DataTypes12.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  sport_id: {
    type: DataTypes12.INTEGER,
    allowNull: false,
    comment: "feed etid (4 = Cricket)"
  },
  league_key: {
    type: DataTypes12.STRING(32),
    allowNull: false,
    defaultValue: DEFAULT_LEAGUE_KEY,
    comment: "default | ecricket | t10xi | t5xi | vcl | wwevirtual"
  },
  category: {
    type: DataTypes12.STRING(20),
    allowNull: false,
    comment: "'match_odds' | 'bookmaker'"
  },
  max_odds: {
    type: DataTypes12.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0,
    comment: "bet refused when rate > this; 0 = no cap"
  },
  limited_overs_only: {
    type: DataTypes12.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    comment: "cricket only: Oneday/T20 capped, Test exempt"
  }
}, {
  tableName: "max_odds_configs",
  timestamps: true,
  // Uniqueness lives here, never inline on the column: an inline `unique`
  // makes Sequelize emit a fresh ADD CONSTRAINT on every sync, which is how
  // this platform's DBs collected thousands of duplicate unique constraints.
  indexes: [
    {
      name: "max_odds_configs_sport_league_category_uniq",
      unique: true,
      fields: ["sport_id", "league_key", "category"]
    }
  ]
});
MaxOddsConfig.CATEGORIES = ["match_odds", "bookmaker"];
MaxOddsConfig.MAX_VALUE = 1e3;
MaxOddsConfig.LIMITED_OVERS_SPORT_ID = 4;
MaxOddsConfig.DEFAULT_LEAGUE_KEY = DEFAULT_LEAGUE_KEY;
MaxOddsConfig.isValidLeagueKey = isValidLeagueKey;
MaxOddsConfig.categoryFromGtype = (gtype) => {
  const g = String(gtype || "").toLowerCase();
  if (g === "match") return "match_odds";
  if (g === "match1") return "bookmaker";
  return null;
};
var MaxOddsConfig_default = MaxOddsConfig;

export { MaxOddsConfig_default };
