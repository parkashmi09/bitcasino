'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// NOTE: this table has no PRIMARY KEY in the database. Sequelize needs a row
// identity, so the model uses id column (no PRIMARY KEY constraint in the database).
// Uniqueness is NOT enforced by the database — do not assume it.

const { Model, DataTypes } = require('sequelize');

class Rewards extends Model {}

module.exports = (sequelize) => {
  Rewards.init({
    ownername: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "ownername",
    },
    membername: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "membername",
    },
    referalCode: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "referalCode",
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "amount",
    },
    coin: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "coin",
    },
    type: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "type",
    },
    locked: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "locked",
    },
    referalmount: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      field: "referalmount",
    },
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
  }, {
    sequelize,
    modelName: "Rewards",
    tableName: "rewards",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  });

  return Rewards;
};
