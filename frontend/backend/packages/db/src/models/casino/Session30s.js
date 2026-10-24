'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class Session30s extends Model {}

module.exports = (sequelize) => {
  Session30s.init({
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
    win: {
      type: DataTypes.STRING(250),
      allowNull: true,
      field: "win",
    },
  }, {
    sequelize,
    modelName: "Session30s",
    tableName: "session_30s",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  Session30s.removeAttribute('id');

  return Session30s;
};
