// model/user/CreditsLedger.js — mssports results worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes14 } from "sequelize";
var CreditsLedger = db_default.define(
  "CreditsLedger",
  {
    id: {
      type: DataTypes14.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: {
      type: DataTypes14.TEXT,
      allowNull: false
    },
    bet_id: {
      type: DataTypes14.BIGINT,
      allowNull: true,
      comment: "Related bet ID for this ledger entry"
    },
    currency: {
      type: DataTypes14.TEXT,
      allowNull: true,
      defaultValue: "INR"
    },
    amount: {
      type: DataTypes14.DECIMAL,
      allowNull: false,
      comment: "Raw transaction amount (+win / -loss)"
    },
    reason: {
      type: DataTypes14.TEXT,
      allowNull: false
    },
    description: {
      type: DataTypes14.TEXT,
      allowNull: true
    },
    eventid: {
      type: DataTypes14.TEXT,
      allowNull: true
    },
    job_id: {
      type: DataTypes14.UUID,
      allowNull: true
    },
    match_id: {
      type: DataTypes14.TEXT,
      allowNull: true
    },
    meta: {
      type: DataTypes14.JSONB,
      allowNull: true
    },
    market_type: {
      type: DataTypes14.TEXT,
      allowNull: true
    },
    sport_id: {
      type: DataTypes14.TEXT,
      allowNull: true
    },
    commission: {
      type: DataTypes14.DECIMAL(18, 2),
      allowNull: true,
      comment: "2% platform fee deducted from winning amount (NULL for losses / non-win)"
    },
    netamount: {
      type: DataTypes14.DECIMAL(18, 2),
      allowNull: true,
      comment: "Amount credited after commission (amount - commission). NULL for non-win"
    },
    profit: {
      type: DataTypes14.DECIMAL(18, 2),
      allowNull: true,
      comment: "Winning amount (only for wins)"
    },
    loss: {
      type: DataTypes14.DECIMAL(18, 2),
      allowNull: true,
      comment: "Loss amount (only for losses)"
    },
    closing: {
      type: DataTypes14.DECIMAL(18, 2),
      allowNull: true,
      comment: "Closing amount (only for current user proffit ratio)"
    },
    category: {
      type: DataTypes14.STRING(20),
      allowNull: true,
      comment: "SPORTS - identifies settlement source"
    },
    points_applied: {
      type: DataTypes14.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    balance: {
      type: DataTypes14.DECIMAL(18, 2),
      allowNull: true,
      defaultValue: 0,
      comment: "User wallet balance after this ledger entry"
    },
    created_at: {
      type: DataTypes14.DATE,
      allowNull: true,
      defaultValue: DataTypes14.NOW
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
