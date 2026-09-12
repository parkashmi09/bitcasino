'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)
//
// NOTE: this table has no PRIMARY KEY in the database. Sequelize needs a row
// identity, so the model uses id column (no PRIMARY KEY constraint in the database).
// Uniqueness is NOT enforced by the database — do not assume it.

const { Model, DataTypes } = require('sequelize');

class House extends Model {}

module.exports = (sequelize) => {
  House.init({
    uid: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "uid",
    },
    max: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "max",
    },
    current: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "current",
    },
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
  }, {
    sequelize,
    modelName: "House",
    tableName: "house",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return House;
};
