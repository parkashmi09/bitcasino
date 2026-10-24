'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class Bets30s extends Model {}

module.exports = (sequelize) => {
  Bets30s.init({
    uid: {
      type: DataTypes.STRING(250),
      allowNull: true,
      field: "uid",
    },
    value: {
      type: DataTypes.STRING(250),
      allowNull: true,
      field: "value",
    },
    amount: {
      type: DataTypes.STRING(250),
      allowNull: true,
      field: "amount",
    },
    sessionid: {
      type: DataTypes.STRING(250),
      allowNull: true,
      field: "sessionid",
    },
    status: {
      type: DataTypes.STRING(250),
      allowNull: true,
      field: "status",
    },
    cointype: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "cointype",
    },
  }, {
    sequelize,
    modelName: "Bets30s",
    tableName: "bets_30s",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  Bets30s.removeAttribute('id');

  return Bets30s;
};
