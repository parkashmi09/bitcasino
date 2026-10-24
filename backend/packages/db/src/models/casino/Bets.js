'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)
//
// NOTE: this table has no PRIMARY KEY in the database. Sequelize needs a row
// identity, so the model uses id column (no PRIMARY KEY constraint in the database).
// Uniqueness is NOT enforced by the database — do not assume it.

const { Model, DataTypes } = require('sequelize');

class Bets extends Model {}

module.exports = (sequelize) => {
  Bets.init({
    game: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "game",
    },
    gid: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "gid",
    },
    uid: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "uid",
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "amount",
    },
    coin: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "coin",
    },
    result: {
      type: DataTypes.JSON,
      allowNull: true,
      field: "result",
    },
    profit: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      defaultValue: "0",
      field: "profit",
    },
    hash: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "hash",
    },
    name: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "name",
    },
    cashout: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      field: "cashout",
    },
    slot: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "slot",
    },
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
  }, {
    sequelize,
    modelName: "Bets",
    tableName: "bets",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created",
    updatedAt: false,
  });

  return Bets;
};
