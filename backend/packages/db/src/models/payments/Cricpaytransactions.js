'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: payments (owned by user-service)
//
// Foreign keys:
//   uid -> credits(uid)

const { Model, DataTypes } = require('sequelize');

class Cricpaytransactions extends Model {}

module.exports = (sequelize) => {
  Cricpaytransactions.init({
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
      references: { model: "credits", key: "uid" },
      field: "uid",
    },
    transaction_code: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: "cricpaytransactions_transaction_code_key",
      field: "transaction_code",
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "amount",
    },
    payment_method: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: "payment_method",
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      field: "status",
    },
    fee: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "fee",
    },
    remark: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "remark",
    },
  }, {
    sequelize,
    modelName: "Cricpaytransactions",
    tableName: "cricpaytransactions",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  });

  return Cricpaytransactions;
};
