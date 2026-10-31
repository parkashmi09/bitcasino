// model/user/SportsConfig.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes39, Model } from "sequelize";
var SportsConfig = class extends Model {
};
SportsConfig.init(
  {
    id: {
      type: DataTypes39.INTEGER,
      autoIncrement: true,
      primaryKey: true
    },
    game_id: {
      type: DataTypes39.INTEGER,
      allowNull: false
    },
    game_name: {
      type: DataTypes39.STRING(50),
      allowNull: false
    },
    enabled: {
      type: DataTypes39.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    created_at: {
      type: DataTypes39.DATE,
      allowNull: true,
      defaultValue: DataTypes39.NOW
    },
    updated_at: {
      type: DataTypes39.DATE,
      allowNull: true,
      defaultValue: DataTypes39.NOW
    }
  },
  {
    sequelize: db_default,
    modelName: "SportsConfig",
    tableName: "sports_config",
    timestamps: false
    // because you have custom created_at and updated_at
  }
);
var SportsConfig_default = SportsConfig;

export { SportsConfig_default };
