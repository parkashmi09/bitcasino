'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class Messages extends Model {}

module.exports = (sequelize) => {
  Messages.init({
    room_key: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "room_key",
    },
    from_uid: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "from_uid",
    },
    to_uid: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "to_uid",
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "message",
    },
    date: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
      field: "date",
    },
    time: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "time",
    },
    from_name: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "from_name",
    },
    to_name: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "to_name",
    },
  }, {
    sequelize,
    modelName: "Messages",
    tableName: "messages",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  Messages.removeAttribute('id');

  return Messages;
};
