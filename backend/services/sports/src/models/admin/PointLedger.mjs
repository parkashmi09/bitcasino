// model/admin/PointLedger.js — mssports core, moved unchanged
import { db_default, init_db } from "../../lib/config/db.mjs";

init_db();
import { DataTypes as DataTypes31 } from "sequelize";
var PointLedger = db_default.define(
  "PointLedger",
  {
    id: { type: DataTypes31.BIGINT.UNSIGNED, primaryKey: true, autoIncrement: true },
    // Event ki unique pehchaan — hamesha constants/pointLedger.js ke
    // pointEntryRef builders se banao, haath se nahi
    entry_ref: { type: DataTypes31.STRING(120), allowNull: false },
    // VARCHAR rakha (ENUM nahi) — values readable hain ('User creation', 'Bank Deposite')
    // aur naya type aaye toh DB ALTER nahi lagta
    event_type: { type: DataTypes31.STRING(40), allowNull: false },
    // Jis wallet ki entry hai usi ka username (reports me join bachata hai)
    username: { type: DataTypes31.STRING(100), allowNull: true },
    // Entry ke waqt wallet ka inr_balance kya tha (closing)
    closing_inr_balance: { type: DataTypes31.DECIMAL(18, 2), allowNull: true },
    // Doosri side wale (parent/sender) ka closing inr_balance — deposit/withdraw/settle/creation me
    closing_inr_balance_parent: { type: DataTypes31.DECIMAL(18, 2), allowNull: true },
    // Sirf BET_SETTLEMENT me: kis sport/game se aaya
    sport_id: { type: DataTypes31.STRING(50), allowNull: true },
    game_type: { type: DataTypes31.STRING(50), allowNull: true },
    // Sirf BET_SETTLEMENT me bharta hai: POINT_CATEGORY (SPORTS)
    category: { type: DataTypes31.STRING(30), allowNull: true },
    // Kis bet se aaya (sports = market ki pehli bet id)
    bet_id: { type: DataTypes31.BIGINT, allowNull: true },
    wallet_id: { type: DataTypes31.INTEGER, allowNull: false },
    // Sirf CASH_SETTLEMENT me: kiske SAATH hisaab hua (upar wala wallet).
    // Settle-out me entry sirf neeche wale ke wallet me lagti hai — upar wale ka
    // all_point touch nahi hota (sirf cash), uska apna claim upline ke saath
    // tabhi clear hota hai jab upar se settlement aata hai.
    settled_with_wallet_id: { type: DataTypes31.INTEGER, allowNull: true },
    // Sign ke saath: jeet +, haar − (BET_SETTLEMENT me chain ke har wallet me same delta)
    delta: { type: DataTypes31.DECIMAL(18, 2), allowNull: false },
    // `delta` (INR) in the bet's coin (`bet_currency`), sign kept — inrToCurrency at settlement.
    delta_currency: { type: DataTypes31.DECIMAL(30, 8), allowNull: true },
    // Entry lagne ke turant baad all_point kya bana (audit ke liye)
    all_point_after: { type: DataTypes31.DECIMAL(18, 2), allowNull: true },
    // Kis user ke event se ye entry aayi (jeetne/haarne wala user)
    source_user_id: { type: DataTypes31.INTEGER, allowNull: true },
    remark: { type: DataTypes31.STRING(255), allowNull: true }
  },
  {
    tableName: "point_ledger",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: false,
    indexes: [
      // Ek hi key do kaam karti hai:
      //  1. Idempotency — same event same wallet pe dobara INSERT = DB reject
      //  2. Per-wallet SUM — wallet_id prefix + implicit PK id se
      //     "WHERE wallet_id = ? AND id > ?" range bhi isi se chalta hai
      { unique: true, fields: ["wallet_id", "entry_ref"], name: "uq_wallet_entry" }
    ]
  }
);
var PointLedger_default = PointLedger;

export { PointLedger_default };
