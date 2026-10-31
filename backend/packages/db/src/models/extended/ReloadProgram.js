'use strict';

// HAND-WRITTEN model (not generated). Table created by migration 165 (rainbet).
// Domain: extended — written and read by user-service.

const { Model, DataTypes } = require('sequelize');

/** One reload reward program (DAILY_RELOAD / PRE_MONTHLY) — see migration 165. */
class ReloadProgram extends Model {}

module.exports = (sequelize) => {
  ReloadProgram.init(
    {
      key: { type: DataTypes.STRING(16), primaryKey: true, allowNull: false, field: 'key' },
      enabled: { type: DataTypes.BOOLEAN, allowNull: false, field: 'enabled' },
      percent: { type: DataTypes.DECIMAL(6, 3), allowNull: false, field: 'percent' },
      min_vip_level: { type: DataTypes.INTEGER, allowNull: false, field: 'min_vip_level' },
      updated_at: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
    },
    {
      sequelize,
      modelName: 'ReloadProgram',
      tableName: 'reload_programs',
      schema: sequelize.options.schema || 'public',
      freezeTableName: true,
      underscored: false,
      timestamps: false,
    }
  );

  return ReloadProgram;
};
