// model/admin/PlatformGames.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes22 } from "sequelize";
var PlatformGames = db_default.define(
  "PlatformGames",
  {
    id: {
      type: DataTypes22.INTEGER,
      primaryKey: true,
      allowNull: false
    },
    name: {
      type: DataTypes22.STRING,
      allowNull: false,
      unique: true
    },
    sport_id: {
      type: DataTypes22.TEXT,
      allowNull: true,
      unique: true
    }
  },
  {
    tableName: "platform_games",
    timestamps: false
  }
);
PlatformGames.FIXED_GAMES = [
  { id: 4, name: "Cricket", sport_id: "4" },
  { id: 65, name: "Greyhound", sport_id: "65" },
  { id: 10, name: "HorseRace", sport_id: "10" },
  { id: 1, name: "Soccer", sport_id: "1" },
  { id: 2, name: "Tennis", sport_id: "2" }
];
PlatformGames.syncFixedData = async () => {
  for (const game of PlatformGames.FIXED_GAMES) {
    await PlatformGames.findOrCreate({
      where: { id: game.id },
      defaults: game
    });
  }
  console.log("\u2705 PlatformGames table verified and fixed data ensured.");
};
var PlatformGames_default = PlatformGames;

export { PlatformGames_default };
