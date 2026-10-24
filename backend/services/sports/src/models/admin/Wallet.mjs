// model/admin/Wallet.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";
import { Staff_default } from "./Staff.mjs";

init_db();
import { DataTypes as DataTypes6 } from "sequelize";
function calculateProfitLoss(instance) {
  const cashReceived = parseFloat(instance.getDataValue("cash_received")) || 0;
  const inrBalance = parseFloat(instance.getDataValue("inr_balance")) || 0;
  const profitLoss = parseFloat((inrBalance - cashReceived).toFixed(2));
  const verdict = profitLoss >= 0 ? "profit" : "loss";
  instance.setDataValue("profit_loss", profitLoss);
  instance.setDataValue("verdict", verdict);
}
var Wallet = db_default.define(
  "Wallet",
  {
    wallet_id: {
      type: DataTypes6.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    // Generic Reference Fields
    user_id: { type: DataTypes6.INTEGER, allowNull: true, comment: "Reference for normal user wallet (end user)" },
    staff_id: { type: DataTypes6.INTEGER, allowNull: true, comment: "Reference for staff wallet (admin/supermaster/master)" },
    owner_id: { type: DataTypes6.INTEGER, allowNull: true, comment: "Reference for owner wallet (top-level company or super admin)" },
    // Wallet Classification
    user_type: {
      type: DataTypes6.ENUM("OWNER", "COMPANY", "SUPERADMIN", "ADMIN", "SUPERMASTER", "MASTER", "AGENT", "USER"),
      allowNull: false
    },
    // Wallet Info
    username: { type: DataTypes6.STRING, allowNull: false, unique: true },
    // Core Financial Fields
    inr_balance: { type: DataTypes6.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    cash: { type: DataTypes6.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    credit: { type: DataTypes6.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    cash_received: { type: DataTypes6.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    // Initial credit handed over at account creation (set once, first time)
    all_point: { type: DataTypes6.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    // Cash settlement ka running total: upper_point = apne upline ke saath hua hisaab,
    // down_point = apne downline ke saath hua hisaab
    upper_point: { type: DataTypes6.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    down_point: { type: DataTypes6.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    // Category-wise settlement points ka running total
    sports_pts: { type: DataTypes6.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    sportsbook_pts: { type: DataTypes6.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    // Calculated Metrics
    profit_loss: { type: DataTypes6.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
    verdict: { type: DataTypes6.ENUM("profit", "loss"), allowNull: false, defaultValue: "profit" },
    // NEW – total commission the user has **received** (cumulative)
    totalCommission: {
      type: DataTypes6.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: 0,
      comment: "Cumulative platform-fee commission earned by this wallet"
    }
  },
  {
    tableName: "Wallets",
    timestamps: true,
    hooks: {
      beforeCreate: calculateProfitLoss,
      beforeUpdate: calculateProfitLoss,
      // Recompute on read so increment()/bulk-update paths cannot serve a stale figure.
      // Fires for instances, raw:true rows and findAll alike (verified against this
      // codebase's query shapes). Rows that did not select the source columns — e.g.
      // aggregate queries like SUM(profit_loss) AS downPL — are skipped untouched.
      afterFind: (result) => {
        if (!result) return result;
        const rows = Array.isArray(result) ? result : [result];
        for (const row of rows) {
          if (!row) continue;
          const isInstance = typeof row.getDataValue === "function";
          const inr = isInstance ? row.getDataValue("inr_balance") : row.inr_balance;
          const recv = isInstance ? row.getDataValue("cash_received") : row.cash_received;
          if (inr === void 0 || recv === void 0) continue;
          const pl = parseFloat(((parseFloat(inr) || 0) - (parseFloat(recv) || 0)).toFixed(2));
          const verdict = pl >= 0 ? "profit" : "loss";
          if (isInstance) {
            row.setDataValue("profit_loss", pl);
            row.setDataValue("verdict", verdict);
            row.changed("profit_loss", false);
            row.changed("verdict", false);
          } else {
            row.profit_loss = pl;
            row.verdict = verdict;
          }
        }
        return result;
      }
    }
  }
);
Wallet.belongsTo(Staff_default, {
  foreignKey: "staff_id",
  as: "staff",
  constraints: false
});
var Wallet_default = Wallet;

export { Wallet_default };
