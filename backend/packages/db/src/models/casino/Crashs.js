'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class Crashs extends Model {}

module.exports = (sequelize) => {
  Crashs.init({
    gid: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "gid",
    },
    busted: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      field: "busted",
    },
    hash: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "hash",
    },
    date: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
      field: "date",
    },
    numbers: {
      type: DataTypes.JSON,
      allowNull: true,
      field: "numbers",
    },
  }, {
    sequelize,
    modelName: "Crashs",
    tableName: "crashs",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  Crashs.removeAttribute('id');

  return Crashs;
};
