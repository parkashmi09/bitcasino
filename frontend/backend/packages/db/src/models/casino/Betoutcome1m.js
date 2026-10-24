'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class Betoutcome1m extends Model {}

module.exports = (sequelize) => {
  Betoutcome1m.init({
    sessionid: {
      type: DataTypes.STRING(250),
      allowNull: true,
      field: "sessionid",
    },
    betnumber: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "betnumber",
    },
    betcolour: {
      type: DataTypes.STRING(250),
      allowNull: true,
      field: "betcolour",
    },
  }, {
    sequelize,
    modelName: "Betoutcome1m",
    tableName: "betoutcome_1m",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  Betoutcome1m.removeAttribute('id');

  return Betoutcome1m;
};
