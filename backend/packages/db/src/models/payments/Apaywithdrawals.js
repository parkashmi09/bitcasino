'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: payments (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class Apaywithdrawals extends Model {}

module.exports = (sequelize) => {
  Apaywithdrawals.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    order_id: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: "apaywithdrawals_order_id_key",
      field: "order_id",
    },
    user_id: {
      type: DataTypes.STRING(200),
      allowNull: false,
      field: "user_id",
    },
    amount: {
      type: DataTypes.DECIMAL(20, 2),
      allowNull: false,
      field: "amount",
    },
    currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      field: "currency",
    },
    payment_system: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: "payment_system",
    },
    custom_transaction_id: {
      type: DataTypes.STRING(200),
      allowNull: true,
      unique: "apaywithdrawals_custom_transaction_id_key",
      field: "custom_transaction_id",
    },
    status: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: "Pending",
      field: "status",
    },
    payout_details: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "payout_details",
    },
    payment_details: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "payment_details",
    },
    webhook_response: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "webhook_response",
    },
    error_reason: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "error_reason",
    },
    refunded: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: "refunded",
    },
  }, {
    sequelize,
    modelName: "Apaywithdrawals",
    tableName: "apaywithdrawals",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_apaywithdrawals_status",
        fields: ["status"],
      },
      {
        name: "idx_apaywithdrawals_user_id",
        fields: ["user_id"],
      },
    ],
  });

  return Apaywithdrawals;
};
