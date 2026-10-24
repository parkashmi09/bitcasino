'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: payments (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class FiatWithdrawals extends Model {}

module.exports = (sequelize) => {
  FiatWithdrawals.init({
    id: {
      type: DataTypes.INTEGER,
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
    date: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "date",
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
    bank_name: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "bank_name",
    },
    account_number: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "account_number",
    },
    account_holder_name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: "account_holder_name",
    },
    ifsc_code: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "ifsc_code",
    },
    upi_id: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "upi_id",
    },
    status: {
      type: DataTypes.STRING(30),
      allowNull: true,
      defaultValue: "In Queue",
      field: "status",
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "name",
    },
  }, {
    sequelize,
    modelName: "FiatWithdrawals",
    tableName: "fiat_withdrawals",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
    indexes: [
      {
        name: "fiat_withdrawals_date_idx",
        fields: ["date"],
      },
      {
        name: "fiat_withdrawals_status_idx",
        fields: ["status"],
      },
      {
        name: "fiat_withdrawals_uid_idx",
        fields: ["uid"],
      },
    ],
  });

  return FiatWithdrawals;
};
