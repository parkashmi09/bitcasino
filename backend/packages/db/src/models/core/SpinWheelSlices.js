'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class SpinWheelSlices extends Model {}

module.exports = (sequelize) => {
  SpinWheelSlices.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    label: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: "label",
    },
    reward_pct: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: false,
      defaultValue: "0",
      field: "reward_pct",
    },
    color: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: "#000000",
      field: "color",
    },
    sort_order: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: "0",
      field: "sort_order",
    },
    is_bad_luck: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "is_bad_luck",
    },
    weight: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: "10",
      field: "weight",
    },
  }, {
    sequelize,
    modelName: "SpinWheelSlices",
    tableName: "spin_wheel_slices",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
  });

  return SpinWheelSlices;
};
