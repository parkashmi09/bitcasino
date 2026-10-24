'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: payments (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class Ccdeposit extends Model {}

module.exports = (sequelize) => {
  Ccdeposit.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    userid: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "userid",
    },
    coinid: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "coinid",
    },
    price: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "price",
    },
    orderid: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "orderid",
    },
    chain: {
      type: DataTypes.STRING(10),
      allowNull: true,
      field: "chain",
    },
    deposit_address: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "deposit_address",
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
      field: "amount",
    },
    memo: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "memo",
    },
    checkout_url: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "checkout_url",
    },
    confirms_needed: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "confirms_needed",
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "status",
    },
  }, {
    sequelize,
    modelName: "Ccdeposit",
    tableName: "ccdeposit",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return Ccdeposit;
};
