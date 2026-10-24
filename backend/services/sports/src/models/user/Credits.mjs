// model/user/Credits.js — added: the platform wallet (public.credits), which replaces Wallets for the player
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes } from "sequelize";
var Credits = db_default.define(
  "Credits",
  {
    // The platform wallet row: one per player, identified by `uid` (UNIQUE, 007).
    uid: { type: DataTypes.BIGINT, primaryKey: true, allowNull: false },
    // The wallet id `point_ledger.wallet_id` stores (migration 095).
    id: { type: DataTypes.BIGINT, allowNull: false, unique: true },
    // The sportsbook spends and pays out this column only.
    inr: { type: DataTypes.DECIMAL, allowNull: true, defaultValue: 0 },
    credit: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    all_point: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    upper_point: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    down_point: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    sports_pts: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    thirdparty_pts: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 }
  },
  {
    schema: "public",
    tableName: "credits",
    timestamps: false
  }
);
var Credits_default = Credits;

export { Credits_default };
