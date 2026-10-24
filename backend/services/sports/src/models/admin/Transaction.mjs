// model/admin/Transaction.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes30 } from "sequelize";
var Transaction = db_default.define("Transaction", {
  id: {
    type: DataTypes30.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  // Existing fields (kept for backward compatibility)
  credit: {
    type: DataTypes30.STRING,
    // Username of credited user
    allowNull: true
  },
  debit: {
    type: DataTypes30.STRING,
    // Username of debited user
    allowNull: true
  },
  amount: {
    type: DataTypes30.DECIMAL(20, 2),
    allowNull: false
  },
  balance: {
    type: DataTypes30.DECIMAL(20, 2),
    allowNull: false
    // ✅ This is required - we now populate it in all transactions
  },
  wallet_id: {
    type: DataTypes30.INTEGER,
    allowNull: true
  },
  // ✅ New fields for enhanced transaction logging
  user_id: {
    type: DataTypes30.INTEGER,
    allowNull: true,
    comment: "User ID linked to this transaction"
  },
  staff_id: {
    type: DataTypes30.INTEGER,
    allowNull: true,
    comment: "Staff ID linked to this transaction"
  },
  owner_id: {
    type: DataTypes30.INTEGER,
    allowNull: true,
    comment: "Owner ID linked to this transaction"
  },
  username: {
    type: DataTypes30.STRING,
    allowNull: true,
    comment: "Username linked to this transaction"
  },
  type: {
    type: DataTypes30.STRING,
    allowNull: true,
    comment: "Transaction type (ADD_CASH, SUBTRACT_CREDIT, CREDIT_INR, DEBIT_USDT, etc.)"
  },
  previous_balance: {
    type: DataTypes30.DECIMAL(20, 2),
    allowNull: true,
    comment: "Balance before this transaction"
  },
  new_balance: {
    type: DataTypes30.DECIMAL(20, 2),
    allowNull: true,
    comment: "Balance after this transaction"
  },
  initiated_by: {
    type: DataTypes30.STRING,
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
