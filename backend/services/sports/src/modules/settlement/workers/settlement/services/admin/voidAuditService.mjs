// services/admin/voidAuditService.js — mssports settlement worker, moved unchanged
import { BetVoidAudit_default } from "../../models/admin/BetVoidAudit.mjs";

import { randomUUID } from "crypto";
import { writeDirectVoids } from "../../../../../../lib/services/directPointLedger.mjs";
var newVoidGroupId = () => randomUUID();
var num = (v) => v === null || v === void 0 || v === "" ? null : Number(v);
var recordVoidAudit = async ({
  voidGroupId,
  voidType,
  bets = [],
  representativeBetId = null,
  before = {},
  after = {},
  refundAmount = null,
  exposureRowsDeleted = null,
  ledgerId = null,
  context = {},
  betKind = "SPORTS",
  backfilled = false
}, t = null) => {
  if (!bets.length) return [];
  const rows = bets.map((b) => ({
    void_group_id: voidGroupId,
    is_representative: representativeBetId != null && Number(b.id) === Number(representativeBetId),
    void_type: voidType,
    bet_id: b.id,
    bet_kind: betKind,
    user_id: b.user_id,
    username: context.username || b.username || null,
    match_id: b.match_id != null ? String(b.match_id) : null,
    eventid: b.eventid != null ? String(b.eventid) : b.event_id != null ? String(b.event_id) : null,
    match_title: b.match_title || b.event_name || null,
    market_type: b.market_type || null,
    game_type: b.game_type || null,
    // sports rows call it `selection_name` (`selection` kept as a fallback).
    selection_name: b.selection_name || b.selection || null,
    bet_type: b.bet_type || null,
    odds: num(b.odds),
    stake_amount: num(b.stake_amount ?? b.stake),
    liability: num(b.liability ?? b.exposer),
    status_before: before.status ?? b.status ?? null,
    result_status_before: before.resultStatus ?? b.result_status ?? null,
    cash_before: num(before.cash),
    inr_before: num(before.inr),
    exposure_before: num(before.exposure),
    total_exposure_before: num(before.totalExposure),
    status_after: after.status ?? null,
    result_status_after: after.resultStatus ?? null,
    cash_after: num(after.cash),
    inr_after: num(after.inr),
    exposure_after: num(after.exposure),
    total_exposure_after: num(after.totalExposure),
    refund_amount: num(refundAmount),
    exposure_rows_deleted: exposureRowsDeleted == null ? null : Number(exposureRowsDeleted),
    ledger_id: ledgerId == null ? null : Number(ledgerId),
    actor: context.actor || null,
    actor_role: context.actor_role || null,
    ip_address: context.ip_address || null,
    browser: context.browser || null,
    note: context.note || null,
    backfilled,
    created_at: /* @__PURE__ */ new Date()
  }));
  const created = await BetVoidAudit_default.bulkCreate(rows, t ? { transaction: t } : {});
  // Direct users ka point ledger: settle se pehle wale har void ki entry (AFTER_SETTLEMENT ki ulti
  // entry alag se likhi jaati hai). Usi transaction me — void rollback ho to entry bhi nahi.
  if (voidType !== "AFTER_SETTLEMENT" && betKind === "SPORTS") {
    await writeDirectVoids(BetVoidAudit_default.sequelize, { voidType, voidGroupId, bets }, t ? { transaction: t } : {});
  }
  return created;
};

export { newVoidGroupId, recordVoidAudit };
