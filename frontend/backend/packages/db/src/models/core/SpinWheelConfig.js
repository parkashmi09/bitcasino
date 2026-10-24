'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class SpinWheelConfig extends Model {}

module.exports = (sequelize) => {
  SpinWheelConfig.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    min_deposit: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: "100",
      field: "min_deposit",
    },
    reward_pct: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: "5.00",
      field: "reward_pct",
    },
    claim_cooldown_days: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: "7",
      field: "claim_cooldown_days",
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: "is_active",
    },
    unlimited_spin: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "unlimited_spin",
    },
  }, {
    sequelize,
    modelName: "SpinWheelConfig",
    tableName: "spin_wheel_config",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return SpinWheelConfig;
};
