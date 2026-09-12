'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class Team extends Model {}

module.exports = (sequelize) => {
  Team.init({
    ownername: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "ownername",
    },
    membername: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "membername",
    },
    referalCode: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "referalCode",
    },
  }, {
    sequelize,
    modelName: "Team",
    tableName: "team",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  Team.removeAttribute('id');

  return Team;
};
