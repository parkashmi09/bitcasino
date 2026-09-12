'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class Windata30s extends Model {}

module.exports = (sequelize) => {
  Windata30s.init({
    uid: {
      type: DataTypes.STRING(250),
      allowNull: true,
      field: "uid",
    },
    sessionid: {
      type: DataTypes.STRING(250),
      allowNull: true,
      field: "sessionid",
    },
    winamount: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "winamount",
    },
    cointype: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "cointype",
    },
  }, {
    sequelize,
    modelName: "Windata30s",
    tableName: "windata_30s",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  Windata30s.removeAttribute('id');

  return Windata30s;
};
