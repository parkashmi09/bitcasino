// model/user/CreditsLedger.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes8 } from "sequelize";
var CreditsLedger = db_default.define(
  "CreditsLedger",
  {
    id: {
      type: DataTypes8.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes8.TEXT,
      allowNull: false
    },
    bet_id: {
      type: DataTypes8.BIGINT,
      allowNull: true,
      comment: "Related bet ID for this ledger entry"
    },
    currency: {
      type: DataTypes8.TEXT,
      allowNull: true,
      defaultValue: "INR"
    },
    amount: {
      type: DataTypes8.DECIMAL,
      allowNull: false,
      comment: "Raw transaction amount (+win / -loss)"
    },
    reason: {
      type: DataTypes8.TEXT,
      allowNull: false
    },
    description: {
      type: DataTypes8.TEXT,
      allowNull: true
    },
    eventid: {
      type: DataTypes8.TEXT,
      allowNull: true
    },
    job_id: {
      type: DataTypes8.UUID,
      allowNull: true
    },
    match_id: {
      type: DataTypes8.TEXT,
      allowNull: true
    },
    meta: {
      type: DataTypes8.JSONB,
      allowNull: true
    },
    market_type: {
      type: DataTypes8.TEXT,
      allowNull: true
    },
    sport_id: {
      type: DataTypes8.TEXT,
      allowNull: true
    },
    commission: {
      type: DataTypes8.DECIMAL(18, 2),
      allowNull: true,
      comment: "2% platform fee deducted from winning amount (NULL for losses / non-win)"
    },
    netamount: {
      type: DataTypes8.DECIMAL(18, 2),
      allowNull: true,
      comment: "Amount credited after commission (amount - commission). NULL for non-win"
    },
    profit: {
      type: DataTypes8.DECIMAL(18, 2),
      allowNull: true,
      comment: "Winning amount (only for wins)"
    },
    loss: {
      type: DataTypes8.DECIMAL(18, 2),
      allowNull: true,
      comment: "Loss amount (only for losses)"
    },
    closing: {
      type: DataTypes8.DECIMAL(18, 2),
      allowNull: true,
      comment: "Closing amount (only for current user proffit ratio)"
    },
    category: {
      type: DataTypes8.STRING(20),
      allowNull: true,
      comment: "SPORTS - identifies settlement source"
    },
    points_applied: {
      type: DataTypes8.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    balance: {
      type: DataTypes8.DECIMAL(18, 2),
      allowNull: true,
      defaultValue: 0,
      comment: "User wallet balance after this ledger entry"
    },
    created_at: {
      type: DataTypes8.DATE,
      allowNull: true,
      defaultValue: DataTypes8.NOW
    }
  },
  {
    tableName: "credits_ledger",
    timestamps: false,
    indexes: [
      { name: "credits_ledger_user_id_idx", fields: ["user_id"] },
      { name: "credits_ledger_eventid_idx", fields: ["eventid"] },
      { name: "credits_ledger_created_at_idx", fields: ["created_at"] }
    ]
  }
);
var CreditsLedger_default = CreditsLedger;

export { CreditsLedger_default };
