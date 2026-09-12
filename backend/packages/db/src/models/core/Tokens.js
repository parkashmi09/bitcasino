'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class Tokens extends Model {}

module.exports = (sequelize) => {
  Tokens.init({
    uid: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "uid",
    },
    key: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "key",
    },
  }, {
    sequelize,
    modelName: "Tokens",
    tableName: "tokens",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  Tokens.removeAttribute('id');

  return Tokens;
};
