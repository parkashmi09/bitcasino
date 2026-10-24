// model/admin/Transaction.js — mssports settlement worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes18 } from "sequelize";
var Transaction = db_default.define("Transaction", {
  id: {
    type: DataTypes18.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  // Existing fields (kept for backward compatibility)
  credit: {
    type: DataTypes18.STRING,
    // Username of credited user
    allowNull: true
  },
  debit: {
    type: DataTypes18.STRING,
    // Username of debited user
    allowNull: true
  },
  amount: {
    type: DataTypes18.DECIMAL(20, 2),
    allowNull: false
  },
  balance: {
    type: DataTypes18.DECIMAL(20, 2),
    allowNull: false
    // ✅ This is required - we now populate it in all transactions
  },
  wallet_id: {
    type: DataTypes18.INTEGER,
    allowNull: true
  },
  // ✅ New fields for enhanced transaction logging
  user_id: {
    type: DataTypes18.INTEGER,
    allowNull: true,
    comment: "User ID linked to this transaction"
  },
  staff_id: {
    type: DataTypes18.INTEGER,
    allowNull: true,
    comment: "Staff ID linked to this transaction"
  },
  owner_id: {
    type: DataTypes18.INTEGER,
    allowNull: true,
    comment: "Owner ID linked to this transaction"
  },
  username: {
    type: DataTypes18.STRING,
    allowNull: true,
    comment: "Username linked to this transaction"
  },
  type: {
    type: DataTypes18.STRING,
    allowNull: true,
    comment: "Transaction type (ADD_CASH, SUBTRACT_CREDIT, CREDIT_INR, DEBIT_USDT, etc.)"
  },
  previous_balance: {
    type: DataTypes18.DECIMAL(20, 2),
    allowNull: true,
    comment: "Balance before this transaction"
  },
  new_balance: {
    type: DataTypes18.DECIMAL(20, 2),
    allowNull: true,
    comment: "Balance after this transaction"
  },
  initiated_by: {
    type: DataTypes18.STRING,
    allowNull: true,
    comment: "Who initiated this transaction (Admin/System/User)"
  }
}, {
  tableName: "transactions",
  timestamps: true,
  // Keep createdAt and updatedAt
  underscored: false
});
var Transaction_default = Transaction;

export { Transaction_default };
