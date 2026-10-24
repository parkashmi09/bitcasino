'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class SwapHistory extends Model {}

module.exports = (sequelize) => {
  SwapHistory.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    uid: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "uid",
    },
    from_currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      field: "from_currency",
    },
    to_currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      field: "to_currency",
    },
    from_amount: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      field: "from_amount",
    },
    to_amount: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      field: "to_amount",
    },
    fee_percentage: {
      type: DataTypes.DECIMAL(5, 4),
      allowNull: false,
      field: "fee_percentage",
    },
    fee_amount: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      field: "fee_amount",
    },
    fee_currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      field: "fee_currency",
    },
    usd_rate_from: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      field: "usd_rate_from",
    },
    usd_rate_to: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      field: "usd_rate_to",
    },
  }, {
    sequelize,
    modelName: "SwapHistory",
    tableName: "swap_history",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        name: "idx_swap_history_uid",
        fields: ["uid"],
      },
    ],
  });

  return SwapHistory;
};
