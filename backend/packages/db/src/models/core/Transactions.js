'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class Transactions extends Model {}

module.exports = (sequelize) => {
  Transactions.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    login: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "login",
    },
    session_id: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "session_id",
    },
    trade_id: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "trade_id",
    },
    bet: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: "bet",
    },
    win: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: "win",
    },
    balance_before: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: "balance_before",
    },
    balance_after: {
      type: DataTypes.DECIMAL(12, 2),
      allowNull: false,
      field: "balance_after",
    },
    action: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "action",
    },
    game_name: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "game_name",
    },
    bet_info: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "bet_info",
    },
    matrix: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "matrix",
    },
    date: {
      type: 'TIMESTAMP',
      allowNull: false,
      field: "date",
    },
    win_lines: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "win_lines",
    },
  }, {
    sequelize,
    modelName: "Transactions",
    tableName: "transactions",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return Transactions;
};
