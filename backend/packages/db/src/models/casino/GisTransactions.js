'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: casino (owned by casino-service)
//
// Foreign keys:
//   session_id -> gis_sessions(session_id)

const { Model, DataTypes } = require('sequelize');

class GisTransactions extends Model {}

module.exports = (sequelize) => {
  GisTransactions.init({
    id: {
      type: DataTypes.BIGINT,
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
    session_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      references: { model: "gis_sessions", key: "session_id" },
      field: "session_id",
    },
    transaction_id: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: "gis_transactions_transaction_id_key",
      field: "transaction_id",
    },
    action: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "action",
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: true,
      field: "amount",
    },
    currency: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "currency",
    },
    game_uuid: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "game_uuid",
    },
    type: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "type",
    },
    freespin_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "freespin_id",
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "quantity",
    },
    round_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "round_id",
    },
    finished: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      field: "finished",
    },
    transaction_datetime: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "transaction_datetime",
    },
    casino_request_retry_count: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: "casino_request_retry_count",
    },
    bet_transaction_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "bet_transaction_id",
    },
    rollback_transactions: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "rollback_transactions",
    },
    provider_round_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "provider_round_id",
    },
    balance_after: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "balance_after",
    },
    response_json: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "response_json",
    },
  }, {
    sequelize,
    modelName: "GisTransactions",
    tableName: "gis_transactions",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        name: "idx_bet_round",
        fields: ["transaction_id", "round_id"],
      },
      {
        name: "idx_gis_transactions_action",
        fields: ["action"],
      },
      {
        name: "idx_gis_transactions_bet_transaction_id",
        fields: ["bet_transaction_id"],
      },
      {
        name: "idx_gis_transactions_created_at",
        fields: ["created_at"],
      },
      {
        name: "idx_gis_transactions_round_id",
        fields: ["round_id"],
      },
      {
        name: "idx_gis_transactions_transaction_id",
        fields: ["transaction_id"],
      },
      {
        name: "idx_gis_transactions_user_currency",
        fields: ["user_id", "currency"],
      },
      {
        name: "idx_gis_transactions_user_id",
        fields: ["user_id"],
      },
      {
        name: "uniq_refund_per_bet",
        fields: ["bet_transaction_id"],
      },
    ],
  });

  return GisTransactions;
};
