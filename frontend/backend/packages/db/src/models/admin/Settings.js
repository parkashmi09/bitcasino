'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: admin (owned by admin-service)
//
// NOTE: this table has no PRIMARY KEY in the database. Sequelize needs a row
// identity, so the model uses id column (no PRIMARY KEY constraint in the database).
// Uniqueness is NOT enforced by the database — do not assume it.

const { Model, DataTypes } = require('sequelize');

class Settings extends Model {}

module.exports = (sequelize) => {
  Settings.init({
    bots: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "bots",
    },
    id: {
      type: DataTypes.DECIMAL,
      primaryKey: true,
      allowNull: true,
      field: "id",
    },
  }, {
    sequelize,
    modelName: "Settings",
    tableName: "settings",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return Settings;
};
