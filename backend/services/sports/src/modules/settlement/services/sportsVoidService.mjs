// services/admin/sportsVoidService.js — mssports core, moved unchanged
import { db_default, init_db } from "../../../lib/config/db.mjs";
import { User_default } from "../../../models/user/User.mjs";
// Wallets → credits: the player's sports balance is the platform wallet, credits.inr.
// import { Wallet_default } from "../../../models/admin/Wallet.mjs";
import { Credits_default } from "../../../models/user/Credits.mjs";
import { SportsBet_default } from "../../../models/user/SportsBet.mjs";
import { CreditsLedger_default } from "../../../models/user/CreditsLedger.mjs";
import { recalcTotalExposure } from "../../../lib/helper/totalExposure.mjs";
import { walletService_default } from "../../../lib/services/walletService.mjs";
import { POINT_CATEGORY, pointEntryRef } from "../../../lib/constants/pointLedger.mjs";
import { pushBalance } from "../../../lib/helper/pushBalance.mjs";
import { withVoidSuffix } from "../../../lib/helper/voidLabel.mjs";
import { isPerSelectionMarket, SETTLED_RESULT_STATUSES } from "../../../lib/helper/exposureBucket.mjs";
import { VOID_TYPES } from "../../../models/admin/BetVoidAudit.mjs";
import { newVoidGroupId, recordVoidAudit } from "./voidAuditService.mjs";
import { COMMISSION_REASON, COMMISSION_VOID_REASON } from "./sportsCommissionService.mjs";

