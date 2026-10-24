// model/user/DebitLedger.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes25 } from "sequelize";
var DebitLedger = db_default.define(
  "DebitLedger",
  {
    id: {
      type: DataTypes25.BIGINT,
      primaryKey: true,
      autoIncrement: true
    },
    user_id: { type: DataTypes25.TEXT, allowNull: false },
    currency: { type: DataTypes25.TEXT, allowNull: true, defaultValue: "INR" },
    amount: { type: DataTypes25.DECIMAL, allowNull: false },
    // raw win amount
    reason: { type: DataTypes25.TEXT, allowNull: false },
    description: { type: DataTypes25.TEXT, allowNull: true },
    event_id: { type: DataTypes25.TEXT, allowNull: true },
    job_id: { type: DataTypes25.UUID, allowNull: true },
    match_id: { type: DataTypes25.TEXT, allowNull: true },
    meta: { type: DataTypes25.JSONB, allowNull: true },
    balance: { type: DataTypes25.DECIMAL(15, 2), allowNull: true },
    market_type: { type: DataTypes25.TEXT, allowNull: true },
    sport_id: { type: DataTypes25.TEXT, allowNull: true },
    commission: {
      type: DataTypes25.DECIMAL(18, 2),
      allowNull: true,
      comment: "2% platform fee deducted from the winning amount (null for losses / non-win entries)"
    },
    finalAmount: {
      type: DataTypes25.DECIMAL(18, 2),
      allowNull: true,
      comment: "amount credited to user after commission (amount - commission). Null for non-winning rows."
    },
    created_at: {
      type: DataTypes25.DATE,
      allowNull: true,
      defaultValue: DataTypes25.NOW
    }
  },
  {
    tableName: "debit_ledger",
    timestamps: false,
    indexes: [
      { name: "debit_ledger_user_id_idx", fields: ["user_id"] },
      { name: "debit_ledger_event_id_idx", fields: ["event_id"] },
      { name: "debit_ledger_created_at_idx", fields: ["created_at"] }
    ]
  }
);
var DebitLedger_default = DebitLedger;

export { DebitLedger_default };
