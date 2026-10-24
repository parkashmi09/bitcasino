'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)
//
// Foreign keys:
//   uid -> users(id) ON DELETE CASCADE

const { Model, DataTypes } = require('sequelize');

class Userconfig extends Model {}

module.exports = (sequelize) => {
  Userconfig.init({
    uid: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      allowNull: false,
      references: { model: "users", key: "id" },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
      field: "uid",
    },
    email_notifications: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "email_notifications",
    },
    push_notifications: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: true,
      field: "push_notifications",
    },
    theme: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: "dark",
      field: "theme",
    },
    language: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: "en",
      field: "language",
    },
    hide_balance: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
      field: "hide_balance",
    },
    updatedat: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "updatedat",
    },
  }, {
    sequelize,
    modelName: "Userconfig",
    tableName: "userconfig",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return Userconfig;
};
