'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class WalletHistory extends Model {}

module.exports = (sequelize) => {
  WalletHistory.init({
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
    username: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "username",
    },
    coin: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "coin",
    },
    operation: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "operation",
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "amount",
    },
    previous_balance: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "previous_balance",
    },
    new_balance: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "new_balance",
    },
    transaction_time: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
      field: "transaction_time",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "description",
    },
  }, {
    sequelize,
    modelName: "WalletHistory",
    tableName: "wallet_history",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return WalletHistory;
};
