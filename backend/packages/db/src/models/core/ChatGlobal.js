'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// NOTE: no primary key and no unique column. This model supports reads and
// inserts; updates/deletes must go through an explicit WHERE clause.

const { Model, DataTypes } = require('sequelize');

class ChatGlobal extends Model {}

module.exports = (sequelize) => {
  ChatGlobal.init({
    name: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "name",
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "message",
    },
    sorter: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "sorter",
    },
    date: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
      field: "date",
    },
    avatar: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "avatar",
    },
    uid: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "uid",
    },
    time: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "time",
    },
    level: {
      type: DataTypes.BIGINT,
      allowNull: true,
      defaultValue: "1",
      field: "level",
    },
  }, {
    sequelize,
    modelName: "ChatGlobal",
    tableName: "chat_global",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  // This table has no primary key in the schema; drop Sequelize's implicit id
  // so generated SQL matches the real columns.
  ChatGlobal.removeAttribute('id');

  return ChatGlobal;
};
