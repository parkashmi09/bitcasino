'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class TransactionLive extends Model {}

module.exports = (sequelize) => {
  TransactionLive.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    method: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "method",
    },
    user_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "user_code",
    },
    user_balance: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "user_balance",
    },
    game_type: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "game_type",
    },
    provider_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "provider_code",
    },
    game_code: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "game_code",
    },
    type: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "type",
    },
    bet_money: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "bet_money",
    },
    win_money: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "win_money",
    },
    txn_id: {
      type: DataTypes.STRING(50),
      allowNull: true,
      field: "txn_id",
    },
    txn_type: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: "txn_type",
    },
  }, {
    sequelize,
    modelName: "TransactionLive",
    tableName: "transaction_live",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
  });

  return TransactionLive;
};
