// model/admin/CommissionConfig.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";
import { DEFAULT_LEAGUE_KEY, isValidLeagueKey, leagueKeyFromName } from "../../constants/commissionLeagues.mjs";

import { DataTypes as DataTypes20 } from "sequelize";
var CommissionConfig = db_default.define("CommissionConfig", {
  id: {
    type: DataTypes20.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  sport_id: {
    type: DataTypes20.INTEGER,
    allowNull: false,
    comment: "feed etid (4 = Cricket)"
  },
  league_key: {
    type: DataTypes20.STRING(32),
    allowNull: false,
    defaultValue: DEFAULT_LEAGUE_KEY,
    comment: "default | ecricket | t10xi | t5xi | vcl | wwevirtual"
  },
  market_key: {
    type: DataTypes20.STRING(24),
    allowNull: false,
    comment: "matchodds | match_other | bookmaker | match1_other | fancy | \u2026"
  },
  enabled: {
    type: DataTypes20.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  percent: {
    type: DataTypes20.DECIMAL(5, 2),
    allowNull: false,
    defaultValue: 2,
    comment: "commission % of net win"
  }
}, {
  tableName: "commission_configs",
  timestamps: true,
  // Uniqueness lives here, never inline on the column: an inline `unique`
  // makes Sequelize emit a fresh ADD CONSTRAINT on every sync, which is how
  // this platform's DBs collected thousands of duplicate unique constraints.
  indexes: [
    {
      name: "commission_configs_sport_league_market_uniq",
      unique: true,
      fields: ["sport_id", "league_key", "market_key"]
    }
  ]
});
CommissionConfig.MARKETS = [
  { key: "matchodds", label: "Match Odds", group: "Main", hint: "market name is exactly Match Odds" },
  { key: "match_other", label: "Other Main Markets", group: "Main", hint: "Over/Under, Correct Score, Match Result, Inning EvenOdd, Nth Ball\u2026" },
  { key: "bookmaker", label: "Bookmaker", group: "Bookmaker", hint: "Bookmaker, Bookmaker 2" },
  { key: "match1_other", label: "Other Bookmaker Markets", group: "Bookmaker", hint: "Tied Match, Completed Match, Score More Runs, BM Over/Under\u2026" },
  { key: "fancy", label: "Fancy", group: "Fancy", hint: "Normal, Over By Over, Ball By Ball" },
  { key: "fancy1", label: "Fancy1", group: "Fancy", hint: "" },
  { key: "fancy2", label: "Fancy2", group: "Fancy", hint: "Innings Overs/Runs lines" },
  { key: "oddeven", label: "Odd/Even", group: "Fancy", hint: "" },
  { key: "khado", label: "Khado", group: "Fancy", hint: "" },
  { key: "meter", label: "Meter", group: "Fancy", hint: "" },
  { key: "badlo", label: "Badlo", group: "Fancy", hint: "" },
  { key: "cricketcasino", label: "Cricket Casino", group: "Fancy", hint: "" },
  { key: "other", label: "Other", group: "Fancy", hint: "anything the feed ships with an unknown gtype" }
];
CommissionConfig.MARKET_KEYS = CommissionConfig.MARKETS.map((m) => m.key);
CommissionConfig.MAX_PERCENT = 50;
CommissionConfig.DEFAULT_PERCENT = 2;
var DIRECT_GTYPES = /* @__PURE__ */ new Set([
  "fancy",
  "fancy1",
  "fancy2",
  "oddeven",
  "khado",
  "meter",
  "badlo",
  "cricketcasino"
]);
var normMarketName = (name) => String(name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
CommissionConfig.marketKeyOfBet = (bet) => {
  if (bet?.badlo === true || String(bet?.badlo) === "true") return "badlo";
  let g = String(bet?.gtype || "").toLowerCase().trim();
  if (!g) {
    const gt = String(bet?.game_type || "").toUpperCase();
    if (gt === "MO" || gt === "MATCH") g = "match";
    else if (gt === "BM" || gt === "BOOKMAKER") g = "match1";
    else if (gt === "FAN" || gt === "FANCY") g = "fancy";
  }
  const name = normMarketName(bet?.market_type);
  if (g === "match") return name === "MATCHODDS" ? "matchodds" : "match_other";
  if (g === "match1") return name.startsWith("BOOKMAKER") ? "bookmaker" : "match1_other";
  if (DIRECT_GTYPES.has(g)) return g;
  return "other";
};
CommissionConfig.leagueKeyOfBet = (bet) => leagueKeyFromName(bet?.sport_id, bet?.league_name);
CommissionConfig.isValidLeagueKey = isValidLeagueKey;
CommissionConfig.DEFAULT_LEAGUE_KEY = DEFAULT_LEAGUE_KEY;
CommissionConfig.LEGACY_GTYPE_EXPANSION = {
  match: ["matchodds", "match_other"],
  match1: ["bookmaker", "match1_other"]
};
var CommissionConfig_default = CommissionConfig;

export { CommissionConfig_default };
