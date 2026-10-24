'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: payments (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class Upideposit extends Model {}

module.exports = (sequelize) => {
  Upideposit.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    uid: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "uid",
    },
    transactioniduser: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "transactioniduser",
    },
    transactionidgateway: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "transactionidgateway",
    },
    transactiondate: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "transactiondate",
    },
    amount: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "amount",
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "status",
    },
  }, {
    sequelize,
    modelName: "Upideposit",
    tableName: "upideposit",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return Upideposit;
};
