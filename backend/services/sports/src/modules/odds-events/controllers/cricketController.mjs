// controller/sports/cricket/cricketController.js — mssports core, moved unchanged
import { User_default } from "../../../models/user/User.mjs";
import { SportsBet_default } from "../../../models/user/SportsBet.mjs";
import { CricketService_default } from "../../../lib/services/CricketService.mjs";
import { getStoredMarkets } from "../../../lib/helper/marketListStore.mjs";
import { ScoreAnimationService_default } from "../services/ScoreAnimationService.mjs";
import { SportsEventsService_default } from "../services/SportsEventsService.mjs";
import { isHiddenSport } from "../../../lib/constants/hiddenSports.mjs";

import dotenv5 from "dotenv";
import axios3 from "axios";
import { Op as Op4 } from "sequelize";
dotenv5.config();
var AVRKHUB_SPORTS_BASE_URL2 = process.env.AVRKHUB_SPORTS_BASE_URL;
var AVRKHUB_SPORTS_KEY2 = process.env.AVRKHUB_SPORTS_KEY;
var safeInt = (val, fallback = 1) => {
  if (val == null || val === "") return fallback;
  const n = parseInt(val, 10);
  return isNaN(n) ? fallback : Math.max(1, n);
};
/* The get-match-private-data answer as { status, body }: the REST route and the odds push
   (sockets/oddsPush.mjs) both send exactly this, so the page reads either with the same code. */
async function matchPrivateDataReply(gmid, sid) {
  if (isHiddenSport(sid)) return { status: 404, body: { success: false, error: "This sport is not available" } };
  try {
    return { status: 200, body: { success: true, data: await CricketService_default.GetMatchPrivateData(gmid, sid) } };
  } catch (error) {
    console.error("\u274C Error:", error.message);
    return { status: 500, body: { success: false, error: error.message } };
  }
}
/* The all-data answer as { status, body }: the REST route and the board push (sockets/boardPush.mjs)
   both send exactly this. */
