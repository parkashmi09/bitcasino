// Direct user (koi parent nahi) ka account statement — `mssports.point_ledger_direct` se.
//
// `account-statement-v2` (UserStatementService) agent users ka statement hai: `point_ledger`,
// wallet_id se. Direct user ka us table me kuch nahi hota — uski entries (sports settlement,
// void, reversal, JS games callback) `point_ledger_direct` me hain, user_id se, apni currency me.
// Response ka shape v2 jaisa hi hai (frontend wahi table dikha sake) + `currency` har row pe.
// Ek market ki SPORTS rows v2 ki tarah ek line me judti hain — par sirf usi currency me.
import { QueryTypes } from "sequelize";
import { SportsBet_default } from "../../../models/user/SportsBet.mjs";
import { isVoidRow, stripVoidPrefix, withVoidSuffix } from "../../../lib/helper/voidLabel.mjs";
import { fanMarketName } from "../../../lib/helper/fanMarketName.mjs";
import { sportsMarketKey } from "./UserStatementService.mjs";

// TRANSACTION: what /sports/statement's "Transactions" means for a direct player — every move that
// is not a game (deposit, withdrawal, admin, bonus, transfer, stake holds).
const REPORT_TYPES = ["ALL", "SPORTS", "CASINO", "TRANSACTION"];

/** Same market + same currency ki rows ek line: delta jodo, baaki aakhri row ka. */
const groupRows = (rows, sportsBetMap) => {
  const out = [];
  const seen = {};
  for (const row of rows) {
    const market = sportsMarketKey(row, sportsBetMap);
    if (!market) {
      out.push(row);
      continue;
    }
    const key = `${row.currency}:${market}`;
    if (seen[key] === undefined) {
      seen[key] = out.length;
      out.push({ ...row });
      continue;
    }
    const merged = out[seen[key]];
    merged.delta = Number(merged.delta || 0) + Number(row.delta || 0);
    merged.created_at = row.created_at;
    merged.closing_inr_balance = row.closing_inr_balance;
    merged.remark = row.remark;
    merged.bet_id = row.bet_id;
  }
  return out;
};

/**
 * TENEXCH's statement shows the cash that moved (closing − previous closing) and drops a row that
 * moved nothing. A sports settlement here is two kinds of row: the wallet's own move(s) (trigger
 * rows, unlabelled BALANCE_CHANGE: a payout, or a fancy's exposure release + result) and then the
 * P/L row `settle:bet:SPORTS:<id>` (not a move). So the P/L row takes the cash of the unlabelled
 * moves right before it in its currency (they fold into it), and a settlement that moved nothing
 * (a lost Match Odds bet: the stake left at placement) is dropped instead of reading as a second debit.
 * shortcut: folds by adjacency in the user's own ledger; a stray unlabelled move landing between a
 * settlement's wallet write and its P/L row would fold in too — label settlement writes to upgrade.
 */
const isUnlabelledMove = (r) => r.event_type === "BALANCE_CHANGE" && r.bet_id == null && !r.remark;
const isSportsSettlement = (r) => r.category === "SPORTS" && r.event_type === "BET_SETTLEMENT" && String(r.entry_ref || "").startsWith("settle:");

/** P/L view: a sports row is a settlement, its reversal or a void (each bet's result), never the stake
 *  hold, release or the unlabelled cash a settlement moves. Other categories are kept as they are. */
const PNL_EVENTS = new Set(["BET_SETTLEMENT", "REVERSAL", "VOID", "COMMISSION"]);
const isPnlRow = (r) =>
  !["BET_PLACED", "BET_RELEASED"].includes(r.event_type) && (r.category === "SPORTS" ? PNL_EVENTS.has(r.event_type) : !isUnlabelledMove(r));

function foldSettlementMoves(rows) {
  const out = [];
  const pending = {};
  for (const row of rows) {
    const cur = row.currency;
    if (isUnlabelledMove(row)) {
      (pending[cur] ??= []).push(out.length);
      out.push(row);
      continue;
    }
    if (isSportsSettlement(row)) {
      const moved = (pending[cur] ?? []).map((i) => out[i]);
      for (const m of moved) m.folded = true;
      const delta = Math.round(moved.reduce((acc, m) => acc + Number(m.delta || 0), 0) * 100) / 100;
      if (delta !== 0) out.push({ ...row, delta });
    } else {
      out.push(row);
    }
    pending[cur] = [];
  }
  return out.filter((r) => !r.folded);
}

const OG_REMARK = /^original-games (bet|win|rollback) (\S+)/;

/**
 * Rows written before their writers named them: an Original Games move reads "original-games bet
 * <tx>" (→ "Arrow Bow bet", the game from og_transactions → og_games, as the admin balance sheet
 * does) and a swap reads BALANCE_CHANGE with no remark (→ its credits_ledger leg, "Swap INR -> USDT":
 * same currency and amount, within a few seconds). Both written named now; this is for the old rows.
 */
