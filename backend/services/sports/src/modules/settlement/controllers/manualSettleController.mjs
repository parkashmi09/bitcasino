// mannualSettle/controller.js — mssports core, moved unchanged
import { db_default, init_db } from "../../../lib/config/db.mjs";
import { TotalExposure_default, init_TotalExposure } from "../../../models/user/TotalExposure.mjs";
import { User_default } from "../../../models/user/User.mjs";
// Wallets → credits: the player's sports balance is the platform wallet, credits.inr.
// import { Wallet_default } from "../../../models/admin/Wallet.mjs";
import { Credits_default } from "../../../models/user/Credits.mjs";
import { SportsBet_default } from "../../../models/user/SportsBet.mjs";
import { UserExposure_default } from "../../../models/user/UserExposure.mjs";
import { isLineMarket, exposureIdentity } from "../../../lib/helper/lineMarket.mjs";
import { isBadloBet } from "../../../lib/helper/badloMarket.mjs";
import { recalcTotalExposure } from "../../../lib/helper/totalExposure.mjs";
import { isPerSelectionMarket, selectionExposureRows, releasableLiability } from "../../../lib/helper/exposureBucket.mjs";
import { enqueueManualBets } from "../services/settlementQueue.mjs";
import { VOID_TYPES } from "../../../models/admin/BetVoidAudit.mjs";
import { manualresult_default } from "../../../models/admin/manualresult.mjs";
import { ActivityLogService_default } from "../../../lib/services/ActivityLogService.mjs";
import { newVoidGroupId, actorFrom, recordVoidAudit } from "../services/voidAuditService.mjs";
import { recordVoidRefund, voidOpenMarket } from "../services/sportsMarketVoidService.mjs";
import { listSettledMarkets, listSettledBets, voidSettledLedgerEntry, voidSettledMarket } from "../services/sportsVoidService.mjs";

