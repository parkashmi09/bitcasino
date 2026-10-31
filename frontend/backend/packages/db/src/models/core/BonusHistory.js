'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class Bonushistory extends Model {}

module.exports = (sequelize) => {
  Bonushistory.init({
    userid: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "userid",
    },
    event: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "event",
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: "amount",
    },
    createdat: {
      type: 'TIMESTAMP',
      allowNull: false,
      field: "createdat",
    },
    updatedat: {
      type: 'TIMESTAMP',
      allowNull: false,
      field: "updatedat",
    },
  }, {
    sequelize,
    modelName: "Bonushistory",
    tableName: "bonushistory",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  Bonushistory.removeAttribute('id');

  return Bonushistory;
};