async function sportBoardReply(id) {
  try {
    return { status: 200, body: { success: true, data: await CricketService_default.fetchCricketData(id) } };
  } catch (error) {
    console.error("❌ Error:", error.message);
    return { status: 500, body: { success: false, error: error.message } };
  }
}
var CricketController = {
  // fetch sports data by ID it will show all the data related to games id , ex : if 4 is cricket then it will show all the data [matches or events]related to cricket
  fetchCricketData: async (req, res) => {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({
        success: false,
        error: "ID is required to fetch cricket data"
      });
    }
    const { status, body } = await sportBoardReply(id);
    return res.status(status).json(body);
  },
  getSportdetailsById: async (req, res) => {
    const { gmid, sid } = req.body;
    if (isHiddenSport(sid)) {
      return res.status(404).json({ success: false, error: "This sport is not available" });
    }
    if (!sid || !gmid) {
      return res.status(400).json({
        success: false,
        error: "Sport ID and Game ID are required to fetch data"
      });
    }
    try {
      const sportData = await CricketService_default.getSportDataById(gmid, sid);
      console.log("\u2705 Sport Data:", sportData);
      return res.status(200).json({
        success: true,
        data: sportData
      });
    } catch (error) {
      console.error("\u274C Error:", error.message);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },
  GetallSportsdata: async (req, res) => {
    try {
      const allSportsData = await CricketService_default.GetallSportsdata();
      console.log("\u2705 All Sports Data:", allSportsData);
      return res.status(200).json({
        success: true,
        data: allSportsData
      });
    } catch (error) {
      console.error("\u274C Error:", error.message);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },
  // Admin "More Market": every market the match has shown (redis store, see
  // helper/marketListStore.js) combined with the live feed, so the list is
  // never blank when either source fails. Live wins on name/sno.
  GetMarketList: async (req, res) => {
    const { gmid, sid } = req.body;
    if (!gmid || !sid) {
      return res.status(400).json({ success: false, error: "gmid and sid are required" });
    }
    const [stored, live] = await Promise.allSettled([
      getStoredMarkets(gmid),
      CricketService_default.GetMatchPrivateData(gmid, sid)
    ]);
    const byMid = /* @__PURE__ */ new Map();
    if (stored.status === "fulfilled") {
      stored.value.forEach((m) => byMid.set(String(m.mid), m));
    }
    const liveList2 = live.status === "fulfilled" && Array.isArray(live.value?.data) ? live.value.data : [];
    liveList2.forEach((m) => {
      if (m?.mid != null && m.mname) byMid.set(String(m.mid), { mid: String(m.mid), mname: m.mname, sno: m.sno ?? null });
    });
    if (stored.status === "rejected" && live.status === "rejected") {
      return res.status(500).json({ success: false, error: live.reason?.message || "market list unavailable" });
    }
    const data = [...byMid.values()].sort((x, y) => (Number(x.sno) || 0) - (Number(y.sno) || 0));
    return res.status(200).json({ success: true, data });
  },
  GetMatchPrivateData: async (req, res) => {
    const { gmid, sid } = req.body;
    if (!isHiddenSport(sid) && (!gmid || !sid)) {
      return res.status(400).json({
        success: false,
        error: "Game ID || sid is required to fetch match private data"
      });
    }
    const { status, body } = await matchPrivateDataReply(gmid, sid);
    return res.status(status).json(body);
  },
  fetchLiveStream: async (req, res) => {
    const { gmid } = req.body;
    if (!gmid) {
      return res.status(400).json({
        success: false,
        error: "Game ID is required to fetch live stream data"
      });
    }
    try {
      const liveStreamData = await CricketService_default.fetchLiveStream(gmid);
      console.log("\u2705 Live Stream Data:", liveStreamData);
      return res.status(200).json({
        success: true,
        data: liveStreamData
      });
    } catch (error) {
      console.error("\u274C Error:", error.message);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },
  /* Serves the score-animation page itself, retrying until it gets one that
   * is not the provider's 404. The iframe points here instead of at the
   * scorecard host, because a token is single-use — see
   * services/ScoreAnimationService.js and
   * docs/handover/2026-09-08-scorecard-404-fix.md. */
  fetchScoreAnimation: async (req, res) => {
    const gmid = req.query.gmid;
    const etid = req.query.etid;
    if (!gmid || !etid) {
      return res.status(400).send("gmid and etid are required");
    }
    try {
      const { ok, html, attempts, reason } = await ScoreAnimationService_default.getScoreAnimation(etid, gmid);
      res.set("Cache-Control", "no-store");
      res.set("Content-Type", "text/html; charset=utf-8");
      if (!ok) {
        console.warn(`[ScoreAnimation] gmid=${gmid} etid=${etid} gave up after ${attempts} attempts: ${reason}`);
        return res.status(502).send("");
      }
      res.set("X-Score-Attempts", String(attempts));
      return res.status(200).send(html);
    } catch (error) {
      console.error("\u274C ScoreAnimation Error:", error.message);
      return res.status(500).send("");
    }
  },
  /* The scorecard's iframe URL, minted fresh and handed over unused.
   *
   * The browser used to load the scorecard host itself, which meant a black
   * page while its nested provider frame came up, and a fresh token on every
   * iframe load — including the ones a remount caused. Resolving it here gives
   * the client a direct provider URL, one hop, one token, spent once by the
   * iframe that loads it.
   *
   * Deliberately NOT verified before returning: checking a token spends it, so
   * a "verified" URL would arrive already used. See
   * docs/handover/2026-09-08-scorecard-404-fix.md. */
  fetchScoreUrl: async (req, res) => {
    const { gmid, etid } = req.query;
    if (!gmid || !etid) {
      return res.status(400).json({
        success: false,
        error: "gmid and etid are required to fetch the score url"
      });
    }
    try {
      // Cricket: the scoreboard embed or nothing — the page falls back to its socket card.
      const url = String(etid) === "4" ? await ScoreAnimationService_default.getCricketEmbedUrl(gmid) : await ScoreAnimationService_default.getScoreUrl(etid, gmid);
      if (!url) {
        return res.status(502).json({
          success: false,
          error: "Scorecard host did not return an animation url"
        });
      }
      res.set("Cache-Control", "no-store");
      return res.status(200).json({ success: true, data: { url } });
    } catch (error) {
      console.error("\u274C ScoreUrl Error:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  },
  fetchScoreCard: async (req, res) => {
    const { gmid, sid } = req.body;
    console.log("====>>>>scorecard_logs: " + gmid + " sid: " + sid);
    if (!gmid) {
      return res.status(400).json({
        success: false,
        error: "Game ID is required to fetch score card"
      });
    }
    if (!sid) {
      return res.status(400).json({
        success: false,
        error: "Sid is required to fetch score card"
      });
    }
    try {
      console.log(`[ScoreCard] Fetching scorecard for gmid=${gmid} sid=${sid}`);
      const scoreCard = await CricketService_default.fetchScoreCard(gmid, sid);
      console.log("\u2705 Score Card:", scoreCard);
      return res.status(200).json({
        success: true,
        data: scoreCard
      });
    } catch (primaryError) {
      console.warn("\u26A0\uFE0F Primary scorecard failed, trying gtv fallback:", primaryError.message);
      try {
        const matchRes = await CricketService_default.getSportDataById(gmid, sid);
        const match = matchRes?.data?.[0];
        const gtv = match?.gtv;
        if (!gtv) {
          return res.status(200).json({
            success: false,
            error: "Scorecard not available: gtv cannot be fetched"
          });
        }
        const scoreCard = await CricketService_default.fetchScoreCard(gtv, sid);
        console.log("\u2705 Score Card (gtv fallback):", scoreCard);
        return res.status(200).json({ success: true, data: scoreCard });
      } catch (fallbackError) {
        console.error("\u274C ScoreCard Error (all sources failed):", fallbackError.message);
        return res.status(500).json({
          success: false,
          error: fallbackError.message
        });
      }
    }
  },
  /* The sidebar's tree, ORDERED — see services/SportsEventsService.js for why
     the order is decided here and not left to the feed (which reshuffles) or
     to a hardcoded list of competition names in each client. Same nodes as
     fetchTreeData below, returned as one `sports` array already in order. */
  fetchSportsEvents: async (req, res) => {
    try {
      const data = await SportsEventsService_default.buildEvents();
      return res.status(200).json({ success: true, data });
    } catch (error) {
      console.error("\u274C Error building sports events:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  },
  fetchTreeData: async (req, res) => {
    try {
      const treeData = await CricketService_default.fetchTreeData();
      console.log("\u2705 Tree Data:", treeData);
      return res.status(200).json({
        success: true,
        data: treeData
      });
    } catch (error) {
      console.error("\u274C Error:", error.message);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },
  GetResults: async (req, res) => {
    const { event_id, event_name, market_id, market_name, sid } = req.body;
    if (!event_id || !event_name || !market_id || !market_name || !sid) {
      return res.status(400).json({
        success: false,
        error: "Event ID, Event Name, Market ID, Market Name, Market Type and SID are required to get results"
      });
    }
    try {
      const resultsData = await CricketService_default.GetResult(sid, event_id, event_name, market_id, market_name);
      console.log("\u2705 Results Data:", resultsData);
      return res.status(200).json({
        success: true,
        data: resultsData
      });
    } catch (error) {
      console.error("\u274C Error:", error.message);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },
  getAllSportsBets: async (req, res) => {
    try {
      const bets = await CricketService_default.getAllSportsBets();
      return res.status(200).json({ success: true, data: bets });
    } catch (error) {
      console.error("\u274C Error:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  },
  // used by user to get his own bets
  getSportsBetsByUserId: async (req, res) => {
    const user_id = req.user?.account?.id || req.user?.id;
    if (!user_id) {
      return res.status(401).json({ success: false, error: "Unauthorized: user_id missing" });
    }
    try {
      const { page, limit, search, betType, status } = req.query;
      const result = await CricketService_default.getSportsBetsByUserId(user_id, { page, limit, search, betType, status });
      return res.status(200).json({ success: true, data: result.rows, pagination: result.pagination });
    } catch (error) {
      console.error("\u274C Error:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  },
  // used by admin to get particular user's bets
  getSportsBetsOfUser: async (req, res) => {
    const role = req.user?.role;
    if (role === "User") {
      return res.status(401).json({ success: false, error: "Unauthorized: user not allowed" });
    }
    const user_id = req.body.user_id;
    if (!user_id) {
      return res.status(400).json({ success: false, error: "User ID is required" });
    }
    try {
      const bets = await CricketService_default.getSportsBetsByUserId(user_id, { status: "all" });
      return res.status(200).json({ success: true, data: bets });
    } catch (error) {
      console.error("\u274C Error:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  },
  getWinsByUserId: async (req, res) => {
    const user_id = req.user?.id;
    if (!user_id) {
      return res.status(401).json({ success: false, error: "Unauthorized: user_id missing" });
    }
    try {
      const wins = await CricketService_default.getWinsByUserId(user_id);
      return res.status(200).json({ success: true, data: wins });
    } catch (error) {
      console.error("\u274C Error:", error.message);
      return res.status(500).json({ success: false, error: error.message });
    }
  },
  getTotalStakeOnEvent: async (req, res) => {
    try {
      const totals = await SportsBet_default.findAll({
        attributes: [
          "eventid",
          [SportsBet_default.sequelize.fn("SUM", SportsBet_default.sequelize.col("stake_amount")), "total_stake"],
          [SportsBet_default.sequelize.fn("COUNT", SportsBet_default.sequelize.col("id")), "bets_count"]
        ],
        where: {
          // optional: ignore cancelled / voided bets
          // status: { [Op.notIn]: ['void', 'cancelled'] },
          eventid: { [Op4.ne]: null }
          // skip rows without eventid
        },
        group: ["eventid"],
        order: [[SportsBet_default.sequelize.literal("total_stake"), "DESC"]],
        raw: true
        // return plain objects (no Sequelize instances)
      });
      const result = totals.map((row) => ({
        eventid: row.eventid,
        total_stake: parseFloat(row.total_stake).toFixed(2),
        // e.g. "12345.00"
        bets_count: Number(row.bets_count)
      }));
      return res.status(200).json({
        success: true,
        data: result,
        meta: {
          total_events: result.length,
          generated_at: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
    } catch (error) {
      console.error("Error in getTotalStakeOnEvent:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error"
      });
    }
  },
  getTotalStakeOnLiveAndUpcomingEvents: async (req, res) => {
    try {
      const totals = await SportsBet_default.findAll({
        attributes: [
          "eventid",
          [SportsBet_default.sequelize.fn("SUM", SportsBet_default.sequelize.col("stake_amount")), "total_stake"],
          [SportsBet_default.sequelize.fn("COUNT", SportsBet_default.sequelize.col("id")), "bets_count"]
        ],
        where: {
          eventid: { [Op4.ne]: null },
          result_status: "pending"
          // Only live or upcoming matches
          // Optional: exclude void/cancelled bets
          // status: { [Op.notIn]: ['void', 'cancelled', 'deleted'] },
        },
        group: ["eventid"],
        order: [[SportsBet_default.sequelize.literal("total_stake"), "DESC"]],
        raw: true
      });
      const result = totals.map((row) => ({
        eventid: row.eventid,
        total_stake: parseFloat(row.total_stake).toFixed(2),
        bets_count: Number(row.bets_count)
      }));
      return res.status(200).json({
        success: true,
        data: result,
        meta: {
          total_events: result.length,
          filter: "live_and_upcoming_only",
          generated_at: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
    } catch (error) {
      console.error("Error in getTotalStakeOnLiveAndUpcomingEvents:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error"
      });
    }
  },
  // 1. Get ALL matched bets for an event for admin only
  getMatchedBetsByEvent: async (req, res) => {
    try {
      const { eventid } = req.query;
      if (!eventid) {
        return res.status(400).json({
          success: false,
          error: "eventid is required"
        });
      }
      const page = parseInt(req.query.page) || 1;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const offset = (page - 1) * limit;
      const { count, rows } = await SportsBet_default.findAndCountAll({
        where: {
          eventid: eventid.toString()
        },
        include: [{
          model: User_default,
          as: "user",
          attributes: ["username"],
          required: false
        }],
        attributes: { exclude: ["job_id", "ip_address"] },
        order: [["created_at", "DESC"]],
        limit,
        offset,
        raw: false
      });
      const bets = rows.map((bet) => {
        const betPlain = bet.get({ plain: true });
        return {
          ...betPlain,
          stake_amount: parseFloat(betPlain.stake_amount).toFixed(2),
          odds: parseFloat(betPlain.odds).toFixed(4),
          liability: betPlain.liability ? parseFloat(betPlain.liability).toFixed(2) : null,
          usd_amount: betPlain.usd_amount ? parseFloat(betPlain.usd_amount).toFixed(2) : null
        };
      });
      return res.status(200).json({
        success: true,
        data: bets,
        pagination: {
          total: count,
          page,
          limit,
          total_pages: Math.ceil(count / limit)
        },
        meta: {
          eventid,
          filter: "matched_bets",
          generated_at: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
    } catch (error) {
      console.error("Error in getMatchedBetsByEvent:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error"
      });
    }
  },
  // 2. Get only OPEN (pending result) bets for an event
  getOpenBetsByEvent: async (req, res) => {
    try {
      const { eventid } = req.query;
      if (!eventid) {
        return res.status(400).json({
          success: false,
          error: "eventid is required"
        });
      }
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const offset = (page - 1) * limit;
      const { count, rows } = await SportsBet_default.findAndCountAll({
        where: {
          eventid: eventid.toString(),
          result_status: "pending"
          // Only unsettled bets
          // status: { [Op.notIn]: ['void', 'cancelled', 'deleted'] },
          // eventid: { [Op.ne]: null },
        },
        attributes: { exclude: ["job_id", "ip_address"] },
        order: [["created_at", "DESC"]],
        limit,
        offset,
        raw: true
      });
      const bets = rows.map((bet) => ({
        ...bet,
        stake_amount: parseFloat(bet.stake_amount).toFixed(2),
        odds: parseFloat(bet.odds).toFixed(4),
        liability: bet.liability ? parseFloat(bet.liability).toFixed(2) : null,
        usd_amount: bet.usd_amount ? parseFloat(bet.usd_amount).toFixed(2) : null
      }));
      return res.status(200).json({
        success: true,
        data: bets,
        pagination: {
          total: count,
          page,
          limit,
          total_pages: Math.ceil(count / limit)
        },
        meta: {
          eventid,
          filter: "open_bets_only",
          generated_at: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
    } catch (error) {
      console.error("Error in getOpenBetsByEvent:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error"
      });
    }
  },
  /**
   * 1. Get ALL matched bets of a USER on a specific event
   */
  getUserMatchedBetsByEvent: async (req, res) => {
    try {
      const { eventid, user_id } = req.query;
      if (!eventid || !user_id) {
        return res.status(400).json({
          success: false,
          error: "Both eventid and user_id are required"
        });
      }
      const page = safeInt(req.query.page) || 1;
      const limit = safeInt(req.query.limit) || 50;
      const offset = (page - 1) * limit;
      const { count, rows } = await SportsBet_default.findAndCountAll({
        where: {
          eventid: eventid.toString(),
          user_id: user_id.toString(),
          status: { [Op4.notIn]: ["void", "cancelled", "deleted"] },
          eventid: { [Op4.ne]: null }
        },
        attributes: { exclude: ["job_id", "ip_address"] },
        // hide sensitive
        order: [["created_at", "DESC"]],
        limit,
        offset,
        raw: true
      });
      const bets = rows.map((bet) => ({
        ...bet,
        stake_amount: parseFloat(bet.stake_amount).toFixed(2),
        odds: parseFloat(bet.odds).toFixed(4),
        liability: bet.liability ? parseFloat(bet.liability).toFixed(2) : null,
        usd_amount: bet.usd_amount ? parseFloat(bet.usd_amount).toFixed(2) : null
      }));
      return res.status(200).json({
        success: true,
        data: bets,
        pagination: {
          total: count,
          page,
          limit,
          total_pages: Math.ceil(count / limit)
        },
        meta: {
          eventid,
          user_id,
          filter: "user_matched_bets",
          generated_at: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
    } catch (error) {
      console.error("Error in getUserMatchedBetsByEvent:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error"
      });
    }
  },
  /**
   * 2. Get only OPEN (pending result) bets of a USER on a specific event
   */
  getUserOpenBetsByEvent: async (req, res) => {
    try {
      const { eventid, user_id } = req.query;
      if (!eventid || !user_id) {
        return res.status(400).json({
          success: false,
          error: "Both eventid and user_id are required"
        });
      }
      const page = safeInt(req.query.page) || 1;
      const limit = safeInt(req.query.limit) || 50;
      const offset = (page - 1) * limit;
      const { count, rows } = await SportsBet_default.findAndCountAll({
        where: {
          eventid: eventid.toString(),
          user_id: user_id.toString(),
          result_status: "pending",
          // Only unsettled
          status: { [Op4.notIn]: ["void", "cancelled", "deleted"] },
          eventid: { [Op4.ne]: null }
        },
        attributes: { exclude: ["job_id", "ip_address"] },
        order: [["created_at", "DESC"]],
        limit,
        offset,
        raw: true
      });
      const bets = rows.map((bet) => ({
        ...bet,
        stake_amount: parseFloat(bet.stake_amount).toFixed(2),
        odds: parseFloat(bet.odds).toFixed(4),
        liability: bet.liability ? parseFloat(bet.liability).toFixed(2) : null,
        usd_amount: bet.usd_amount ? parseFloat(bet.usd_amount).toFixed(2) : null
      }));
      return res.status(200).json({
        success: true,
        data: bets,
        pagination: {
          total: count,
          page,
          limit,
          total_pages: Math.ceil(count / limit)
        },
        meta: {
          eventid,
          user_id,
          filter: "user_open_bets_only",
          generated_at: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
    } catch (error) {
      console.error("Error in getUserOpenBetsByEvent:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error"
      });
    }
  },
  /**
   * 3. Get ONLY OPEN bets for a specific event and user (Fresh Implementation)
   */
  getUserOpenBetsForEvent: async (req, res) => {
    try {
      const { eventid, user_id } = req.query;
      console.log("getUserOpenBetsForEvent called with:", { eventid, user_id });
      if (!eventid || !user_id) {
        return res.status(400).json({
          success: false,
          error: "Both eventid and user_id are required"
        });
      }
      const bets = await SportsBet_default.findAll({
        where: {
          eventid: eventid.toString(),
          user_id: user_id.toString(),
          status: { [Op4.in]: ["open", "manual", "matched"] },
          // Matched list only — unmatched bets come from the grouped endpoint
          [Op4.or]: [{ unmatched: false }, { unmatched: null }]
        },
        attributes: { exclude: ["job_id", "ip_address"] },
        order: [["created_at", "DESC"]],
        raw: true
      });
      const formattedBets = bets.map((bet) => ({
        ...bet,
        stake_amount: parseFloat(bet.stake_amount).toFixed(2),
        odds: parseFloat(bet.odds).toFixed(4),
        liability: bet.liability ? parseFloat(bet.liability).toFixed(2) : null,
        usd_amount: bet.usd_amount ? parseFloat(bet.usd_amount).toFixed(2) : null,
        // Badlo legs are EXACT-RUN swaps, not back/lay — the bet list must not
        // paint them with the blue/pink side colours. Stated explicitly rather
        // than relying on the spread above, because this is a contract the
        // frontend reads. See server/helper/badloMarket.js.
        badlo: bet.badlo === true
      }));
      return res.status(200).json({
        success: true,
        data: formattedBets,
        meta: {
          eventid,
          user_id,
          filter: "fresh_open_bets_only",
          generated_at: (/* @__PURE__ */ new Date()).toISOString()
        }
      });
    } catch (error) {
      console.error("Error in getUserOpenBetsForEvent:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error"
      });
    }
  },
  /**
   * 4. Open bets split into matched / unmatched groups.
   * There is NO auto-matching engine — a bet placed with unmatched=true stays
   * unmatched until the user cancels it (POST /cancel-bet) or it settles.
   */
  getUserOpenBetsGrouped: async (req, res) => {
    try {
      const { eventid, user_id } = req.query;
      if (!eventid || !user_id) {
        return res.status(400).json({
          success: false,
          error: "Both eventid and user_id are required"
        });
      }
      const bets = await SportsBet_default.findAll({
        where: {
          eventid: eventid.toString(),
          user_id: user_id.toString(),
          status: { [Op4.in]: ["open", "manual", "matched"] }
        },
        attributes: { exclude: ["job_id", "ip_address"] },
        order: [["created_at", "DESC"]],
        raw: true
      });
      const format = (bet) => ({
        ...bet,
        stake_amount: parseFloat(bet.stake_amount).toFixed(2),
        odds: parseFloat(bet.odds).toFixed(4),
        liability: bet.liability ? parseFloat(bet.liability).toFixed(2) : null,
        usd_amount: bet.usd_amount ? parseFloat(bet.usd_amount).toFixed(2) : null,
        // Badlo legs are EXACT-RUN swaps, not back/lay — the bet list must not
        // paint them with the blue/pink side colours. Stated explicitly rather
        // than relying on the spread above, because this is a contract the
        // frontend reads. See server/helper/badloMarket.js.
        badlo: bet.badlo === true
      });
      return res.status(200).json({
        success: true,
        data: {
          matchedBets: bets.filter((b) => b.unmatched !== true).map(format),
          unmatchedBets: bets.filter((b) => b.unmatched === true).map(format)
        },
        meta: { eventid, user_id, generated_at: (/* @__PURE__ */ new Date()).toISOString() }
      });
    } catch (error) {
      console.error("Error in getUserOpenBetsGrouped:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error"
      });
    }
  },
  // Latest events from AVRKHUB sports feed (proxied)
  getLatestEvents: async (req, res) => {
    try {
      const result = await axios3.get(`${AVRKHUB_SPORTS_BASE_URL2}/get_latest_events`, {
        params: { key: AVRKHUB_SPORTS_KEY2 },
        timeout: 3e4
      });
      // Sports the site does not offer are left out (lib/constants/hiddenSports.mjs).
      const latest = result?.data?.data;
      const rows = Array.isArray(latest?.data) ? latest.data : null;
      return res.status(200).json({
        success: true,
        data: rows ? { ...latest, data: rows.filter((e) => !isHiddenSport(e?.sportId)) } : latest
      });
    } catch (error) {
      console.error("Error in getLatestEvents:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error"
      });
    }
  },
  // Single event detail from AVRKHUB sports feed (proxied) — gmid & etid required
  getGameDetailPrivate: async (req, res) => {
    const { gmid, etid } = req.query;
    if (isHiddenSport(etid)) {
      return res.status(404).json({ success: false, error: "This sport is not available" });
    }
    if (!gmid || !etid) {
      return res.status(400).json({
        success: false,
        error: "gmid and etid are required"
      });
    }
    try {
      return res.status(200).json({
        success: true,
        data: await CricketService_default.GetGameDetailPrivate(gmid, etid)
      });
    } catch (error) {
      console.error("Error in getGameDetailPrivate:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error"
      });
    }
  }
};
var cricketController_default = CricketController;

export { cricketController_default, matchPrivateDataReply, sportBoardReply };
