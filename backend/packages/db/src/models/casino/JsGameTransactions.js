'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)

const { Model, DataTypes } = require('sequelize');

class JsGameTransactions extends Model {}

module.exports = (sequelize) => {
  JsGameTransactions.init({
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    user_id: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: "user_id",
    },
    game_uid: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: "game_uid",
    },
    transaction_type: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: "transaction_type",
    },
    amount: {
      type: DataTypes.DECIMAL(18, 8),
      allowNull: false,
      field: "amount",
    },
    currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      field: "currency",
    },
    transaction_status: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: "transaction_status",
    },
    external_transaction_id: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "external_transaction_id",
    },
    serial_number: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: "serial_number",
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
      field: "timestamp",
    },
    additional_data: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "additional_data",
    },
  }, {
    sequelize,
    modelName: "JsGameTransactions",
    tableName: "js_game_transactions",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: false,
    indexes: [
      {
        name: "idx_game_transactions_game",
        fields: ["game_uid"],
      },
      {
        name: "idx_game_transactions_user",
        fields: ["user_id"],
      },
    ],
  });

  return JsGameTransactions;
};