init_TotalExposure();
init_db();
import { Op as Op13, Sequelize as Sequelize3 } from "sequelize";
import { fn, col, literal } from "sequelize";
var recordManualVoidRefund = (args, t) => recordVoidRefund(args, t);
var parseRunners = (raw) => {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw.length ? raw : null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
};
var getMoMatches = async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  const offset = parseInt(req.query.offset, 10) || 0;
  try {
    const rows = await SportsBet_default.findAll({
      attributes: [
        "match_id",
        "eventid",
        "game_type",
        "market_type",
        [fn("MAX", col("match_title")), "match_title"],
        [fn("MAX", col("team_one")), "team_one"],
        [fn("MAX", col("team_two")), "team_two"],
        [fn("COUNT", col("*")), "totalbets"],
        [fn("MAX", col("counts")), "counts"],
        // Same bug getFanOpenBets fixed below: without the runner list
        // the declare modal falls back to [team_one, team_two], so a
        // 3-way market's draw has no button and cannot be declared.
        // `runners` is json, which has no MAX aggregate in Postgres —
        // cast to text here and parse it back in the mapper.
        [literal("MAX(runners::text)"), "runners"]
      ],
      where: {
        game_type: { [Op13.or]: ["MO", "BM"] },
        status: "open",
        match_id: { [Op13.ne]: null },
        eventid: { [Op13.ne]: null }
      },
      group: ["match_id", "eventid", "game_type", "market_type"],
      order: [[fn("MAX", col("created_at")), "DESC"]],
      limit,
      offset,
      raw: true
    });
    const payload = rows.map((r) => ({
      matchId: r.match_id,
      eventId: r.eventid,
      gameType: r.game_type,
      marketType: r.market_type,
      matchTitle: r.match_title,
      teamOne: r.team_one,
      teamTwo: r.team_two,
      totalBets: parseInt(r.totalbets, 10),
      counts: r.counts !== null ? Number(r.counts) : null,
      runners: parseRunners(r.runners)
    }));
    return res.json({ success: true, data: payload });
  } catch (err) {
    console.error("getMoMatches error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
var getFanOpenBets = async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || void 0;
  const offset = parseInt(req.query.offset, 10) || void 0;
  const marketsforfancy = [
    "1st Innings 6 Overs Line",
    "2nd Innings 6 Overs Line",
    "3rd Innings 6 Overs Line",
    "1st Innings 50 Overs Line",
    "2nd Innings 50 Overs Line",
    "3rd Innings 50 Overs Line",
    "1st Innings 40 Overs Line",
    "2nd Innings 40 Overs Line",
    "3rd Innings 40 Overs Line",
    "1st Innings 30 Overs Line",
    "2nd Innings 30 Overs Line",
    "3rd Innings 30 Overs Line",
    "1st Innings 20 Overs Line",
    "2nd Innings 20 Overs Line",
    "3rd Innings 20 Overs Line",
    "1st Innings 10 Overs Line",
    "2nd Innings 10 Overs Line",
    "3rd Innings 10 Overs Line",
    "Over By Over",
    "Ball By Ball",
    "Normal",
    "khado",
    "meter",
    "fancy1",
    "oddeven",
    "badlo"
  ];
  try {
    const groups = await SportsBet_default.findAll({
      attributes: [
        "match_id",
        "eventid",
        "match_id",
        "eventid",
        "market_type",
        "selection_name",
        "game_type",
        [fn("MAX", col("match_title")), "match_title"],
        [fn("COUNT", col("*")), "totalbets"],
        [fn("MAX", col("counts")), "counts"]
      ],
      where: {
        // game_type: 'FAN', // Removed to follow previous pattern if user wants mo/bm here too? NO, user said "getFanOpenBets". Let's assume FAN only unless told.
        // Wait, "gametype should come proper".
        // I will include game_type in attributes.
        game_type: "FAN",
        status: "open",
        match_id: { [Op13.ne]: null },
        eventid: { [Op13.ne]: null }
        // removed strict market_type filter to include others
      },
      group: ["match_id", "eventid", "market_type", "selection_name", "game_type"],
      order: [[fn("MAX", col("created_at")), "DESC"]],
      limit,
      offset,
      raw: true
    });
    if (!groups.length) {
      return res.json({ success: true, data: { fancy1: [], others: [] } });
    }
    const criteria = groups.map((g) => ({
      match_id: g.match_id,
      eventid: g.eventid,
      market_type: g.market_type,
      selection_name: g.selection_name,
      game_type: g.game_type
    }));
    const bets = await SportsBet_default.findAll({
      where: limit ? { status: "open", [Op13.or]: criteria } : { game_type: "FAN", status: "open", match_id: { [Op13.ne]: null }, eventid: { [Op13.ne]: null } },
      order: [["created_at", "ASC"]],
      raw: true
    });
    const groupMap = /* @__PURE__ */ new Map();
    groups.forEach((g) => {
      let mType = g.market_type;
      let groupKey = mType;
      if (!marketsforfancy.includes(mType)) {
        groupKey = "others";
      }
      const key = `${g.match_id}||${g.eventid}||${mType}||${g.game_type}||${g.selection_name}`;
      if (groupMap.has(key)) {
        const existing = groupMap.get(key);
        existing.totalBets += parseInt(g.totalbets, 10);
      } else {
        groupMap.set(key, {
          groupKey,
          matchId: g.match_id,
          eventId: g.eventid,
          matchTitle: g.match_title,
          marketType: mType,
          // Original type
          selectionName: g.selection_name,
          gameType: g.game_type,
          totalBets: parseInt(g.totalbets, 10),
          counts: g.counts !== null ? Number(g.counts) : null,
          bets: []
        });
      }
    });
    bets.forEach((b) => {
      let mType = b.market_type;
      const key = `${b.match_id}||${b.eventid}||${mType}||${b.game_type}||${b.selection_name}`;
      const bucket = groupMap.get(key);
      if (bucket) {
        bucket.bets.push({
          id: b.id,
          userId: b.user_id,
          betType: b.bet_type,
          selectionName: b.selection_name,
          marketType: b.market_type,
          gameType: b.game_type,
          teamOne: b.team_one,
          teamTwo: b.team_two,
          odds: b.odds !== null ? Number(b.odds) : null,
          stakeAmount: b.stake_amount !== null ? Number(b.stake_amount) : null,
          originalCurrency: b.original_currency,
          originalAmount: b.original_amount !== null ? Number(b.original_amount) : null,
          usdAmount: b.usd_amount !== null ? Number(b.usd_amount) : null,
          liability: b.liability !== null ? Number(b.liability) : null,
          status: b.status,
          createdAt: b.created_at,
          counts: b.counts !== null ? Number(b.counts) : null,
          // The declare modal offers ONE BUTTON PER RUNNER when the
          // bet carries a runner list ("0 Number" … "9 Number", a
          // 10-way market). Without this field it saw `undefined`,
          // fell back to [team_one, 'Draw', team_two] on counts >= 3,
          // and an operator could only ever declare the first runner,
          // a draw, or the second — the other 8 were unreachable.
          // Sequelize returns this JSON column already parsed.
          runners: b.runners || null
        });
      }
    });
    const payload = {};
    marketsforfancy.forEach((m) => {
      payload[m] = [];
    });
    payload["others"] = [];
    for (const val of groupMap.values()) {
      const listKey2 = val.groupKey;
      delete val.groupKey;
      if (payload[listKey2]) {
        payload[listKey2].push(val);
      } else {
        payload["others"].push(val);
      }
    }
    return res.json({ success: true, data: payload });
  } catch (err) {
    console.error("getFanOpenBets error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};
var declareResult = async (req, res) => {
  const { eventid, match_id, match_title, game_type, market_type, winnerName, winnerId, fancyName } = req.body;
  if (!eventid || !match_id || !match_title || !game_type || !market_type) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields: eventid, match_id, match_title, game_type, market_type"
    });
  }
  if (["MO", "BM"].includes(game_type)) {
    if (!winnerName) {
      return res.status(400).json({ success: false, error: "winnerName is required for MO and BM" });
    }
  } else if (game_type === "FAN") {
    const marketsforfancy = [
      "1st Innings 6 Overs Line",
      "2nd Innings 6 Overs Line",
      "3rd Innings 6 Overs Line",
      "1st Innings 50 Overs Line",
      "2nd Innings 50 Overs Line",
      "3rd Innings 50 Overs Line",
      "1st Innings 40 Overs Line",
      "2nd Innings 40 Overs Line",
      "3rd Innings 40 Overs Line",
      "1st Innings 30 Overs Line",
      "2nd Innings 30 Overs Line",
      "3rd Innings 30 Overs Line",
      "1st Innings 20 Overs Line",
      "2nd Innings 20 Overs Line",
      "3rd Innings 20 Overs Line",
      "1st Innings 10 Overs Line",
      "2nd Innings 10 Overs Line",
      "3rd Innings 10 Overs Line",
      "Over By Over",
      "Ball By Ball",
      "Normal",
      "khado",
      "meter",
      "badlo"
    ];
    const lineMarket = isLineMarket(market_type);
    if (lineMarket && !/^\d+$/.test(String(winnerId ?? "").trim())) {
      return res.status(400).json({ success: false, error: "winnerId must be the run total (a whole number) for a line market" });
    }
    if (marketsforfancy.includes(market_type) || lineMarket) {
      if (["fancy1", "oddeven"].includes(market_type)) {
        if (!winnerName) {
          return res.status(400).json({ success: false, error: "winnerName is required for this fancy market" });
        }
      } else {
        if (!winnerId) {
          return res.status(400).json({ success: false, error: "winnerId is required for this fancy market" });
        }
      }
      if (!fancyName) {
        return res.status(400).json({ success: false, error: "fancyName is required for this fancy market" });
      }
    } else {
      if (!winnerName) {
        return res.status(400).json({ success: false, error: "winnerName is required for this fancy market" });
      }
    }
  }
  const t = await db_default.transaction();
  try {
    const newResult = await manualresult_default.create({
      eventid,
      match_id,
      match_title,
      game_type,
      market_type,
      winnerName: winnerName || null,
      winnerId: winnerId || null,
      fancyName: fancyName || null
    }, { transaction: t });
    const [updatedCount] = await SportsBet_default.update(
      { status: "manual" },
      {
        where: {
          match_id,
          market_type,
          game_type,
          status: "open",
          ...["fancy1", "oddeven", "Over By Over", "Ball By Ball", "khado", "meter", "Normal", "badlo"].includes(market_type) ? { selection_name: fancyName } : {}
        },
        transaction: t
      }
    );
    await t.commit();
    let settlement = null;
    try {
      settlement = await enqueueManualBets({
        eventid,
        match_id,
        market_type,
        log: { info: console.log, error: console.error, debug: () => {
        } }
      });
    } catch (e) {
      console.error("declareResult: settlement enqueue failed", e.message);
    }
    return res.json({
      success: true,
      message: "Result declared successfully",
      data: {
        manualResult: newResult,
        updatedBets: updatedCount,
        settlement
      }
    });
  } catch (error) {
    await t.rollback();
    console.error("declareResult error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error"
    });
  }
};
var voidResult = async (req, res) => {
  const { eventid, match_id, market_type, gametype, selection_name } = req.body;
  if (!eventid || !match_id || !market_type) {
    return res.status(400).json({
      success: false,
      error: "Missing required fields: eventid, match_id, market_type"
    });
  }
  try {
    const { userIds, betsVoided, voidGroupId } = await voidOpenMarket({
      match_id,
      market_type,
      gametype,
      selection_name,
      voidType: VOID_TYPES.MARKET,
      context: actorFrom(req)
    });
    return res.json({
      success: true,
      message: "Voided successfully",
      count: userIds.length,
      betsVoided,
      voidGroupId
    });
  } catch (error) {
    console.error("voidResult error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error"
    });
  }
};
var getOpenBetsForMarket = async (req, res) => {
  const { match_id, market_type, game_type, selection_name } = req.query;
  if (!match_id || !market_type) {
    return res.status(400).json({
      success: false,
      error: "match_id and market_type are required"
    });
  }
  try {
    const whereClause = { match_id, market_type, status: "open" };
    if (game_type) whereClause.game_type = game_type;
    if (selection_name) whereClause.selection_name = selection_name;
    const bets = await SportsBet_default.findAll({
      where: whereClause,
      order: [["created_at", "DESC"]],
      raw: true
    });
    const userIds = [...new Set(bets.map((b) => b.user_id).filter(Boolean))];
    const userMap = {};
    if (userIds.length > 0) {
      const users = await User_default.findAll({
        where: { user_id: { [Op13.in]: userIds } },
        attributes: ["user_id", "username"],
        raw: true
      });
      users.forEach((u) => {
        userMap[u.user_id] = u.username;
      });
    }
    const data = bets.map((b) => ({
      id: b.id,
      userId: b.user_id,
      username: userMap[b.user_id] || null,
      betType: b.bet_type,
      selectionName: b.selection_name,
      marketType: b.market_type,
      gameType: b.game_type,
      odds: b.odds !== null ? Number(b.odds) : null,
      stakeAmount: b.stake_amount !== null ? Number(b.stake_amount) : null,
      liability: b.liability !== null ? Number(b.liability) : null,
      status: b.status,
      matchId: b.match_id,
      eventId: b.eventid,
      createdAt: b.created_at
    }));
    return res.json({ success: true, data });
  } catch (error) {
    console.error("getOpenBetsForMarket error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error"
    });
  }
};
var voidSingleOpenBet = async (req, res) => {
  const { bet_id } = req.body;
  if (!bet_id) {
    return res.status(400).json({ success: false, error: "bet_id is required" });
  }
  const t = await db_default.transaction();
  try {
    const bet = await SportsBet_default.findOne({
      where: { id: bet_id, status: "open" },
      transaction: t
    });
    if (!bet) {
      await t.rollback();
      return res.status(404).json({ success: false, error: "Open bet not found" });
    }
    const uid = bet.user_id;
    const match_id = bet.match_id;
    const market_type = bet.market_type;
    // OLD (Wallets.cash + Wallets.inr_balance):
    // const walletBefore = await Wallet_default.findOne({
    //   where: { user_id: uid },
    //   attributes: ["cash", "inr_balance"],
    //   transaction: t
    // });
    const walletBefore = await Credits_default.findOne({
      where: { uid },
      attributes: ["uid", "inr"],
      transaction: t
    });
    const snapBefore = await TotalExposure_default.findOne({
      where: { user_id: uid },
      attributes: ["total_exposure"],
      transaction: t
    });
    const badlo = isBadloBet(bet);
    const { game_type: expGameType, team_name: sel } = exposureIdentity({
      marketType: market_type,
      selectionName: bet.selection_name,
      badlo
    });
    const perSelection = isPerSelectionMarket(market_type) || badlo;
    const otherBets = await SportsBet_default.count({
      where: {
        match_id,
        market_type,
        user_id: uid,
        status: "open",
        id: { [Op13.ne]: bet_id },
        ...perSelection ? { selection_name: bet.selection_name, badlo } : {}
      },
      transaction: t
    });
    let refundAmount = 0;
    let ledgerId = null;
    let exposureRowsDeleted = 0;
    let exposureBefore = null;
    if (otherBets === 0) {
      const exposureWhere = {
        user_id: uid,
        match_id,
        // Line markets file their rows under 'fancy2', keyed by the
        // market name rather than the runner — see helper/lineMarket.js.
        game_type: expGameType,
        // …and for a per-selection market, ONLY this selection's four
        // rows. Without this the destroy would wipe every other open
        // session of the same market_type and leave them unblocked.
        ...perSelection ? { team_name: { [Op13.in]: selectionExposureRows(sel) } } : {}
      };
      const exposures = await UserExposure_default.findAll({
        where: exposureWhere,
        transaction: t
      });
      if (exposures.length > 0) {
        const minExp = releasableLiability(exposures, { perSelection, sel });
        exposureBefore = minExp;
        if (minExp < 0) {
          refundAmount = Math.abs(minExp);
          // OLD (Wallets.cash):
          // await Wallet_default.increment("cash", {
          //   by: refundAmount,
          //   where: { user_id: uid },
          //   transaction: t
          // });
          // NEW (credits.inr): the voided bet's liability goes back to inr.
          await Credits_default.increment("inr", {
            by: refundAmount,
            where: { uid },
            transaction: t
          });
          ledgerId = await recordManualVoidRefund({
            uid,
            refundAmount,
            bet,
            // the single bet being voided
            actor: req.user?.actor?.username || req.user?.username
          }, t);
        }
        exposureRowsDeleted = await UserExposure_default.destroy({ where: exposureWhere, transaction: t });
      }
    }
    await SportsBet_default.update(
      {
        status: "closed",
        result_status: "refunded",
        match_end_time: /* @__PURE__ */ new Date()
      },
      { where: { id: bet_id }, transaction: t }
    );
    const totalAfter = await recalcTotalExposure(uid, t);
    // OLD (Wallets.cash + Wallets.inr_balance):
    // const walletAfter = await Wallet_default.findOne({
    //   where: { user_id: uid },
    //   attributes: ["cash", "inr_balance"],
    //   transaction: t
    // });
    const walletAfter = await Credits_default.findOne({
      where: { uid },
      attributes: ["uid", "inr"],
      transaction: t
    });
    await recordVoidAudit({
      voidGroupId: newVoidGroupId(),
      voidType: VOID_TYPES.OPEN_BET,
      bets: [bet],
      representativeBetId: bet.id,
      before: {
        status: "open",
        resultStatus: bet.result_status,
        // OLD: cash: walletBefore?.cash,
        // OLD: inr: walletBefore?.inr_balance,
        cash: walletBefore?.inr,
        inr: walletBefore?.inr,
        exposure: exposureBefore,
        totalExposure: snapBefore?.total_exposure
      },
      after: {
        status: "closed",
        resultStatus: "refunded",
        // OLD: cash: walletAfter?.cash,
        // OLD: inr: walletAfter?.inr_balance,
        cash: walletAfter?.inr,
        inr: walletAfter?.inr,
        // The bucket is gone when rows were destroyed; when the gate
        // held it is untouched and still equals the pre value.
        exposure: exposureRowsDeleted > 0 ? 0 : exposureBefore,
        totalExposure: totalAfter
      },
      refundAmount,
      exposureRowsDeleted,
      ledgerId,
      context: {
        ...actorFrom(req),
        note: otherBets > 0 ? `exposure retained \u2014 ${otherBets} other open bet(s) still hold this bucket` : null
      }
    }, t);
    await t.commit();
    return res.json({
      success: true,
      message: "Bet voided successfully",
      betId: bet_id,
      userId: uid,
      refunded: refundAmount
    });
  } catch (error) {
    await t.rollback();
    console.error("voidSingleOpenBet error:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error"
    });
  }
};
var getSettledMarkets = async (req, res) => {
  try {
    const { data, windowHours } = await listSettledMarkets({
      search: req.query.search || "",
      limit: req.query.limit,
      offset: req.query.offset
    });
    return res.json({ success: true, windowHours, data });
  } catch (error) {
    console.error("getSettledMarkets error:", error);
    return res.status(500).json({ success: false, error: error.message || "Internal Server Error" });
  }
};
var getSettledBets = async (req, res) => {
  try {
    const data = await listSettledBets({
      matchId: req.query.match_id,
      marketType: req.query.market_type
    });
    return res.json({ success: true, data });
  } catch (error) {
    console.error("getSettledBets error:", error);
    return res.status(400).json({ success: false, error: error.message || "Internal Server Error" });
  }
};
var voidBetAfterSettlement = async (req, res) => {
  const ledgerId = req.body?.ledger_id;
  const writeStatement = req.body?.write_statement !== false;
  if (!ledgerId) return res.status(400).json({ success: false, error: "ledger_id is required" });
  try {
    const result = await voidSettledLedgerEntry(ledgerId, null, { writeStatement });
    await ActivityLogService_default.log({
      req,
      user: { id: req.user?.account?.id, username: req.user?.username, role: req.user?.role },
      action: "SPORTS_BET_VOID_AFTER_SETTLEMENT",
      details: result
    });
    return res.json({
      success: true,
      message: `Settlement voided \u2014 cash ${result.cashBefore} -> ${result.cashAfter}, inr ${result.inrBefore} -> ${result.inrAfter}, ${result.betsVoided} bet(s) marked void`,
      ...result
    });
  } catch (error) {
    console.error("voidBetAfterSettlement error:", error);
    return res.status(400).json({ success: false, error: error.message || "Internal Server Error" });
  }
};
var voidMarketAfterSettlement = async (req, res) => {
  const { match_id, market_type } = req.body || {};
  const writeStatement = req.body?.write_statement !== false;
  if (!match_id) return res.status(400).json({ success: false, error: "match_id is required" });
  try {
    const result = await voidSettledMarket({ matchId: match_id, marketType: market_type, writeStatement });
    await ActivityLogService_default.log({
      req,
      user: { id: req.user?.account?.id, username: req.user?.username, role: req.user?.role },
      action: "SPORTS_MARKET_VOID_AFTER_SETTLEMENT",
      details: { match_id, market_type, writeStatement, affectedUsers: result.affectedUsers, entries: result.entries }
    });
    return res.json({
      success: true,
      message: `${result.entries} settlement entries voided across ${result.affectedUsers} user(s)`,
      ...result
    });
  } catch (error) {
    console.error("voidMarketAfterSettlement error:", error);
    return res.status(400).json({ success: false, error: error.message || "Internal Server Error" });
  }
};
var controller2 = {
  getMoMatches,
  getFanOpenBets,
  declareResult,
  voidResult,
  getOpenBetsForMarket,
  voidSingleOpenBet,
  getSettledMarkets,
  getSettledBets,
  voidBetAfterSettlement,
  voidMarketAfterSettlement
};
var controller_default = controller2;

export { controller_default };
