// services/user/UserStatementService.js — mssports core, moved unchanged
import { SportsBet_default } from "../../../models/user/SportsBet.mjs";
import { CreditsLedger_default } from "../../../models/user/CreditsLedger.mjs";
import { PointLedger_default } from "../../../models/admin/PointLedger.mjs";
import { POINT_EVENT } from "../../../lib/constants/pointLedger.mjs";
import { isVoidRow, stripVoidPrefix, withVoidSuffix } from "../../../lib/helper/voidLabel.mjs";
import { SPORT_NAMES, sportsNet, loadFanSettlementNet } from "./StatementBuilder.mjs";
import { toNaiveLocalTime } from "../../../lib/helper/naiveLocalTime.mjs";
import { isKhadoBet, fanMarketName } from "../../../lib/helper/fanMarketName.mjs";

import { Op as Op9 } from "sequelize";
var IST_OFFSET_MS2 = 5.5 * 60 * 60 * 1e3;
var istStartOfDay = (value) => {
  const t = new Date(value);
  if (isNaN(t)) return null;
  const ist = new Date(t.getTime() + IST_OFFSET_MS2);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS2);
};
var buildOpeningRow = (groupedRows, search, accountCreatedAt, fallbackBalance = null) => {
  if (search && String(search).trim()) return null;
  if (!groupedRows.length) {
    if (fallbackBalance === null) return null;
    const at0 = istStartOfDay(accountCreatedAt);
    if (!at0) return null;
    return {
      __opening: true,
      id: null,
      created_at: at0,
      delta: fallbackBalance,
      closing_inr_balance: fallbackBalance,
      remark: "Opening pts",
      category: null,
      bet_id: null
    };
  }
  const first = groupedRows[0];
  const closing = parseFloat(first.closing_inr_balance);
  const firstDelta = parseFloat(first.delta || 0);
  if (!Number.isFinite(closing) || !Number.isFinite(firstDelta)) return null;
  const opening = Math.round((closing - firstDelta) * 100) / 100;
  const at = istStartOfDay(accountCreatedAt || first.created_at);
  if (!at) return null;
  return {
    __opening: true,
    id: null,
    created_at: at,
    delta: opening,
    closing_inr_balance: opening,
    remark: "Opening pts",
    category: null,
    bet_id: null
  };
};
var isCommissionRow = (row) => row.event_type === POINT_EVENT.COMMISSION || String(row.entry_ref || "").startsWith("reverse:commission:");
var sportsMarketKey = (row, sportsBetMap) => {
  const base = sportsMarketBaseKey(row, sportsBetMap);
  if (!base) return null;
  const key = isCommissionRow(row) ? `${base}:comm` : base;
  return isVoidRow(row) ? `${key}:void` : key;
};
var sportsMarketBaseKey = (row, sportsBetMap) => {
  if (row.category !== "SPORTS") return null;
  const bet = sportsBetMap[row.bet_id];
  if (!bet || !bet.eventid) return null;
  if (String(bet.game_type || "").toUpperCase() === "FAN") {
    const name = fanMarketName(bet);
    return name ? `S:${bet.eventid}:${bet.market_type || ""}:${name}` : null;
  }
  return bet.match_id ? `S:${bet.eventid}:${bet.match_id}` : null;
};
var groupStatementRows = (rows, sportsBetMap) => {
  const out = [];
  const seen = {};
  for (const row of rows) {
    const key = sportsMarketKey(row, sportsBetMap);
    if (!key) {
      out.push(row);
      continue;
    }
    if (seen[key] === void 0) {
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
var UserStatementService = {
  getAccountStatementV2: async (target, filters) => {
    try {
      const { fromDate, toDate, reportType, search, page = 1, limit = 25 } = filters;
      const offset = (page - 1) * limit;
      console.log(`\u{1F50D} [UserStatementService] StatementV2 for ${target.username} (wallet ${target.walletId}) | ${fromDate || "-"} \u2192 ${toDate || "-"} | type: ${reportType} | search: ${search || "-"}`);
      const where = { wallet_id: target.walletId };
      if (fromDate || toDate) {
        where.created_at = {};
        if (fromDate) where.created_at[Op9.gte] = new Date(fromDate);
        if (toDate) {
          const end = new Date(toDate);
          end.setHours(23, 59, 59, 999);
          where.created_at[Op9.lte] = end;
        }
      }
      if (search && String(search).trim()) {
        where.remark = { [Op9.iLike]: `%${String(search).trim()}%` };
      }
      const rt = String(reportType || "ALL").toUpperCase().trim();
      if (rt === "TRANSACTION") where.bet_id = null;
      else if (rt === "SPORTS") where.bet_id = { [Op9.ne]: null };
      const rawLedgerRows = await PointLedger_default.findAll({
        where,
        order: [["id", "ASC"]],
        // purani entry pehle
        raw: true
      });
      const allRows = target?.isDemo && rt !== "ALL" ? rawLedgerRows.filter((r) => r.event_type !== POINT_EVENT.USER_CREATION) : rawLedgerRows;
      const sportsBetIds = [...new Set(allRows.filter((r) => r.category === "SPORTS" && r.bet_id).map((r) => Number(r.bet_id)))];
      const sportsBetMap = {};
      if (sportsBetIds.length) {
        const sportsBets = await SportsBet_default.findAll({
          where: { id: sportsBetIds },
          attributes: ["id", "sport_id", "eventid", "match_id", "market_type", "game_type", "fancy_name", "selection_name"],
          raw: true
        });
        sportsBets.forEach((b) => {
          sportsBetMap[b.id] = b;
        });
      }
      const groupedRows = groupStatementRows(allRows, sportsBetMap);
      let openingFallback = null;
      if (!groupedRows.length) {
        const prevWhere = { wallet_id: target.walletId };
        if (fromDate) prevWhere.created_at = { [Op9.lt]: new Date(fromDate) };
        const prev = await PointLedger_default.findOne({
          where: prevWhere,
          order: [["id", "DESC"]],
          attributes: ["closing_inr_balance"],
          raw: true
        });
        openingFallback = prev ? Number(prev.closing_inr_balance) || 0 : 0;
      }
      const openingRow = buildOpeningRow(groupedRows, search, target?.createdAt, openingFallback);
      const ledgerRows = [
        ...openingRow ? [openingRow] : [],
        ...groupedRows
      ];
      const count = ledgerRows.length;
      const rows = ledgerRows.slice(offset, offset + parseInt(limit));
      const data = rows.map((r) => {
        const delta = parseFloat(r.delta || 0);
        if (r.__opening) {
          const bal = parseFloat(r.closing_inr_balance).toFixed(2);
          return {
            date: r.created_at,
            credit: bal,
            debit: "-",
            closing: bal,
            description: "Opening pts",
            fromto: "-",
            category: null,
            betId: null,
            sportId: null,
            eventId: null,
            matchId: null,
            marketType: null,
            gameType: null,
            isOpening: true
          };
        }
        let sportId = null, eventId = null, matchId = null, marketType = null, gameType = null;
        let fancyName = null;
        const voidRow = isVoidRow(r);
        let description = r?.remark?.split("#")[0] || r.event_type;
        if (voidRow) description = stripVoidPrefix(description);
        if (r.category === "SPORTS") {
          const sb = sportsBetMap[r.bet_id];
          sportId = sb?.sport_id ?? r.sport_id ?? null;
          eventId = sb?.eventid ?? null;
          matchId = sb?.match_id ?? null;
          marketType = sb?.market_type ?? null;
          gameType = sb?.game_type ?? r.game_type ?? null;
          if (String(gameType || "").toUpperCase() === "FAN") {
            fancyName = fanMarketName(sb);
            if (fancyName && description && !description.includes(fancyName)) {
              const parts = String(description).split(" / ");
              const spanAt = parts.length - 2;
              if (isKhadoBet(sb) && parts.length >= 3 && parts[spanAt] === String(sb.fancy_name ?? "")) {
                parts[spanAt] = fancyName;
                description = parts.join(" / ");
              } else if (parts.length >= 2) {
                parts.splice(parts.length - 1, 0, fancyName);
                description = parts.join(" / ");
              }
            }
          }
        }
        if (voidRow) description = withVoidSuffix(description);
        return {
          date: r.created_at,
          credit: delta > 0 ? delta.toFixed(2) : "-",
          debit: delta < 0 ? Math.abs(delta).toFixed(2) : "-",
          closing: r.closing_inr_balance != null ? parseFloat(r.closing_inr_balance).toFixed(2) : "-",
          description,
          fromto: r?.remark?.split("#")[1] || "-",
          category: r.category || null,
          betId: r.bet_id != null ? Number(r.bet_id) : null,
          sportId,
          eventId,
          matchId,
          marketType,
          gameType,
          fancyName,
          // 'User creation' = the account's opening credit: nothing to open.
          eventType: r.event_type || null
        };
      });
      return {
        success: true,
        data,
        total: count,
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page)
      };
    } catch (e) {
      console.error("\u274C [UserStatementService] getAccountStatementV2 error:", e);
      throw e;
    }
  },
  /**
   * Result modal for a SPORTS statement row: us market ke bets (SportsBet table
   * se) + winner (credits_ledger settlement description se).
   * Pehchaan: matchId (= market/mid) + eventId (= match/gmid), aur FAN par uske
   * upar fancyName — kyunki fancy markets ka match_id poore event me ek hi hota
   * hai (DB me 724 FAN bets par sirf 153 distinct match_id vs 420 asli markets).
   * Bina fancyName ke modal us event ki SAARI fancy bets dikha deta tha.
   * user_id filter se sirf logged-in user ke apne bets aate hain.
   */
  getStatementMarketBets: async (target, params = {}) => {
    try {
      const { matchId, eventId, fancyName } = params;
      if (!matchId || !eventId) {
        return { success: false, message: "matchId and eventId required" };
      }
      const fancy = fancyName ? String(fancyName).trim() : "";
      const where = {
        user_id: target.id,
        match_id: String(matchId),
        eventid: String(eventId),
        // Bet placement kabhi fancy_name me naam rakhta hai, kabhi sirf
        // selection_name me (khado/fancy1 par fancy_name line hoti hai),
        // isliye dono par match karo.
        ...fancy ? { [Op9.or]: [{ fancy_name: fancy }, { selection_name: fancy }] } : {}
      };
      const betRows = await SportsBet_default.findAll({
        where,
        order: [["created_at", "ASC"], ["id", "DESC"]],
        raw: true
      });
      const settledCredit = { [Op9.or]: [{ profit: { [Op9.ne]: null } }, { loss: { [Op9.ne]: null } }] };
      const betIds = betRows.map((b) => b.id);
      const credit = await CreditsLedger_default.findOne({
        where: {
          category: "SPORTS",
          user_id: String(target.id),
          eventid: String(eventId),
          // Commission rows carry loss too, and sort newer — the winner must
          // come from the settlement row, never "…- Comm".
          reason: { [Op9.notIn]: ["commission", "commission_void"] },
          ...fancy && betIds.length ? { bet_id: { [Op9.in]: betIds } } : { match_id: String(matchId) },
          ...settledCredit
        },
        order: [["id", "DESC"]],
        raw: true
      });
      let winner = null;
      if (credit?.description) {
        const parts = String(credit.description).split(" / ");
        if (parts.length >= 2) winner = parts[parts.length - 1].trim() || null;
      }
      const fanNet = await loadFanSettlementNet(target.id, betRows);
      const DELETED_STATES = ["refund", "void", "deleted", "cancelled"];
      let totalBets = 0;
      let totalWin = 0;
      const bets = betRows.map((b) => {
        const bt = String(b.bet_type || "").toLowerCase();
        const side = bt === "back" || bt === "yes" ? "BACK" : bt === "lay" || bt === "no" ? "LAY" : null;
        const rs = String(b.result_status || "").toLowerCase();
        const deleted = DELETED_STATES.includes(rs) || DELETED_STATES.includes(String(b.status || "").toLowerCase());
        const settled = rs === "won" || rs === "loss";
        const win = settled ? Math.round(sportsNet(b, fanNet.get(String(b.id))) * 100) / 100 : null;
        if (!deleted) {
          totalBets += 1;
          totalWin += win || 0;
        }
        return {
          ...b,
          user: { username: target.username || null },
          sport_name: SPORT_NAMES[b.sport_id] || (b.sport_id ? `Sport ${b.sport_id}` : null),
          side,
          win,
          deleted
        };
      });
      const first = betRows[0] || null;
      const header = first ? {
        sportId: first.sport_id || null,
        sportName: SPORT_NAMES[first.sport_id] || (first.sport_id ? `Sport ${first.sport_id}` : "-"),
        eventId: first.eventid || null,
        matchId: first.match_id || null,
        matchTitle: first.match_title || [first.team_one, first.team_two].filter(Boolean).join(" v ") || "-",
        // League segment of the Result-modal breadcrumb (buildBreadcrumb in
        // AccountStatement.jsx). Null on bets placed before the column existed.
        competitionName: first.league_name || null,
        marketType: first.market_type || "-",
        gameType: first.game_type || null,
        // FAN par market_type sirf "Normal"/"khado" jaisa bucket hai — modal ke
        // breadcrumb me asli market yahi naam hai.
        fancyName: String(first.game_type || "").toUpperCase() === "FAN" ? fanMarketName(first) : null,
        // Naive "YYYY-MM-DD HH:mm:ss": match_start_time holds the feed's IST wall
        // clock read as server-local, so a raw Date rendered 3h30m late in an IST
        // browser (00:30 showed as 04:00). See helper/naiveLocalTime.js.
        gameTime: toNaiveLocalTime(first.match_start_time) || first.created_at || null
      } : null;
      return {
        success: true,
        header,
        winner,
        description: credit?.description || null,
        settledAt: credit?.created_at || null,
        totalBets,
        totalWin: Math.round(totalWin * 100) / 100,
        bets
      };
    } catch (e) {
      console.error("\u274C [UserStatementService] getStatementMarketBets error:", e);
      throw e;
    }
  }
};
var UserStatementService_default = UserStatementService;

export { UserStatementService_default, sportsMarketKey };
