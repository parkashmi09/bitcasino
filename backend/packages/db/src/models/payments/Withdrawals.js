'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: payments (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class Withdrawals extends Model {}

module.exports = (sequelize) => {
  Withdrawals.init({
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
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "amount",
    },
    wallet: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "wallet",
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "status",
    },
    coin: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "coin",
    },
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    chain: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "chain",
    },
  }, {
    sequelize,
    modelName: "Withdrawals",
    tableName: "withdrawals",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return Withdrawals;
};
