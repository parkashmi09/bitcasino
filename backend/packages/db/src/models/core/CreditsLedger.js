'use strict';

// AUTO-GENERATED from 000_baseline_schema.sql — do not edit by hand.
// Regenerate with: npm run generate:models --workspace @ibitplay/db
// Domain: core (owned by user-service)

const { Model, DataTypes } = require('sequelize');

class CreditsLedger extends Model {}

module.exports = (sequelize) => {
  CreditsLedger.init({
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
      allowNull: false,
      field: "id",
    },
    user_id: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "user_id",
    },
    currency: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: "INR",
      field: "currency",
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      field: "amount",
    },
    reason: {
      type: DataTypes.TEXT,
      allowNull: false,
      field: "reason",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "description",
    },
    eventid: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "eventid",
    },
    job_id: {
      type: DataTypes.UUID,
      allowNull: true,
      field: "job_id",
    },
    match_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "match_id",
    },
    meta: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: "meta",
    },
    market_type: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "market_type",
    },
    sport_id: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: "sport_id",
    },
    commission: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: true,
      field: "commission",
    },
    netamount: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: true,
      field: "netamount",
    },
    profit: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: true,
      field: "profit",
    },
    loss: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: true,
      field: "loss",
    },
    bet_id: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: "bet_id",
    },
    closing: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: true,
      field: "closing",
    },
    balance: {
      type: DataTypes.DECIMAL(18, 2),
      allowNull: true,
      defaultValue: "0",
      field: "balance",
    },
  }, {
    sequelize,
    modelName: "CreditsLedger",
    tableName: "credits_ledger",
    schema: sequelize.options.schema || 'public',
    freezeTableName: true,
    underscored: false,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      {
        name: "idx_credits_ledger_created_at",
        fields: ["created_at"],
      },
      {
        name: "idx_credits_ledger_eventid",
        fields: ["eventid"],
      },
      {
        name: "idx_credits_ledger_user_id",
        fields: ["user_id"],
      },
    ],
  });

  return CreditsLedger;
};
