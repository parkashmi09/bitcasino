'use strict';

// Hand-written: this table is created by a migration, not by the baseline
// schema, so the generator never sees it. See packages/db/migrations/.
// Domain: extended

const { Model, DataTypes } = require('sequelize');

class PayOutTransactions extends Model {}

module.exports = (sequelize) => {
  PayOutTransactions.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "user_id",
    },
    transaction_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "transaction_id",
    },
    out_trade_no: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "out_trade_no",
    },
    currency: {
      type: DataTypes.STRING(10),
      allowNull: true,
      field: "currency",
    },
    amount: {
      type: DataTypes.DECIMAL(20,8),
      allowNull: true,
      field: "amount",
    },
    status: {
      type: DataTypes.SMALLINT,
      allowNull: true,
      field: "status",
    },
    pay_type: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "pay_type",
    },
    account: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "account",
    },
    account_name: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "account_name",
    },
    ifsc_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "ifsc_code",
    },
    utr_number: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: "utr_number",
    },
  }, {
    sequelize,
    modelName: "PayOutTransactions",
    tableName: "pay_out_transactions",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return PayOutTransactions;
};
