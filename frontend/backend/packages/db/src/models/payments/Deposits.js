'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: payments (owned by user-service)
//
// NOTE: this table has no PRIMARY KEY in the database. Sequelize needs a row
// identity, so the model uses id column (no PRIMARY KEY constraint in the database).
// Uniqueness is NOT enforced by the database — do not assume it.

const { Model, DataTypes } = require('sequelize');

class Deposits extends Model {}

module.exports = (sequelize) => {
  Deposits.init({
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
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "status",
    },
    txtid: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "txtid",
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "amount",
    },
    coin: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "coin",
    },
    salt: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "salt",
    },
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
  }, {
    sequelize,
    modelName: "Deposits",
    tableName: "deposits",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return Deposits;
};
