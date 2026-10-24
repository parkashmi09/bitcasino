'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: payments (owned by user-service)
//
// Foreign keys:
//   user_id -> users(id) ON DELETE CASCADE

const { Model, DataTypes } = require('sequelize');

class FiatDeposits extends Model {}

module.exports = (sequelize) => {
  FiatDeposits.init({
    deposit_id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "deposit_id",
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      references: { model: "users", key: "id" },
      onDelete: "CASCADE",
      field: "user_id",
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "amount",
    },
    currency: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: "INR",
      field: "currency",
    },
    bank_name: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "bank_name",
    },
    account_number: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "account_number",
    },
    ifsc_code: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "ifsc_code",
    },
    account_holder_name: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "account_holder_name",
    },
    upi_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "upi_id",
    },
    screenshot_path: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "screenshot_path",
    },
    transaction_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      unique: "fiat_deposits_transaction_id_key",
      field: "transaction_id",
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: "pending",
      field: "status",
    },
    admin_comment: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "admin_comment",
    },
    handled_by: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "handled_by",
    },
    handled_at: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "handled_at",
    },
  }, {
    sequelize,
    modelName: "FiatDeposits",
    tableName: "fiat_deposits",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        name: "idx_fiat_deposits_status",
        fields: ["status"],
      },
      {
        name: "idx_fiat_deposits_transaction_id",
        fields: ["transaction_id"],
      },
      {
        name: "idx_fiat_deposits_user_id",
        fields: ["user_id"],
      },
    ],
  });

  return FiatDeposits;
};
