// model/admin/BetVoidAudit.js — mssports results worker, moved unchanged
import { db_default } from "../../config/db.mjs";

import { DataTypes as DataTypes15 } from "sequelize";
var VOID_TYPES = {
  OPEN_BET: "OPEN_BET",
  // POST /void-single-bet
  MARKET: "MARKET",
  // POST /void  (market / one fancy session)
  AFTER_SETTLEMENT: "AFTER_SETTLEMENT",
  // POST /void-bet-after-settlement, /void-market-after-settlement
  FEED_SUSPENDED: "FEED_SUSPENDED",
  // settlementv2: provider declared the market SUSPENDED
  AUTO_TIMEOUT: "AUTO_TIMEOUT"
  // autoVoid.js: still open N s after MATCH_ODDS/BOOKMAKER declared
};
var money = { type: DataTypes15.DECIMAL(15, 2), allowNull: true };
var BetVoidAudit = db_default.define(
  "BetVoidAudit",
  {
    id: { type: DataTypes15.BIGINT, autoIncrement: true, primaryKey: true },
    // ── which void operation ────────────────────────────────────────────────
    void_group_id: { type: DataTypes15.UUID, allowNull: false },
    is_representative: { type: DataTypes15.BOOLEAN, allowNull: false, defaultValue: false },
    void_type: { type: DataTypes15.STRING(32), allowNull: false },
    // ── which bet ───────────────────────────────────────────────────────────
    bet_id: { type: DataTypes15.BIGINT, allowNull: false },
    bet_kind: { type: DataTypes15.STRING(16), allowNull: false, defaultValue: "SPORTS" },
    user_id: { type: DataTypes15.BIGINT, allowNull: false },
    username: { type: DataTypes15.STRING(255), allowNull: true },
    // Bet identity FROZEN at void time. Denormalised on purpose: a report must
    // still read correctly if the bet row is later edited or purged.
    match_id: { type: DataTypes15.STRING(255), allowNull: true },
    eventid: { type: DataTypes15.STRING(255), allowNull: true },
    match_title: { type: DataTypes15.STRING(255), allowNull: true },
    market_type: { type: DataTypes15.STRING(255), allowNull: true },
    game_type: { type: DataTypes15.STRING(100), allowNull: true },
    selection_name: { type: DataTypes15.STRING(255), allowNull: true },
    bet_type: { type: DataTypes15.STRING(32), allowNull: true },
    odds: { type: DataTypes15.DECIMAL(15, 4), allowNull: true },
    stake_amount: money,
    liability: money,
    // ── PRE ─────────────────────────────────────────────────────────────────
    status_before: { type: DataTypes15.STRING(32), allowNull: true },
    result_status_before: { type: DataTypes15.STRING(32), allowNull: true },
    cash_before: money,
    inr_before: money,
    // The bucket's own liability (the `sel` row for a per-selection market, the
    // worst row for MO/BM) — what this void was actually holding.
    exposure_before: money,
    total_exposure_before: money,
    // ── POST ────────────────────────────────────────────────────────────────
    status_after: { type: DataTypes15.STRING(32), allowNull: true },
    result_status_after: { type: DataTypes15.STRING(32), allowNull: true },
    cash_after: money,
    inr_after: money,
    exposure_after: money,
    total_exposure_after: money,
    // Money returned FOR THE GROUP (repeated on each row of the group — sum over
    // DISTINCT void_group_id). 0 is a legitimate value: a void of a bet whose
    // liability was already held by nothing releases nothing.
    refund_amount: { type: DataTypes15.DECIMAL(15, 2), allowNull: true },
    exposure_rows_deleted: { type: DataTypes15.INTEGER, allowNull: true },
    // credits_ledger row this void wrote, when it wrote one.
    ledger_id: { type: DataTypes15.BIGINT, allowNull: true },
    // ── who and how ─────────────────────────────────────────────────────────
    actor: { type: DataTypes15.STRING(255), allowNull: true },
    actor_role: { type: DataTypes15.STRING(64), allowNull: true },
    ip_address: { type: DataTypes15.STRING(64), allowNull: true },
    browser: { type: DataTypes15.TEXT, allowNull: true },
    note: { type: DataTypes15.TEXT, allowNull: true },
    // Historical rows reconstructed from SportsBet + credits_ledger. Their
    // wallet/exposure columns are NULL and must not be read as zero.
    backfilled: { type: DataTypes15.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes15.DATE, allowNull: false, defaultValue: DataTypes15.NOW }
  },
  {
    tableName: "bet_void_audit",
    timestamps: false,
    indexes: [
      // Reports filter by time first, then narrow.
      { fields: ["created_at"] },
      { fields: ["user_id", "created_at"] },
      { fields: ["void_group_id"] },
      { fields: ["void_type", "created_at"] },
      // The tracker joins from SportsBet to "did this void get audited?".
      { fields: ["bet_kind", "bet_id"] }
    ]
  }
);
var BetVoidAudit_default = BetVoidAudit;

export { VOID_TYPES, BetVoidAudit_default };
