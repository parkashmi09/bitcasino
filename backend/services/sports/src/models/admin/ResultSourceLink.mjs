// model/admin/ResultSourceLink.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes38 } from "sequelize";
var ResultSourceLink = db_default.define("ResultSourceLink", {
  id: {
    type: DataTypes38.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes38.STRING(60),
    allowNull: false
  },
  url: {
    type: DataTypes38.STRING(1e3),
    allowNull: false
  },
  sport_id: {
    type: DataTypes38.STRING(10),
    allowNull: true
  },
  sort_order: {
    type: DataTypes38.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  active: {
    type: DataTypes38.BOOLEAN,
    allowNull: false,
    defaultValue: true
  }
}, {
  tableName: "result_source_links",
  timestamps: true
});
var DEFAULT_LINKS = [
  { name: "Cricbuzz Live", url: "https://www.cricbuzz.com/cricket-match/live-scores", sport_id: "4", sort_order: 1 },
  { name: "Cricbuzz Recent", url: "https://www.cricbuzz.com/cricket-match/live-scores/recent-matches", sport_id: "4", sort_order: 2 },
  { name: "ESPNcricinfo", url: "https://www.espncricinfo.com/live-cricket-score", sport_id: "4", sort_order: 3 },
  { name: "Flashscore", url: "https://www.flashscore.com/", sport_id: null, sort_order: 10 },
  { name: "SofaScore", url: "https://www.sofascore.com/", sport_id: null, sort_order: 11 },
  { name: "Google Scorecard", url: "https://www.google.com/search?q={match}+scorecard", sport_id: null, sort_order: 20 },
  { name: "Google", url: "https://www.google.com/search?q={match}+{market}", sport_id: null, sort_order: 30 }
];
var ready = null;
var ensureResultSourceLinks = () => {
  if (!ready) {
    ready = (async () => {
      await ResultSourceLink.sync();
      if (!await ResultSourceLink.count()) await ResultSourceLink.bulkCreate(DEFAULT_LINKS);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
};
var ResultSourceLink_default = ResultSourceLink;

export { ensureResultSourceLinks, ResultSourceLink_default };
