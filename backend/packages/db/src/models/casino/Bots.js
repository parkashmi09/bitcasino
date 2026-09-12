'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)
//
// NOTE: this table has no PRIMARY KEY in the database. Sequelize needs a row
// identity, so the model uses id column (no PRIMARY KEY constraint in the database).
// Uniqueness is NOT enforced by the database — do not assume it.

const { Model, DataTypes } = require('sequelize');

class Bots extends Model {}

module.exports = (sequelize) => {
  Bots.init({
    id: {
      type: DataTypes.DECIMAL,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    status: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "status",
    },
    time: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      field: "time",
    },
    game: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "game",
    },
    coin: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "coin",
    },
  }, {
    sequelize,
    modelName: "Bots",
    tableName: "bots",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return Bots;
};
