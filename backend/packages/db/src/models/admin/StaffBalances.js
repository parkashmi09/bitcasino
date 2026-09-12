'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)
//
// Foreign keys:
//   staff_id -> staff(id) ON DELETE CASCADE

const { Model, DataTypes } = require('sequelize');

class StaffBalances extends Model {}

module.exports = (sequelize) => {
  StaffBalances.init({
    staff_id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      references: { model: "staff", key: "id" },
      onDelete: "CASCADE",
      field: "staff_id",
    },
    inr: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: "0",
      field: "inr",
    },
    credit_limit: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "credit_limit",
    },
    exposure_limit: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "exposure_limit",
    },
    gt: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "gt",
    },
    casino_gt: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "casino_gt",
    },
  }, {
    sequelize,
    modelName: "StaffBalances",
    tableName: "staff_balances",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return StaffBalances;
};
