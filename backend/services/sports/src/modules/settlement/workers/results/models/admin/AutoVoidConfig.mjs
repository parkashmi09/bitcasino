// model/admin/AutoVoidConfig.js — mssports results worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes7 } from "sequelize";
var AutoVoidConfig = db_default.define("AutoVoidConfig", {
  id: {
    type: DataTypes7.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  enabled: {
    type: DataTypes7.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  delay_seconds: {
    type: DataTypes7.INTEGER,
    allowNull: false,
    defaultValue: 600,
    comment: "seconds after the anchor result is first seen before the void fires"
  },
  on_match_odds: {
    type: DataTypes7.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: "a settled/void MATCH_ODDS market starts the timer"
  },
  on_bookmaker: {
    type: DataTypes7.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    comment: "a settled/void BOOKMAKER market starts the timer"
  },
  enabled_at: {
    type: DataTypes7.DATE,
    allowNull: true,
    comment: "last OFF -> ON switch; a void never fires before enabled_at + delay"
  }
}, {
  tableName: "auto_void_config",
  timestamps: true
});
var AUTO_VOID_ROW_ID = 1;
var AUTO_VOID_MAX_DELAY = 24 * 3600;
var getAutoVoidConfig = async () => {
  const [row] = await AutoVoidConfig.findOrCreate({
    where: { id: AUTO_VOID_ROW_ID },
    defaults: { id: AUTO_VOID_ROW_ID }
  });
  return row;
};
var AutoVoidConfig_default = AutoVoidConfig;

export { getAutoVoidConfig, AutoVoidConfig_default };
