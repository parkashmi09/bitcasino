'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: payments (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class PayInTransactions extends Model {}

module.exports = (sequelize) => {
  PayInTransactions.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "user_id",
    },
    transaction_id: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "transaction_id",
    },
    out_trade_no: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: "pay_in_transactions_out_trade_no_key",
      field: "out_trade_no",
    },
    currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      field: "currency",
    },
    amount: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      field: "amount",
    },
    pay_amount: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: true,
      field: "pay_amount",
    },
    merchant_ratio: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      field: "merchant_ratio",
    },
    real_amount: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: true,
      field: "real_amount",
    },
    status: {
      type: DataTypes.SMALLINT,
      allowNull: true,
      defaultValue: "0",
      field: "status",
    },
    pay_type: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "pay_type",
    },
  }, {
    sequelize,
    modelName: "PayInTransactions",
    tableName: "pay_in_transactions",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      {
        name: "idx_payin_status",
        fields: ["status"],
      },
      {
        name: "idx_payin_user_id",
        fields: ["user_id"],
      },
    ],
  });

  return PayInTransactions;
};