async function nameOldRows(target, raw) {
  const quiet = (sql, replacements) => target.db.query(sql, { replacements, type: QueryTypes.SELECT }).catch(() => []);
  const ogRows = raw.filter((r) => OG_REMARK.test(r.remark || ""));
  if (ogRows.length) {
    const refs = ogRows.map((r) => r.remark.match(OG_REMARK)[2]);
    const found = await quiet(
      `SELECT o.transaction_id AS tx, COALESCE(g.name, o.game_code) AS name
         FROM og_transactions o LEFT JOIN og_games g ON g.code = o.game_code
        WHERE o.transaction_id IN (:refs)`,
      { refs }
    );
    const names = new Map(found.map((f) => [String(f.tx), f.name]));
    for (const r of ogRows) {
      const [, kind, tx] = r.remark.match(OG_REMARK);
      r.remark = `${names.get(tx) || "Original game"} ${kind}`;
    }
  }
  const unnamed = raw.filter((r) => r.event_type === "BALANCE_CHANGE" && !r.remark);
  if (unnamed.length) {
    const legs = await quiet(
      `SELECT currency, amount, description, created_at FROM public.credits_ledger
        WHERE user_id = :userId AND meta->>'swap' = 'true'`,
      { userId: String(target.id) }
    );
    for (const r of unnamed) {
      const leg = legs.find((l) => String(l.currency).toUpperCase() === r.currency && Number(l.amount) === Number(r.delta) &&
        Math.abs(new Date(l.created_at) - new Date(r.created_at)) < 5000);
      if (leg) r.remark = leg.description;
    }
  }
}

const DirectStatementService = {
  REPORT_TYPES,

  /**
   * @param {{ id: number|string, db: import('sequelize').Sequelize }} target  logged-in user
   * @param {{ fromDate?, toDate?, reportType?, currency?, search?, page?, limit? }} filters
   */
  getAccountStatement: async (target, filters) => {
    const { fromDate, toDate, reportType = "ALL", currency, search, view = "cash" } = filters;
    const page = Math.max(parseInt(filters.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 25, 1), 500);
    const where = ["user_id = :userId"];
    const replacements = { userId: String(target.id) };
    if (fromDate) {
      where.push("created_at >= :from");
      replacements.from = new Date(fromDate);
    }
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      where.push("created_at <= :to");
      replacements.to = end;
    }
    const needle = search && String(search).trim() ? String(search).trim().toLowerCase() : null;
    // The category and search filters run after `foldSettlementMoves`, which needs the unlabelled
    // (OTHER) wallet moves beside the SPORTS settlement rows.
    const keep = (r) =>
      (reportType === "ALL" ||
        (reportType === "TRANSACTION" ? !["SPORTS", "CASINO", "ORIGINAL_GAME"].includes(r.category) : r.category === reportType)) &&
      (!needle || String(r.remark || "").toLowerCase().includes(needle));
    if (currency) {
      where.push("currency = :currency");
      replacements.currency = String(currency).toUpperCase();
    }
    // v2 ke column naam me (closing_inr_balance) — grouping aur mapping wahi rehti hai.
    let raw = await target.db.query(
      `SELECT id, entry_ref, event_type, category, currency, delta, balance_after AS closing_inr_balance,
              bet_id, sport_id, game_type, remark, created_at
         FROM mssports.point_ledger_direct
        WHERE ${where.join(" AND ")}
        ORDER BY id ASC`,
      { replacements, type: QueryTypes.SELECT }
    );

    await nameOldRows(target, raw);
    // "cash" (the statement page): rows are the money that moved. "pnl" (Bet History): each settlement
    // keeps its own P/L row, so a lost bet reads −stake and a win its profit, not stake + profit.
    raw = (view === "pnl" ? raw.filter(isPnlRow) : foldSettlementMoves(raw)).filter(keep);

    const sportsBetIds = [...new Set(raw.filter((r) => r.category === "SPORTS" && r.bet_id).map((r) => Number(r.bet_id)))];
    const sportsBetMap = {};
    if (sportsBetIds.length) {
      const bets = await SportsBet_default.findAll({
        where: { id: sportsBetIds },
        attributes: ["id", "sport_id", "eventid", "match_id", "market_type", "game_type", "fancy_name", "selection_name"],
        raw: true
      });
      for (const b of bets) sportsBetMap[b.id] = b;
    }

    const grouped = groupRows(raw, sportsBetMap);
    const total = grouped.length;
    const data = grouped.slice((page - 1) * limit, page * limit).map((r) => {
      const delta = parseFloat(r.delta || 0);
      const voidRow = isVoidRow(r);
      let description = r?.remark?.split("#")[0] || r.event_type;
      if (voidRow) description = withVoidSuffix(stripVoidPrefix(description));
      const sb = r.category === "SPORTS" ? sportsBetMap[r.bet_id] : null;
      const gameType = sb?.game_type ?? r.game_type ?? null;
      return {
        date: r.created_at,
        currency: r.currency,
        credit: delta > 0 ? delta.toFixed(2) : "-",
        debit: delta < 0 ? Math.abs(delta).toFixed(2) : "-",
        closing: r.closing_inr_balance != null ? parseFloat(r.closing_inr_balance).toFixed(2) : "-",
        description,
        fromto: r?.remark?.split("#")[1] || "-",
        category: r.category || null,
        betId: r.bet_id != null ? Number(r.bet_id) : null,
        sportId: sb?.sport_id ?? r.sport_id ?? null,
        eventId: sb?.eventid ?? null,
        matchId: sb?.match_id ?? null,
        marketType: sb?.market_type ?? null,
        gameType,
        fancyName: String(gameType || "").toUpperCase() === "FAN" ? fanMarketName(sb) : null,
        // BET_SETTLEMENT | REVERSAL | VOID (settle se pehle void, delta 0)
        eventType: r.event_type || null
      };
    });

    return { success: true, data, total, totalPages: Math.ceil(total / limit), currentPage: page };
  }
};

export { DirectStatementService, foldSettlementMoves, isPnlRow };
