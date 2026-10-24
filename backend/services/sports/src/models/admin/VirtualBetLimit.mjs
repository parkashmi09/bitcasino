// model/admin/VirtualBetLimit.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";
import { COMMISSION_LEAGUES } from "../../lib/constants/commissionLeagues.mjs";

init_db();
import { DataTypes as DataTypes13 } from "sequelize";
var VirtualBetLimit = db_default.define("VirtualBetLimit", {
  id: {
    type: DataTypes13.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  sport_id: {
    type: DataTypes13.INTEGER,
    allowNull: false
  },
  league_key: {
    type: DataTypes13.STRING(40),
    allowNull: false,
    comment: "commissionLeagues key: ecricket, t10xi, t5xi, vcl, wwevirtual"
  },
  min_stake: {
    type: DataTypes13.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  max_stake: {
    type: DataTypes13.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  }
}, {
  tableName: "virtual_bet_limits",
  timestamps: true,
  indexes: [{ unique: true, fields: ["sport_id", "league_key"] }]
});
var SEED_MIN = { ecricket: 200 };
var DEFAULT_SEED_MIN = 100;
var virtualLeagues = () => Object.entries(COMMISSION_LEAGUES).flatMap(([sid, list]) => list.map(({ key, label }) => ({ sport_id: Number(sid), league_key: key, label })));
var seedVirtualBetLimits = async () => {
  for (const { sport_id, league_key } of virtualLeagues()) {
    await VirtualBetLimit.findOrCreate({
      where: { sport_id, league_key },
      defaults: { sport_id, league_key, min_stake: SEED_MIN[league_key] ?? DEFAULT_SEED_MIN, max_stake: 0 }
    });
  }
};
var VirtualBetLimit_default = VirtualBetLimit;

export { virtualLeagues, seedVirtualBetLimits, VirtualBetLimit_default };
