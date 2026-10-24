'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: payments (owned by user-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class InrDeposit extends Model {}

module.exports = (sequelize) => {
  InrDeposit.init({
    uid: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "uid",
    },
    date: {
      type: 'TIMESTAMP',
      allowNull: false,
      field: "date",
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "status",
    },
    trxid: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "trxid",
    },
    amount: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "amount",
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "name",
    },
  }, {
    sequelize,
    modelName: "InrDeposit",
    tableName: "inr_deposit",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  InrDeposit.removeAttribute('id');

  return InrDeposit;
};