init_db();
import { Op as Op12 } from "sequelize";
var round22 = (v) => Math.round((Number(v) || 0) * 100) / 100;
var VOID_WINDOW_HOURS = Number(process.env.SPORTS_SETTLED_VOID_WINDOW_HOURS || 24);
var since = () => new Date(Date.now() - VOID_WINDOW_HOURS * 60 * 60 * 1e3);
var SETTLEMENT_WHERE = { category: "SPORTS", reason: "settlement" };
var VOID_REASON = "settlement_void";
var voidedLedgerIds = async (settlementRows) => {
  if (!settlementRows.length) return /* @__PURE__ */ new Set();
  const voids = await CreditsLedger_default.findAll({
    where: {
      category: "SPORTS",
      reason: VOID_REASON,
      match_id: { [Op12.in]: [...new Set(settlementRows.map((r) => String(r.match_id)))] }
    },
    raw: true
  });
  if (!voids.length) return /* @__PURE__ */ new Set();
  const out = /* @__PURE__ */ new Set();
  for (const v of voids) {
    const linked = Number(v.meta?.reverses_ledger_id || 0);
    if (linked) {
      out.add(linked);
      continue;
    }
    const candidate = settlementRows.filter(
      (s) => String(s.user_id) === String(v.user_id) && String(s.match_id) === String(v.match_id) && String(s.market_type || "") === String(v.market_type || "") && Number(s.bet_id || 0) === Number(v.bet_id || 0) && Number(s.id) < Number(v.id) && !out.has(Number(s.id))
    ).sort((a, b) => b.id - a.id)[0];
    if (candidate) out.add(Number(candidate.id));
  }
  return out;
};
var netOf = (row) => round22(Number(row.profit || 0) + Number(row.loss || 0));
var listSettledMarkets = async ({ search = "", limit = 200, offset = 0 } = {}) => {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const rows = await CreditsLedger_default.findAll({
    where: { ...SETTLEMENT_WHERE, created_at: { [Op12.gte]: since() } },
    order: [["id", "DESC"]],
    raw: true
  });
  if (!rows.length) return { windowHours: VOID_WINDOW_HOURS, data: [] };
  const voided = await voidedLedgerIds(rows);
  const live = rows.filter((r) => !voided.has(Number(r.id)));
  if (!live.length) return { windowHours: VOID_WINDOW_HOURS, data: [] };
  const groups = /* @__PURE__ */ new Map();
  for (const r of live) {
    const key = `${r.match_id}|${r.market_type || ""}`;
    if (!groups.has(key)) {
      groups.set(key, {
        matchId: String(r.match_id || ""),
        marketType: r.market_type || "",
        eventId: r.eventid != null ? String(r.eventid) : null,
        matchTitle: null,
        teamOne: null,
        teamTwo: null,
        totalEntries: 0,
        users: /* @__PURE__ */ new Set(),
        totalNetAmount: 0,
        settledAt: r.created_at
      });
    }
    const g = groups.get(key);
    g.totalEntries += 1;
    g.users.add(String(r.user_id));
    g.totalNetAmount = round22(g.totalNetAmount + netOf(r));
    if (r.created_at && new Date(r.created_at) > new Date(g.settledAt)) g.settledAt = r.created_at;
  }
  const bets = await SportsBet_default.findAll({
    where: { match_id: { [Op12.in]: [...new Set(live.map((r) => String(r.match_id)))] } },
    attributes: ["match_id", "market_type", "match_title", "team_one", "team_two"],
    raw: true
  });
  for (const b of bets) {
    const g = groups.get(`${b.match_id}|${b.market_type || ""}`);
    if (g && !g.matchTitle) {
      g.matchTitle = b.match_title || null;
      g.teamOne = b.team_one || null;
      g.teamTwo = b.team_two || null;
    }
  }
  let data = [...groups.values()].map((g) => ({
    matchId: g.matchId,
    marketType: g.marketType,
    eventId: g.eventId,
    matchTitle: g.matchTitle,
    teamOne: g.teamOne,
    teamTwo: g.teamTwo,
    totalEntries: g.totalEntries,
    totalUsers: g.users.size,
    totalNetAmount: g.totalNetAmount,
    settledAt: g.settledAt
  }));
  const term = String(search || "").trim().toLowerCase();
  if (term) {
    data = data.filter(
      (m) => [m.matchId, m.marketType, m.matchTitle, m.teamOne, m.teamTwo].some((v) => String(v ?? "").toLowerCase().includes(term))
    );
  }
  return { windowHours: VOID_WINDOW_HOURS, data: data.slice(off, off + lim) };
};
var listSettledBets = async ({ matchId, marketType }) => {
  if (!matchId) throw new Error("match_id is required");
  const rows = await CreditsLedger_default.findAll({
    where: {
      ...SETTLEMENT_WHERE,
      match_id: String(matchId),
      ...marketType ? { market_type: marketType } : {},
      created_at: { [Op12.gte]: since() }
    },
    order: [["id", "DESC"]],
    raw: true
  });
  if (!rows.length) return [];
  const voided = await voidedLedgerIds(rows);
  const live = rows.filter((r) => !voided.has(Number(r.id)));
  if (!live.length) return [];
  const userIds = [...new Set(live.map((r) => Number(r.user_id)))];
  const users = await User_default.findAll({
    where: { user_id: { [Op12.in]: userIds } },
    attributes: ["user_id", "username"],
    raw: true
  });
  const nameOf = new Map(users.map((u) => [Number(u.user_id), u.username]));
  const marketBets = await SportsBet_default.findAll({
    where: {
      match_id: String(matchId),
      ...marketType ? { market_type: marketType } : {},
      user_id: { [Op12.in]: userIds }
    },
    raw: true
  });
  return live.map((r) => {
    const mine = marketBets.filter((b) => Number(b.user_id) === Number(r.user_id));
    const anchor = mine.find((b) => Number(b.id) === Number(r.bet_id)) || mine[0] || null;
    return {
      ledgerId: Number(r.id),
      betId: Number(r.bet_id || anchor?.id || 0),
      userId: Number(r.user_id),
      username: nameOf.get(Number(r.user_id)) || `user_${r.user_id}`,
      // Ek ledger row poore market ko cover kar sakti hai (MO/BM) ya ek hi bet ko
      // (fancy/oddeven) — dono soorat me user ko saaf dikhe.
      selectionName: mine.length > 1 ? `${mine.length} bets` : anchor?.selection_name || "-",
      betType: anchor?.bet_type || "-",
      odds: anchor?.odds ?? null,
      stakeAmount: mine.reduce((s, b) => s + Number(b.stake_amount || 0), 0),
      netamount: netOf(r),
      cashDelta: round22(Number(r.netamount || 0)),
      resultStatus: netOf(r) > 0 ? "won" : netOf(r) < 0 ? "loss" : "settled",
      betCount: mine.length,
      settledAt: r.created_at
    };
  });
};
var voidSettledLedgerEntry = async (ledgerId, outerTx = null, { writeStatement = true } = {}) => {
  const id = Number(ledgerId);
  if (!Number.isFinite(id) || id <= 0) throw new Error("ledger_id is required");
  const transaction = outerTx || await db_default.transaction();
  let summary;
  try {
    const row = await CreditsLedger_default.findOne({
      where: { id, ...SETTLEMENT_WHERE },
      lock: transaction.LOCK.UPDATE,
      transaction
    });
    if (!row) throw new Error(`Settlement entry ${id} not found (already voided?)`);
    if (!row.created_at || new Date(row.created_at) < since()) {
      throw new Error(
        `Settlement is older than ${VOID_WINDOW_HOURS}h \u2014 it can only be voided within ${VOID_WINDOW_HOURS} hours`
      );
    }
    if ((await voidedLedgerIds([row.get({ plain: true })])).has(id)) {
      throw new Error(`Settlement ${id} is already voided`);
    }
    const userId = Number(row.user_id);
    const net = netOf(row);
    // OLD (Wallets.cash + Wallets.inr_balance):
    /*
    const wallet = await Wallet_default.findOne({
      where: { user_id: String(userId) },
      lock: transaction.LOCK.UPDATE,
      transaction
    });
    if (!wallet) throw new Error(`Wallet not found for user ${userId}`);
    const cashBefore = Number(wallet.cash || 0);
    const inrBefore = Number(wallet.inr_balance || 0);
    await wallet.update(
      { cash: round22(cashBefore - net), inr_balance: round22(inrBefore - net) },
      { transaction }
    );
    */
    // NEW (credits.inr): the settlement's payout is taken back out of inr.
    const wallet = await Credits_default.findOne({
      where: { uid: userId },
      lock: transaction.LOCK.UPDATE,
      transaction
    });
    if (!wallet) throw new Error(`Wallet not found for user ${userId}`);
    const cashBefore = Number(wallet.inr || 0);
    const inrBefore = cashBefore;
    await wallet.update(
      { inr: round22(cashBefore - net) },
      { transaction }
    );
    const counters = { profit: -net };
    if (net > 0) counters.net_win = -net;
    else if (net < 0) counters.net_loss = -net;
    await User_default.increment(counters, { where: { user_id: userId }, transaction });
    const sameMarket = await CreditsLedger_default.findAll({
      where: {
        ...SETTLEMENT_WHERE,
        user_id: String(userId),
        match_id: row.match_id,
        market_type: row.market_type,
        id: { [Op12.ne]: id }
      },
      attributes: ["bet_id"],
      raw: true,
      transaction
    });
    const claimedByOthers = sameMarket.map((r) => Number(r.bet_id)).filter(Boolean);
    const settledOnly = {
      status: "closed",
      result_status: { [Op12.in]: SETTLED_RESULT_STATUSES }
    };
    const scopeToOwnBet = isPerSelectionMarket(row.market_type) && Number(row.bet_id || 0) > 0;
    const betsBeforeVoid = await SportsBet_default.findAll({
      where: {
        user_id: userId,
        match_id: row.match_id,
        ...row.market_type ? { market_type: row.market_type } : {},
        ...settledOnly,
        ...scopeToOwnBet ? { id: Number(row.bet_id) } : claimedByOthers.length ? { id: { [Op12.notIn]: claimedByOthers } } : {}
      },
      transaction
    });
    const [betsVoided] = await SportsBet_default.update(
      { result_status: "void", status: "closed", updated_at: /* @__PURE__ */ new Date() },
      {
        where: {
          user_id: userId,
          match_id: row.match_id,
          ...row.market_type ? { market_type: row.market_type } : {},
          ...settledOnly,
          ...scopeToOwnBet ? { id: Number(row.bet_id) } : claimedByOthers.length ? { id: { [Op12.notIn]: claimedByOthers } } : {}
        },
        transaction
      }
    );
    if (writeStatement) {
      await CreditsLedger_default.create(
        {
          user_id: String(userId),
          currency: "INR",
          amount: -Number(row.netamount || 0),
          reason: "settlement_void",
          description: withVoidSuffix(row.description || `${row.match_id} / ${row.market_type || ""}`),
          netamount: -Number(row.netamount || 0),
          closing: round22(cashBefore - net),
          market_type: row.market_type || null,
          sport_id: row.sport_id || null,
          eventid: row.eventid || null,
          match_id: row.match_id || null,
          ...net > 0 ? { profit: -net } : { loss: -net },
          bet_id: row.bet_id || null,
          category: "SPORTS",
          points_applied: true,
          // Original row se pakka link — isi se list voided settlements ko chhupati hai
          meta: { reverses_ledger_id: id }
        },
        { transaction }
      );
    } else {
      await row.destroy({ transaction });
    }
    let commissionVoided = 0;
    let commissionRemark = null;
    let commissionSportId = null;
    let commissionGtype = null;
    const commRows = await CreditsLedger_default.findAll({
      where: {
        user_id: String(userId),
        category: "SPORTS",
        reason: COMMISSION_REASON,
        [Op12.and]: [db_default.literal(`(meta->>'commission_of_ledger_id') = '${Number(id)}'`)]
      },
      order: [["id", "ASC"]],
      lock: transaction.LOCK.UPDATE,
      transaction
    });
    for (const c of commRows) {
      const alreadyVoided = await CreditsLedger_default.findOne({
        where: {
          user_id: String(userId),
          reason: COMMISSION_VOID_REASON,
          [Op12.and]: [db_default.literal(`(meta->>'reverses_ledger_id') = '${Number(c.id)}'`)]
        },
        attributes: ["id"],
        transaction
      });
      if (alreadyVoided) continue;
      const comm = round22(Math.abs(Number(c.netamount ?? c.commission ?? 0)));
      if (!(comm > 0)) continue;
      commissionVoided = round22(commissionVoided + comm);
      commissionRemark = c.description || null;
      commissionSportId = c.sport_id || null;
      commissionGtype = c.meta?.gtype || null;
      // OLD (Wallets.cash + Wallets.inr_balance):
      // await wallet.update(
      //   {
      //     cash: round22(Number(wallet.cash || 0) + comm),
      //     inr_balance: round22(Number(wallet.inr_balance || 0) + comm)
      //   },
      //   { transaction }
      // );
      // NEW (credits.inr): the voided commission goes back to inr.
      await wallet.update(
        { inr: round22(Number(wallet.inr || 0) + comm) },
        { transaction }
      );
      await User_default.increment({ net_loss: comm, profit: comm }, { where: { user_id: userId }, transaction });
      if (writeStatement) {
        await CreditsLedger_default.create(
          {
            user_id: String(userId),
            currency: "INR",
            amount: comm,
            reason: COMMISSION_VOID_REASON,
            description: withVoidSuffix(c.description || ""),
            netamount: comm,
            // OLD: closing: round22(Number(wallet.cash || 0)),
            closing: round22(Number(wallet.inr || 0)),
            market_type: c.market_type || null,
            sport_id: c.sport_id || null,
            eventid: c.eventid || null,
            match_id: c.match_id || null,
            loss: comm,
            // reverses the commission row's loss = -comm
            bet_id: c.bet_id || null,
            category: "SPORTS",
            points_applied: true,
            meta: { reverses_ledger_id: Number(c.id), commission_of_ledger_id: Number(id) }
          },
          { transaction }
        );
      } else {
        await c.destroy({ transaction });
      }
    }
    summary = {
      ledgerId: id,
      writeStatement,
      userId,
      matchId: String(row.match_id || ""),
      marketType: row.market_type || "",
      betId: Number(row.bet_id || 0),
      net,
      betsVoided,
      cashBefore,
      cashAfter: round22(cashBefore - net + commissionVoided),
      inrBefore,
      inrAfter: round22(inrBefore - net + commissionVoided),
      commissionVoided,
      commissionRemark,
      commissionSportId,
      commissionGtype
    };
    const totalExposureAfter = await recalcTotalExposure(userId, transaction);
    await recordVoidAudit({
      voidGroupId: newVoidGroupId(),
      voidType: VOID_TYPES.AFTER_SETTLEMENT,
      bets: betsBeforeVoid,
      representativeBetId: Number(row.bet_id) || null,
      before: {
        cash: cashBefore,
        inr: inrBefore,
        totalExposure: null
        // settled bets hold no exposure row to read
      },
      after: {
        status: "closed",
        resultStatus: "void",
        cash: summary.cashAfter,
        inr: summary.inrAfter,
        totalExposure: totalExposureAfter
      },
      refundAmount: -net,
      ledgerId: id,
      context: {
        // Audit hamesha likhti hai — silent void par bhi. Statement se rows hat
        // jaati hain, par yahan (aur activity log me) poora trail rehta hai.
        note: `settlement void \u2014 reverses credits_ledger #${id} (net ${net})` + (commissionVoided > 0 ? `; commission ${commissionVoided} refunded` : "") + (writeStatement ? "" : "; SILENT (statement entries deleted)")
      }
    }, transaction);
    if (!outerTx) await transaction.commit();
  } catch (error) {
    if (!outerTx) await transaction.rollback();
    throw error;
  }
  if (outerTx) return summary;
  return { ...summary, points: await reversePointsAndEmit(summary) };
};
var reversePointsAndEmit = async (summary) => {
  if (!summary?.betId) return { success: true, skipped: true, reason: "no bet_id on ledger row" };
  if (summary.writeStatement === false) {
    const del = await walletService_default.deletePointEntries(
      pointEntryRef.bet(POINT_CATEGORY.SPORTS, summary.betId)
    );
    if (!del.success) console.error("[sportsVoid] point delete failed:", summary.betId, del.error);
    if (Number(summary.commissionVoided) > 0) {
      const cdel = await walletService_default.deletePointEntries(
        pointEntryRef.commission(POINT_CATEGORY.SPORTS, summary.betId)
      );
      if (!cdel.success) console.error("[sportsVoid] commission point delete failed:", summary.betId, cdel.error);
      del.commission = cdel;
    }
    pushBalance(summary.userId);
    return del;
  }
  const res = await walletService_default.reverseAllPointHierarchy(summary.betId, POINT_CATEGORY.SPORTS);
  if (!res.success) console.error("[sportsVoid] point reversal failed:", summary.betId, res.error);
  if (Number(summary.commissionVoided) > 0) {
    const cres = await walletService_default.reverseCommissionPoints({
      betId: summary.betId,
      userId: summary.userId,
      amount: summary.commissionVoided,
      remark: withVoidSuffix(summary.commissionRemark || ""),
      sportId: summary.commissionSportId,
      gtype: summary.commissionGtype
    });
    if (!cres.success) console.error("[sportsVoid] commission point reversal failed:", summary.betId, cres.error);
    res.commission = cres;
  }
  pushBalance(summary.userId);
  return res;
};
var voidSettledMarket = async ({ matchId, marketType, writeStatement = true }) => {
  if (!matchId) throw new Error("match_id is required");
  const rows = await CreditsLedger_default.findAll({
    where: {
      ...SETTLEMENT_WHERE,
      match_id: String(matchId),
      ...marketType ? { market_type: marketType } : {},
      created_at: { [Op12.gte]: since() }
    },
    order: [["id", "ASC"]],
    raw: true
  });
  const alreadyVoided = await voidedLedgerIds(rows);
  const pending = rows.filter((r) => !alreadyVoided.has(Number(r.id)));
  if (!pending.length) {
    throw new Error(
      rows.length ? "This market is already voided" : `No settlement entries found for this market in the last ${VOID_WINDOW_HOURS}h`
    );
  }
  const transaction = await db_default.transaction();
  const summaries = [];
  try {
    for (const r of pending) {
      summaries.push(await voidSettledLedgerEntry(r.id, transaction, { writeStatement }));
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
  for (const s of summaries) {
    s.points = await reversePointsAndEmit(s);
  }
  return {
    affectedUsers: new Set(summaries.map((s) => s.userId)).size,
    entries: summaries.length,
    summaries
  };
};

export { listSettledMarkets, listSettledBets, voidSettledLedgerEntry, voidSettledMarket };
