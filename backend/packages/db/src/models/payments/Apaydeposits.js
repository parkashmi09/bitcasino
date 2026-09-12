'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: payments (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class Apaydeposits extends Model {}

module.exports = (sequelize) => {
  Apaydeposits.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    order_id: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: "apaydeposits_order_id_key",
      field: "order_id",
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "user_id",
    },
    amount: {
      type: DataTypes.DECIMAL(18, 2),
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
      field: "custom_transaction_id",
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: "Pending",
      field: "status",
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
  }, {
    sequelize,
    modelName: "Apaydeposits",
    tableName: "apaydeposits",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_apaydeposits_order_id",
        fields: ["order_id"],
      },
      {
        name: "idx_apaydeposits_status",
        fields: ["status"],
      },
      {
        name: "idx_apaydeposits_user_id",
        fields: ["user_id"],
      },
    ],
  });

  return Apaydeposits;
};
