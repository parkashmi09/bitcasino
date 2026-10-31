// sportsbet/sportbetscontroller.js — mssports core, moved unchanged
import { db_default, init_db } from "../../../lib/config/db.mjs";
import { createRequire } from "node:module";
import { isHiddenSport, isHiddenLeague } from "../../../lib/constants/hiddenSports.mjs";
import { TotalExposure_default, init_TotalExposure } from "../../../models/user/TotalExposure.mjs";
import { User_default } from "../../../models/user/User.mjs";
import { Staff_default } from "../../../models/admin/Staff.mjs";
import { BetLock_default } from "../../../models/admin/BetLock.mjs";
// Wallets → credits: the player's sports balance is the platform wallet, credits.inr.
// import { Wallet_default } from "../../../models/admin/Wallet.mjs";
import { Credits_default } from "../../../models/user/Credits.mjs";
import { SportsBet_default } from "../../../models/user/SportsBet.mjs";
import { BettingConfigService_default } from "../../../lib/services/BettingConfigService.mjs";
import { CricketService_default } from "../../../lib/services/CricketService.mjs";
import { MESSAGES } from "../../../lib/constants/messages.mjs";
import { UserExposure_default } from "../../../models/user/UserExposure.mjs";
import { METER_MAX_RUNS, isMeterMarket, meterPnl, meterLiability } from "../../../lib/helper/meterMarket.mjs";
import { isLineMarket, linePnl, exposureIdentity } from "../../../lib/helper/lineMarket.mjs";
import { isBadloBet, isBadloLeg, badloSlipError, badloPnl, badloLiability } from "../../../lib/helper/badloMarket.mjs";
import { PlatformGames_default } from "../../../models/admin/PlatformGames.mjs";
import { UserMatchLocks_default } from "../../../models/admin/UserMatchLocks.mjs";
import { UserEventMarketLocks_default } from "../../../models/admin/UserEventMarketLocks.mjs";
import { BetLockService_default } from "../services/BetLockService.mjs";
import { DebitLedger_default } from "../../../models/user/DebitLedger.mjs";
import { SportsLockController_default } from "../../sports-config/controllers/SportsLockController.mjs";
import { OWNER_UPLINE_NO, uplineNo } from "../../../lib/helper/uplineLevelNo.mjs";
import { isCricketTestFormat } from "../../../lib/helper/cricketFormat.mjs";
import { leagueNameForBet } from "../../../lib/services/SportsLeagueResolver.mjs";
import { TOTAL_EXPOSURE_SQL } from "../../../lib/helper/totalExposure.mjs";
import { pushBalance } from "../../../lib/helper/pushBalance.mjs";
import { checkBetLive } from "../buffer/betBuffer.mjs";
import { StaffMarketLocks_default } from "../../../models/admin/StaffMarketLocks.mjs";
const { directLedgerContext } = createRequire(import.meta.url)("@ibitplay/common");

import xssClean from "xss-clean";
import { toInr, inrToUsd } from "../../../lib/helper/toInr.mjs";
import { feedMaxStake } from "../../../lib/helper/feedStakeLimit.mjs";
init_TotalExposure();
init_db();
import axios5 from "axios";
import { Op as Op6, Sequelize as Sequelize2 } from "sequelize";
var sportsDataSet = [
  { sid: 4, ename: "Cricket" },
  { sid: 1, ename: "Football" },
  { sid: 2, ename: "Tennis" },
  { sid: 8, ename: "Table Tennis" },
  { sid: 68, ename: "Esoccer" },
  { sid: 10, ename: "Horse Racing" },
  { sid: 65, ename: "Greyhound Racing" },
  { sid: 15, ename: "Basketball" },
  { sid: 69, ename: "Wrestling" },
  { sid: 18, ename: "Volleyball" },
  { sid: 22, ename: "Badminton" },
  { sid: 59, ename: "Snooker" },
  { sid: 57, ename: "Darts" },
  { sid: 6, ename: "Boxing" },
  { sid: 3, ename: "Mixed Martial Arts" },
  { sid: 58, ename: "American Football" },
  { sid: 11, ename: "E Games" },
  { sid: 19, ename: "Ice Hockey" },
  { sid: 9, ename: "Futsal" },
  { sid: 40, ename: "Politics" },
  { sid: 67, ename: "Boat Racing" },
  { sid: 52, ename: "Motor Sports" },
  { sid: 12, ename: "Greyhounds" },
  { sid: 66, ename: "Kabaddi" },
  { sid: 5, ename: "Golf" },
  { sid: 55, ename: "Rugby League" },
  { sid: 7, ename: "Beach Volleyball" },
  { sid: 13, ename: "Trotting" },
  { sid: 39, ename: "Handball" },
  { sid: 14, ename: "Speedway" },
  { sid: 16, ename: "MotoGP" },
  { sid: 17, ename: "Chess" },
  { sid: 20, ename: "Equine Sports" },
  { sid: 21, ename: "Australian Rules" },
  { sid: 23, ename: "Formula 1" },
  { sid: 24, ename: "Nascar" },
  { sid: 25, ename: "Hockey" },
  { sid: 26, ename: "Supercars" },
  { sid: 27, ename: "Netball" },
  { sid: 28, ename: "Surfing" },
  { sid: 29, ename: "Cycling" },
  { sid: 30, ename: "Gaelic Sports" },
  { sid: 31, ename: "Biathlon" },
  { sid: 32, ename: "Motorbikes" },
  { sid: 33, ename: "Athletics" },
  { sid: 34, ename: "Squash" },
  { sid: 35, ename: "Basketball 3X3" },
  { sid: 36, ename: "Floorball" },
  { sid: 37, ename: "Sumo" },
  { sid: 38, ename: "Virtual sports" },
  { sid: 41, ename: "Weather" }
];
var sportsMap = sportsDataSet.reduce((acc, item) => {
  acc[item.sid] = item.ename;
  return acc;
}, {});
function normalizeOdds(odds) {
  if (odds > 100) return Math.floor((odds / 100 + 1) * 100) / 100;
  if (odds < 100) return Math.floor((1 + odds / 100) * 100) / 100;
  return 2;
}
function calculateRunnerExposure({
  runners,
  selectedRunner,
  stake,
  odd,
  betType,
  oldExposures = {}
}) {
  let newExposures = { ...oldExposures };
  const profit = Math.round(stake * (odd - 1) * 100) / 100;
  const liability = Math.round(stake * (odd - 1) * 100) / 100;
  const isBack = betType === "back" || betType === "yes";
  for (const runner of runners) {
    const prev = oldExposures[runner] || 0;
    if (runner === selectedRunner) {
      newExposures[runner] = Math.round((isBack ? prev + profit : prev - liability) * 100) / 100;
    } else {
      newExposures[runner] = Math.round((isBack ? prev - stake : prev + stake) * 100) / 100;
    }
  }
  return newExposures;
}
async function resolveMarketLimits({ eventid, sid, match_id, mname, market_type, selection_name }) {
  const override = await BettingConfigService_default.getMarketLimits(eventid, match_id).catch(() => ({}));
  const pd = await CricketService_default.GetMatchPrivateData(eventid, sid);
  const markets = Array.isArray(pd?.data) ? pd.data : [];
  if (!markets.length) {
    if (override?.min > 0 || override?.max > 0) {
      return {
        minLimit: Number(override.min) || 0,
        maxLimit: Number(override.max) || 0,
        marketName: mname || market_type || ""
      };
    }
    return null;
  }
  const mkt = markets.find((m) => String(m.mid) === String(match_id)) || markets.find((m) => (m.mname || "") === (mname || market_type));
  if (!mkt) {
    if (override?.min > 0 || override?.max > 0) {
      return {
        minLimit: Number(override.min) || 0,
        maxLimit: Number(override.max) || 0,
        marketName: mname || market_type || ""
      };
    }
    return null;
  }
  const selNorm = (selection_name || "").toString().trim().toLowerCase();
  const sec = (mkt.section || []).find((s) => (s.nat || "").trim().toLowerCase() === selNorm) || null;
  const maxLimit = feedMaxStake(mkt) || Number(sec?.max) || 0;
  const minLimit = Number(sec?.min) > 0 ? Number(sec.min) : Number(mkt.min) || 0;
  return {
    minLimit: Number(override?.min) > 0 ? Number(override.min) : minLimit,
    maxLimit: Number(override?.max) > 0 ? Number(override.max) : maxLimit,
    marketName: mkt.mname
  };
}
var RACE_BET_WINDOW_MINUTES = Number(process.env.RACE_BET_WINDOW_MINUTES) || 5;
var IST_OFFSET_MS = 5.5 * 60 * 60 * 1e3;
function parseFeedIstTime(stime) {
  if (!stime || typeof stime !== "string") return null;
  const m = stime.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) {
    const d = new Date(stime);
    return Number.isNaN(d.getTime()) ? null : d.getTime();
  }
  const [, mo, day, yr, hh, mi, ss, ap] = m;
  let h = Number(hh);
  if (ap) {
    const up = ap.toUpperCase();
    if (up === "PM" && h !== 12) h += 12;
    if (up === "AM" && h === 12) h = 0;
  }
  return Date.UTC(Number(yr), Number(mo) - 1, Number(day), h, Number(mi), Number(ss || 0)) - IST_OFFSET_MS;
}
function findRaceNode(nodes, eventid) {
  for (const n of nodes || []) {
    if (n && String(n.gmid) === String(eventid) && n.stime) return n;
    const hit = findRaceNode(Array.isArray(n?.children) ? n.children : null, eventid);
    if (hit) return hit;
  }
  return null;
}
async function resolveRaceStartMs(eventid, sid) {
  const board = await CricketService_default.fetchCricketData(sid);
  const t1 = Array.isArray(board?.data?.t1) ? board.data.t1 : [];
  const t2 = Array.isArray(board?.data?.t2) ? board.data.t2 : [];
  const race = findRaceNode([...t1, ...t2], eventid);
  if (!race?.stime) return null;
  return parseFeedIstTime(race.stime);
}
var getMarketNameFromGtype = ({ mname, gtype, nat, section }) => {
  console.log("market name from gtype", { mname, gtype, nat, section });
  if (!mname || !gtype) return null;
  if (gtype === "match" || gtype === "match1") {
    let sections = [];
    if (Array.isArray(section)) {
      sections = section;
    } else if (typeof section === "string") {
      try {
        sections = JSON.parse(section);
      } catch (e) {
        sections = [];
      }
    }
    const runnerNames = sections.map((s) => s?.nat?.trim()).filter(Boolean);
    if (runnerNames.length === 0) return null;
    const marketName = runnerNames.length > 1 ? runnerNames.join(" vs ") : runnerNames[0];
    return {
      mname,
      gtype,
      marketName
    };
  }
  if (!nat || typeof nat !== "string") return null;
  return {
    mname,
    gtype,
    marketName: nat.trim()
  };
};
var checkUserBetLock = async (user_id, game_type, event_id = null, transaction = null, market_id = null) => {
  try {
    console.log("[BetLock] checkUserBetLock CALLED:", { user_id, game_type, event_id, market_id });
    if (!user_id || !game_type) {
      return {
        allowed: false,
        message: "Missing required parameters: user_id or game_type."
      };
    }
    const betLock = await BetLock_default.findOne({ where: { user_id }, transaction });
    if (betLock) {
      if (game_type.trim().toUpperCase() === "MO") {
        if (betLock.MatchOdds === true) {
          return {
            allowed: false,
            message: "Bet not allowed, contact admin (MatchOdds locked)."
          };
        }
      } else {
        if (betLock.OtherMarkets === true) {
          return {
            allowed: false,
            message: "Bet not allowed, contact admin (OtherMarkets locked)."
          };
        }
      }
    }
    if (event_id) {
      const matchLock = await UserMatchLocks_default.findOne({
        where: { user_id, event_id: String(event_id), is_locked: true },
        transaction
      });
      if (matchLock) {
        return {
          allowed: false,
          message: "Bet not allowed, this match is locked for you."
        };
      }
    }
    if (event_id) {
      let marketCondition;
      if (market_id) {
        marketCondition = { market_id: String(market_id) };
      } else {
        const marketNames = [];
        const gt = game_type.trim().toUpperCase();
        if (gt === "MO" || gt === "MATCH" || gt === "MATCH_ODDS" || gt === "MATCH1") {
          marketNames.push("MATCH_ODDS", "Match_Odds", "match_odds", "MATCH", "match", "match1");
        } else if (gt === "BM" || gt === "BOOKMAKER" || gt === "BOOKMAKER2") {
          marketNames.push("bookmaker", "Bookmaker", "BOOKMAKER", "bookmaker2", "BM");
        } else if (gt === "FAN" || gt === "FANCY" || gt === "FANCY1" || gt === "NORMAL") {
          marketNames.push("fancy1", "Fancy", "FANCY", "Normal", "normal", "FAN");
        } else {
          marketNames.push(game_type.trim());
        }
        marketCondition = { market_name: { [Op6.in]: marketNames } };
      }
      console.log("[BetLock] Checking market lock for user:", { user_id, event_id, market_id, game_type, marketCondition });
      const userMarketLock = await UserEventMarketLocks_default.findOne({
        where: {
          account_id: user_id,
          account_type: "user",
          event_id: String(event_id),
          ...marketCondition,
          is_locked: true
        },
        transaction
      });
      console.log("[BetLock] User market lock result:", userMarketLock ? userMarketLock.toJSON() : "NOT FOUND");
      const user = await User_default.findOne({ where: { user_id }, attributes: ["parent_staff_id"], transaction });
      if (userMarketLock) {
        const parent = user?.parent_staff_id ? await Staff_default.findOne({ where: { staff_id: user.parent_staff_id }, attributes: ["level"], transaction }) : null;
        return {
          allowed: false,
          message: MESSAGES.BET.GAME_LOCKED_CONTACT_UPLINE(parent ? uplineNo(parent.level) : OWNER_UPLINE_NO)
        };
      }
      if (user?.parent_staff_id) {
        let staffId = user.parent_staff_id;
        const visited = /* @__PURE__ */ new Set();
        while (staffId && !visited.has(staffId)) {
          visited.add(staffId);
          const staffLock = await UserEventMarketLocks_default.findOne({
            where: {
              account_id: staffId,
              account_type: "staff",
              event_id: String(event_id),
              ...marketCondition,
              is_locked: true
            },
            transaction
          });
          const staff = await Staff_default.findOne({ where: { staff_id: staffId }, attributes: ["parent_id", "level"], transaction });
          if (staffLock) {
            return {
              allowed: false,
              message: MESSAGES.BET.GAME_LOCKED_CONTACT_UPLINE(uplineNo(staff?.level))
            };
          }
          staffId = staff?.parent_id || null;
        }
      }
    }
    return { allowed: true };
  } catch (error) {
    console.error("Error checking user bet lock:", error);
    return {
      allowed: false,
      message: "Internal server error while checking bet lock."
    };
  }
};
var getAllAncestorStaffIds = async (userId, transaction = null) => {
  let ancestors = [];
  let currentUser = await User_default.findOne({ where: { user_id: userId }, attributes: ["parent_staff_id"], transaction });
  if (!currentUser || !currentUser.parent_staff_id) return [];
  let currentStaffId = currentUser.parent_staff_id;
  while (currentStaffId) {
    ancestors.push(currentStaffId);
    const staff = await Staff_default.findOne({ where: { staff_id: currentStaffId }, attributes: ["parent_id"], transaction });
    if (!staff || !staff.parent_id) break;
    currentStaffId = staff.parent_id;
  }
  return ancestors;
};
var LINE_MARKET_DEFAULT_MIN_STAKE = Number(process.env.LINE_MARKET_MIN_STAKE) || 100;
var LINE_MARKET_DEFAULT_MAX_STAKE = Number(process.env.LINE_MARKET_MAX_STAKE) || 1e5;
var checkPlatformBetLock = async (sportsId, game_type, user_id, transaction = null) => {
  console.log("check platform betlock ===> for ", { sportsId, game_type, user_id });
  try {
    if (!sportsId || !game_type || !user_id) {
      return {
        allowed: false,
        message: "Missing required parameters: sportsId, game_type or user_id."
      };
    }
    const ancestors = await getAllAncestorStaffIds(user_id, transaction);
    const staffIdsToCheck = [null, ...ancestors];
    let key = game_type.trim();
    if (key == "MO") {
      key = "Match_Odds";
    }
    const locks = await StaffMarketLocks_default.findAll({
      where: {
        game_id: sportsId,
        staff_id: { [Op6.or]: staffIdsToCheck },
        market_name: { [Op6.or]: [key, "ALL"] },
        is_locked: true
      },
      transaction
    });
    if (locks.length > 0) {
      const lock = locks[0];
      const lockType = lock.market_name === "ALL" ? "ALL markets" : `${key} market`;
      const locker = lock.staff_id ? `upline staff` : `Owner`;
      return {
        allowed: false,
        message: `Bet not allowed, ${lockType} is locked by ${locker}.`
      };
    }
    return { allowed: true };
  } catch (err) {
    console.error("Error checking platform bet lock:", err);
    return {
      allowed: false,
      message: "Internal server error while checking platform lock."
    };
  }
};
var walletUpdate = async (wallet, balanceChange, transaction, context = {}) => {
  const {
    user_id,
    match_title,
    selection_name,
    market_type,
    game_type,
    match_id,
    eventid,
    sid,
    newBet
  } = context;
  if (isNaN(balanceChange)) {
    console.error(`[walletUpdate] \u274C Critical: balanceChange is NaN for user ${user_id}. Context:`, context);
    return;
  }
  // OLD (Wallets.cash):
  /*
  let currentCash = Number(wallet.cash || 0);
  if (balanceChange < 0) {
    const amountToAdd = Math.abs(balanceChange);
    wallet.cash = currentCash + amountToAdd;
    await wallet.save({ transaction });
  } else if (balanceChange > 0) {
    const amountToDeduct = balanceChange;
    if (currentCash >= amountToDeduct) {
      wallet.cash = currentCash - amountToDeduct;
    }
    if (isNaN(wallet.cash)) {
      console.error(`[walletUpdate] \u274C Resulting balance is NaN! Reverting. Curr: ${currentCash}, Ded: ${amountToDeduct}`);
      throw new Error("Balance calculation resulted in NaN");
    }
    await wallet.save({ transaction });
  }
  const newBalance = Number(wallet.cash || 0);
  */
  // NEW (credits.inr): `wallet` is the player's credits row, locked by the caller.
  let currentCash = Number(wallet.inr || 0);
  // Names the move in a direct player's ledger (point_ledger_direct, read by /sports/statement),
  // which otherwise reads BALANCE_CHANGE. Called only right before the inr actually changes.
  const label = (eventType) => directLedgerContext(db_default, transaction, {
    userId: user_id, eventType, source: "sports-service", betId: newBet?.id, sportId: sid, gameType: game_type,
    remark: [match_title, selection_name].filter(Boolean).join(" ")
  });
  if (balanceChange < 0) {
    const amountToAdd = Math.abs(balanceChange);
    wallet.inr = currentCash + amountToAdd;
    await label("BET_RELEASED");
    await wallet.save({ transaction });
  } else if (balanceChange > 0) {
    const amountToDeduct = balanceChange;
    if (currentCash >= amountToDeduct) {
      wallet.inr = currentCash - amountToDeduct;
      await label("BET_PLACED");
    }
    if (isNaN(wallet.inr)) {
      console.error(`[walletUpdate] \u274C Resulting balance is NaN! Reverting. Curr: ${currentCash}, Ded: ${amountToDeduct}`);
      throw new Error("Balance calculation resulted in NaN");
    }
    await wallet.save({ transaction });
  }
  const newBalance = Number(wallet.inr || 0);
  if (balanceChange > 0) {
    await DebitLedger_default.create({
      user_id,
      amount: balanceChange,
      currency: "INR",
      reason: "bet_placed",
      description: `${match_title} ${selection_name}`,
      balance: newBalance,
      market_type: market_type || game_type,
      match_id,
      event_id: eventid,
      sport_id: sid,
      meta: { bet_id: newBet?.id }
    }, { transaction });
  }
  const placedAmount = balanceChange > 0 ? -balanceChange : 0;
  if (balanceChange < 0) {
    const releaseAmount = Math.abs(balanceChange);
  }
  console.log(`[walletUpdate] Delta: ${balanceChange}, INR: ${wallet.inr}`);
};
var placeBet = async (req, res, opts) => {
  const options = opts && typeof opts === "object" && !Array.isArray(opts) ? opts : {};
  const externalTx = options.transaction || null;
  const skipMinStakeOpt = options.skipMinStake === true;
  const transaction = externalTx || await db_default.transaction();
  try {
    let isNonFancyMarket = function(market_type2) {
      if (fixedNonFancyMarkets.includes(market_type2)) {
        return true;
      }
      if (/^Game Winner\s+(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)$/.test(market_type2)) {
        return true;
      }
      if (/^Match Time Result\s+\d{2}:\d{2}$/.test(market_type2)) {
        return true;
      }
      if (/^\d+(?:st|nd|rd|th)\s+Set Race To\s+(?:[1-9]|1[0-5])\.0$/.test(market_type2)) {
        return true;
      }
      if (/^Under\/Over(?: 180s)?\s+\d+(\.\d)?$/.test(market_type2)) {
        return true;
      }
      if (/^Total Tie Break in the Match\s+\d+(\.\d)?$/.test(market_type2)) {
        return true;
      }
      if (/^Point Winner\s+(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)$/.test(market_type2)) {
        return true;
      }
      if (/^Game To Deuce\s+(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)$/.test(market_type2)) {
        return true;
      }
      if (/^Game To Deuce\s+(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)$/.test(market_type2)) {
        return true;
      }
      return false;
    }, isFancyMatch = function(gameType = "", matchList = []) {
      const normalized = gameType.toUpperCase();
      return matchList.some(
        (item) => item instanceof RegExp ? item.test(normalized) : normalized.includes(item.toUpperCase())
      );
    };
    const user_id = req.user.account.id;
    if (!user_id) {
      if (!externalTx) await transaction.rollback();
      return res.status(400).json({ success: false, error: "User ID is required" });
    }
    let {
      game_type,
      match_id,
      match_title,
      selection_name,
      bet_type,
      odds,
      stake_amount,
      team_one,
      team_two,
      category,
      original_currency,
      match_start_time,
      eventid,
      fancy_name,
      count,
      sid,
      market_type,
      // League/competition (feed cname) — display-only, see SportsBet.league_name
      league_name,
      // Badlo rides inside an ordinary session market and keeps its
      // market_type ('Normal'); this flag is what marks the bet.
      badlo,
      unmatched,
      unmatched_odds,
      is_cashout,
      size,
      runners,
      lay_size,
      back_size,
      runner_odds,
      mname,
      gtype,
      nat,
      section
    } = req.body;
    count = runners.length;
    console.log("PLACE BET PAYLOAD RECEIVED:", req.body);
    // `currency`; today's frontend still sends it as `original_currency` (INR).
    const currency = req.body.currency ?? original_currency;
    if (!currency || typeof currency !== "string") {
      if (!externalTx) await transaction.rollback();
      return res.status(400).json({ success: false, error: "currency is required" });
    }
    // An agent's player bets in INR only (user, 2026-10-18).
    if (currency.trim().toUpperCase() !== "INR") {
      const better = await User_default.findOne({ where: { user_id }, attributes: ["parent_staff_id"], transaction });
      if (better?.parent_staff_id) {
        if (!externalTx) await transaction.rollback();
        return res.status(400).json({ success: false, error: "Your account can only bet in INR" });
      }
    }
    // The stake as the player sent it, in their coin; from here on stake_amount is INR.
    const currency_amount = Number(stake_amount);
    stake_amount = await toInr(stake_amount, currency);
    const ip_address = req.headers["x-forwarded-for"]?.split(",")[0] || req.connection.remoteAddress || req.ip;
    console.log("IP ADDRESS:", ip_address);
    const browser = req.headers["user-agent"] || null;
    let effectiveLeagueName = null;
    try {
      effectiveLeagueName = await leagueNameForBet(sid, eventid, league_name);
    } catch (leagueErr) {
      console.warn("[PlaceBet] league resolve failed:", leagueErr.message);
      effectiveLeagueName = league_name ? String(league_name).slice(0, 255) : null;
    }
    // Not offered on this site (lib/constants/hiddenSports.mjs) — whatever the client sent.
    if (isHiddenSport(sid) || isHiddenLeague(null, effectiveLeagueName)) {
      if (!externalTx) await transaction.rollback();
      return res.status(400).json({ success: false, error: "This market is not available" });
    }
    const hierarchyAllowed = await BetLockService_default.isBettingAllowed(user_id, { transaction });
    if (!hierarchyAllowed) {
      if (!externalTx) await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: MESSAGES.BET.LOCKED_CONTACT_UPLINE
      });
    }
    let sportsId = null;
    if (sid) {
      const platformGame = await PlatformGames_default.findOne({ where: { sport_id: String(sid) }, transaction });
      if (platformGame) {
        sportsId = platformGame.id;
      }
    }
    const lockStatus = await checkUserBetLock(user_id, game_type, eventid, transaction, match_id);
    if (!lockStatus.allowed) {
      if (!externalTx) await transaction.rollback();
      return res.status(403).json({
        success: false,
        message: lockStatus.message
      });
    }
    if (!sportsId) {
      console.warn(`Could not resolve PlatformGame for sid: ${sid}`);
    }
    if (sportsId) {
      const platformlockStatus = await checkPlatformBetLock(sportsId, game_type, user_id, transaction);
      if (!platformlockStatus.allowed) {
        if (!externalTx) await transaction.rollback();
        return res.status(403).json({
          success: false,
          message: platformlockStatus.message
        });
      }
    }
    if (sid) {
      const sportsLockStatus = await SportsLockController_default.checkSportsLock(
        user_id,
        sid,
        // sport_id
        null,
        // series_id (not available in bet payload, checked at sport/match/market level)
        eventid,
        // match_id (event_id is the match identifier)
        match_id,
        // market_id
        { transaction }
        // same connection as the bet (no second pool slot)
      );
      if (!sportsLockStatus.allowed) {
        if (!externalTx) await transaction.rollback();
        return res.status(403).json({
          success: false,
          message: sportsLockStatus.message
        });
      }
    }
    const placedata = getMarketNameFromGtype({ mname, gtype, nat, section });
    console.log("placedata", placedata);
    const virtualLimit = await BettingConfigService_default.getVirtualLimit(sid, effectiveLeagueName).catch(() => null);
    if (isLineMarket(market_type)) {
      const f2 = { ...await BettingConfigService_default.getMarketLimits(eventid, match_id).catch(() => ({})) };
      if (!(Number(f2?.min) > 0)) f2.min = LINE_MARKET_DEFAULT_MIN_STAKE;
      if (!(Number(f2?.max) > 0)) f2.max = LINE_MARKET_DEFAULT_MAX_STAKE;
      if (Number(virtualLimit?.min) > 0) f2.min = virtualLimit.min;
      if (Number(virtualLimit?.max) > 0) f2.max = virtualLimit.max;
      const f2Stake = Number(stake_amount);
      const f2SkipMin = is_cashout === true || skipMinStakeOpt;
      if (!f2SkipMin && Number(f2?.min) > 0 && f2Stake < Number(f2.min)) {
        throw new Error(`Minimum bet amount is ${Number(f2.min)}`);
      }
      if (Number(f2?.max) > 0 && f2Stake > Number(f2.max)) {
        throw new Error(`Maximum bet amount is ${Number(f2.max)}`);
      }
      console.log(`[placeBet] line market \u2014 feed min/max skipped (stake=${stake_amount}, min=${f2.min} max=${f2.max})`);
    } else {
      let limits = null;
      try {
        limits = await resolveMarketLimits({ eventid, sid, match_id, mname, market_type, selection_name });
      } catch (limitErr) {
        console.warn("[placeBet] Market limits lookup failed (non-blocking):", limitErr.message);
      }
      if (virtualLimit) {
        const base = limits || { marketName: mname || market_type || match_id, minLimit: 0, maxLimit: Number(process.env.MAX_STAKE_HARD_CAP) || 5e5 };
        limits = {
          ...base,
          minLimit: Number(virtualLimit.min) > 0 ? Number(virtualLimit.min) : base.minLimit,
          maxLimit: Number(virtualLimit.max) > 0 ? Number(virtualLimit.max) : base.maxLimit
        };
      }
      const stakeNum = Number(stake_amount);
      const skipMin = is_cashout === true || skipMinStakeOpt;
      if (limits) {
        console.log(`[placeBet] Limits for ${limits.marketName}: min=${limits.minLimit} max=${limits.maxLimit} stake=${stakeNum}${skipMin ? " (cashout \u2014 min skipped)" : ""}`);
        if (!skipMin && limits.minLimit > 0 && stakeNum < limits.minLimit) {
          throw new Error(`Minimum bet amount is ${limits.minLimit}`);
        }
        if (limits.maxLimit > 0 && stakeNum > limits.maxLimit) {
          throw new Error(`Maximum bet amount is ${limits.maxLimit}`);
        }
      } else {
        const hardCap = Number(process.env.MAX_STAKE_HARD_CAP) || 5e5;
        const minDefault = Number(process.env.MIN_STAKE_DEFAULT) || 0;
        console.warn(`[placeBet] Limits unavailable for market ${match_id} \u2014 fallback caps min=${minDefault} max=${hardCap}`);
        if (!skipMin && minDefault > 0 && stakeNum < minDefault) {
          throw new Error(`Minimum bet amount is ${minDefault}`);
        }
        if (stakeNum > hardCap) {
          throw new Error(`Maximum bet amount is ${hardCap}`);
        }
      }
    }
    // Horse racing (sid 10) only: bets only in the last RACE_BET_WINDOW_MINUTES before the off.
    // Greyhound (65) is open until the off, as TENEXCH's server (sportbetscontroller.js STEP 4.55) and
    // the live reference (a sid 65 bet 2h11m before the off was accepted — BC games sports issues #9).
    if (String(sid) === "10") {
      let raceStartMs = null;
      try {
        raceStartMs = await resolveRaceStartMs(eventid, sid);
      } catch (raceErr) {
        console.warn("[placeBet] Race window lookup failed (non-blocking):", raceErr.message);
      }
      if (raceStartMs != null) {
        const minutesToOff = (raceStartMs - Date.now()) / 6e4;
        console.log(`[placeBet] Race window: gmid=${eventid} minutesToOff=${minutesToOff.toFixed(1)} window=${RACE_BET_WINDOW_MINUTES}`);
        if (minutesToOff > RACE_BET_WINDOW_MINUTES) {
          throw new Error(`Bet will be accepted ${RACE_BET_WINDOW_MINUTES} minutes before the market starts, Thanks.`);
        }
      } else {
        console.warn(`[placeBet] Race window: start time unavailable for gmid=${eventid} \u2014 check skipped (fail open)`);
      }
    }
    {
      const gtypeForCap = { MATCH: "match", MO: "match", MATCH1: "match1", BOOKMAKER: "match1", BM: "match1" }[String(gtype || game_type || "").toUpperCase()];
      const rule = await BettingConfigService_default.getMaxOddsRule(sid, gtypeForCap, effectiveLeagueName);
      if (rule && Number(odds) > rule.max) {
        let scope = rule.sport;
        let capApplies = true;
        if (rule.limited_overs_only) {
          scope = MESSAGES.BET.LIMITED_OVERS_SCOPE;
          let hay = String(match_title || "");
          try {
            const sd = await CricketService_default.getSportDataById(eventid, sid);
            const m = Array.isArray(sd?.data) ? sd.data[0] : null;
            if (m) hay = `${m.cname || ""} ${m.ename || match_title || ""}`;
          } catch (fmtErr) {
            console.warn("[placeBet] Max-odds format lookup failed (non-blocking):", fmtErr.message);
          }
          capApplies = !isCricketTestFormat(hay);
        }
        if (capApplies) {
          throw new Error(MESSAGES.BET.RATE_OVER_LIMIT(rule.max, scope));
        }
      }
    }
    const stake = Number(stake_amount);
    const oddN = Number(odds);
    let betTypeLower = (bet_type || "").toLowerCase().trim();
    console.log("Bet details:", { stake, oddN, betTypeLower, game_type });
    if (game_type === "BOOKMAKER") {
      game_type = "BM";
    }
    if (game_type === "FANCY") {
      game_type = "FAN";
    }
    console.log("Normalized game_type:", game_type);
    const isYesNo = betTypeLower === "yes" || betTypeLower === "no";
    const isFancy = game_type === "FAN" || game_type === "MO" && isYesNo;
    const isBookmaker = game_type === "BM";
    if (stake <= 0) throw new Error("Invalid stake");
    if (isFancy) {
      if (!Number.isFinite(oddN) || oddN <= 0) throw new Error("Invalid fancy odds");
    } else {
      if (!Number.isFinite(oddN) || oddN < 1) throw new Error("Invalid odds");
    }
    // OLD (Wallets.cash):
    // const wallet = await Wallet_default.findOne({ where: { user_id }, transaction, lock: transaction.LOCK.UPDATE });
    // if (!wallet) throw new Error("Wallet not found");
    // const currentInr = Number(wallet.cash);
    // NEW (credits.inr):
    const wallet = await Credits_default.findOne({ where: { uid: user_id }, transaction, lock: transaction.LOCK.UPDATE });
    if (!wallet) throw new Error("Wallet not found");
    const currentInr = Number(wallet.inr || 0);
    console.log("Current wallet balance:", currentInr);
    const isBadlo = isBadloBet({ badlo }) || String(market_type || "").toLowerCase() === "badlo";
    const exposureIds = exposureIdentity({ marketType: market_type, selectionName: selection_name, badlo: isBadlo });
    const exposureGameType = exposureIds.game_type;
    const oldExposuresRows = await UserExposure_default.findAll({
      where: {
        user_id,
        match_id,
        game_type: exposureGameType
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const oldExposures = {};
    oldExposuresRows.forEach((r) => oldExposures[r.team_name] = Number(r.exposure_amount));
    console.log("OLD EXPOSURES:", oldExposures);
    let newExposures = { ...oldExposures };
    const sel = exposureIds.team_name != null ? String(exposureIds.team_name) : (selection_name || "").toString();
    const selLower = sel.trim().toLowerCase();
    const isDrawSel = selLower === "the draw" || selLower === "draw";
    const normGameType = isFancy ? "FAN" : game_type === "BM" ? "BM" : "MO";
    const marketsfornonfancy = [
      "Game Winner 1/2",
      "OVER_UNDER_55",
      "OVER_UNDER_45",
      "OVER_UNDER_35",
      "OVER_UNDER_25",
      "OVER_UNDER_15",
      "OVER_UNDER_05",
      "OVER_UNDER_10",
      "2nd Period Winner",
      "1st Period Winner",
      "3rd Period Winner",
      "Both Teams To Score",
      "DRAW_NO_BET",
      "Draw No Bet",
      "HALF_TIME",
      "Match Time Result 70:00",
      "Match Time Result 10:00",
      "Match Time Result 30:00",
      "Match Time Result 20:00",
      "Match Time Result 40:00",
      "Match Time Result 60:00",
      "Match Time Result 50:00",
      "Match Time Result 70:00",
      "Match Time Result 80:00",
      "Match Time Result 90:00",
      "Game Winner 1/1",
      "Game Winner 1/2",
      "Game Winner 1/3",
      "Game Winner 1/4",
      "Game Winner 1/5",
      "Game Winner 1/6",
      "Game Winner 1/7",
      "Game Winner 1/8",
      "Game Winner 1/9",
      "Game Winner 1/10",
      "Game Winner 1/11",
      "Game Winner 1/12",
      "Game Winner 1/13",
      "Game Winner 1/14",
      "Game Winner 1/15",
      "Game Winner 1/16",
      "Game Winner 1/17",
      "Game Winner 1/18",
      "Game Winner 1/19",
      "Game Winner 1/20",
      "Game Winner 2/2",
      "Game Winner 2/3",
      "Game Winner 2/4",
      "Game Winner 2/5",
      "Game Winner 2/6",
      "Game Winner 2/7",
      "Game Winner 2/8",
      "Game Winner 2/9",
      "Game Winner 2/10",
      "Game Winner 2/11",
      "Game Winner 2/12",
      "Game Winner 2/13",
      "Game Winner 2/14",
      "Game Winner 2/15",
      "Game Winner 2/16",
      "Game Winner 2/17",
      "Game Winner 2/18",
      "Game Winner 2/19",
      "Game Winner 2/20",
      "Game Winner 3/1",
      "Game Winner 3/2",
      "Game Winner 3/3",
      "Game Winner 3/4",
      "Game Winner 3/5",
      "Game Winner 3/6",
      "Game Winner 3/7",
      "Game Winner 3/8",
      "Game Winner 3/9",
      "Game Winner 3/10",
      "Game Winner 3/11",
      "Game Winner 3/12",
      "Game Winner 3/13",
      "Game Winner 3/14",
      "Game Winner 3/15",
      "Game Winner 3/16",
      "Game Winner 3/17",
      "Game Winner 3/18",
      "Game Winner 3/19",
      "Game Winner 3/20",
      "Game Winner 4/1",
      "Game Winner 4/2",
      "Game Winner 4/3",
      "Game Winner 4/4",
      "Game Winner 4/5",
      "Game Winner 4/6",
      "Game Winner 4/7",
      "Game Winner 4/8",
      "Game Winner 4/9",
      "Game Winner 4/10",
      "Game Winner 4/11",
      "Game Winner 4/12",
      "Game Winner 4/13",
      "Game Winner 4/14",
      "Game Winner 4/15",
      "Game Winner 4/16",
      "Game Winner 4/17",
      "Game Winner 4/18",
      "Game Winner 4/19",
      "Game Winner 4/20",
      "Game Winner 5/1",
      "Game Winner 5/2",
      "Game Winner 5/3",
      "Game Winner 5/4",
      "Game Winner 5/5",
      "Game Winner 5/6",
      "Game Winner 5/7",
      "Game Winner 5/8",
      "Game Winner 5/9",
      "Game Winner 5/10",
      "Game Winner 5/11",
      "Game Winner 5/12",
      "Game Winner 5/13",
      "Game Winner 5/14",
      "Game Winner 5/15",
      "Game Winner 5/16",
      "Game Winner 5/17",
      "Game Winner 5/18",
      "Game Winner 5/19",
      "Game Winner 5/20",
      "Game Winner 6/1",
      "Game Winner 6/2",
      "Game Winner 6/3",
      "Game Winner 6/4",
      "Game Winner 6/5",
      "Game Winner 6/6",
      "Game Winner 6/7",
      "Game Winner 6/8",
      "Game Winner 6/9",
      "Game Winner 6/10",
      "Game Winner 7/1",
      "Game Winner 7/2",
      "Game Winner 7/3",
      "Game Winner 7/4",
      "Game Winner 7/5",
      "Game Winner 7/6",
      "Game Winner 7/7",
      "Game Winner 2/7",
      "Game Winner 3/7",
      "Game Winner 4/7",
      "Game Winner 5/7",
      "Game Winner 6/7",
      "Game Winner 7/7",
      "1st Set Winner Home/Away",
      "2nd Set Winner Home/Away",
      "3rd Set Winner Home/Away",
      "4th Set Winner Home/Away",
      "5th Set Winner Home/Away",
      "1st Set Winner",
      "2nd Set Winner",
      "3rd Set Winner",
      "4th Set Winner",
      "5th Set Winner",
      "6th Set Winner",
      "1st Half Winner",
      "2nd Half Winner",
      "3rd Half Winner",
      "4th Half Winner",
      "5th Half Winner",
      "6th Half Winner",
      "1st Quarter Winner",
      "2nd Quarter Winner",
      "3rd Quarter Winner",
      "4th Quarter Winner",
      "5th Quarter Winner",
      "6th Quarter Winner",
      "1st Set Race To 1.0",
      "1st Set Race To 2.0",
      "1st Set Race To 3.0",
      "1st Set Race To 4.0",
      "1st Set Race To 5.0",
      "1st Set Race To 6.0",
      "1st Set Race To 7.0",
      "1st Set Race To 8.0",
      "1st Set Race To 9.0",
      "1st Set Race To 10.0",
      "1st Set Race To 11.0",
      "1st Set Race To 12.0",
      "1st Set Race To 13.0",
      "1st Set Race To 14.0",
      "1st Set Race To 15.0",
      "2nd Set Race To 1.0",
      "2nd Set Race To 2.0",
      "2nd Set Race To 3.0",
      "2nd Set Race To 4.0",
      "2nd Set Race To 5.0",
      "2nd Set Race To 6.0",
      "2nd Set Race To 7.0",
      "2nd Set Race To 8.0",
      "2nd Set Race To 9.0",
      "2nd Set Race To 10.0",
      "2nd Set Race To 11.0",
      "2nd Set Race To 12.0",
      "2nd Set Race To 13.0",
      "2nd Set Race To 14.0",
      "2nd Set Race To 15.0",
      "3rd Set Race To 1.0",
      "3rd Set Race To 2.0",
      "3rd Set Race To 3.0",
      "3rd Set Race To 4.0",
      "3rd Set Race To 5.0",
      "3rd Set Race To 6.0",
      "3rd Set Race To 7.0",
      "3rd Set Race To 8.0",
      "3rd Set Race To 9.0",
      "3rd Set Race To 10.0",
      "3rd Set Race To 11.0",
      "3rd Set Race To 12.0",
      "3rd Set Race To 13.0",
      "3rd Set Race To 14.0",
      "3rd Set Race To 15.0",
      "4th Set Race To 1.0",
      "4th Set Race To 2.0",
      "4th Set Race To 3.0",
      "4th Set Race To 4.0",
      "4th Set Race To 5.0",
      "4th Set Race To 6.0",
      "4th Set Race To 7.0",
      "4th Set Race To 8.0",
      "4th Set Race To 9.0",
      "4th Set Race To 10.0",
      "4th Set Race To 11.0",
      "4th Set Race To 12.0",
      "4th Set Race To 13.0",
      "4th Set Race To 14.0",
      "4th Set Race To 15.0",
      "Point Winner 1/1/1",
      "Point Winner 1/1/1",
      "Point Winner 1/1/2",
      "Point Winner 1/1/3",
      "Point Winner 1/1/4",
      "Point Winner 1/1/5",
      "Point Winner 1/1/6",
      "Point Winner 1/1/7",
      "Point Winner 1/1/8",
      "Point Winner 1/1/9",
      "Point Winner 1/1/10",
      "Point Winner 1/1/11",
      "Point Winner 1/1/12",
      "Point Winner 1/1/13",
      "Point Winner 1/1/14",
      "Point Winner 1/1/15",
      "Point Winner 1/1/16",
      "Point Winner 1/1/17",
      "Point Winner 1/1/18",
      "Point Winner 1/1/19",
      "Point Winner 1/1/20",
      "Point Winner 1/2/1",
      "Point Winner 1/2/2",
      "Point Winner 1/2/3",
      "Point Winner 1/2/4",
      "Point Winner 1/2/5",
      "Point Winner 1/2/6",
      "Point Winner 1/2/7",
      "Point Winner 1/2/8",
      "Point Winner 1/2/9",
      "Point Winner 1/2/10",
      "Point Winner 1/2/11",
      "Point Winner 1/2/12",
      "Point Winner 1/2/13",
      "Point Winner 1/2/14",
      "Point Winner 1/2/15",
      "Point Winner 1/2/16",
      "Point Winner 1/2/17",
      "Point Winner 1/2/18",
      "Point Winner 1/2/19",
      "Point Winner 1/2/20",
      "Point Winner 1/3/1",
      "Point Winner 1/3/2",
      "Point Winner 1/3/3",
      "Point Winner 1/3/4",
      "Point Winner 1/3/5",
      "Point Winner 1/3/6",
      "Point Winner 1/3/7",
      "Point Winner 1/3/8",
      "Point Winner 1/3/9",
      "Point Winner 1/3/10",
      "Point Winner 1/3/11",
      "Point Winner 1/3/12",
      "Point Winner 1/3/13",
      "Point Winner 1/3/14",
      "Point Winner 1/3/15",
      "Point Winner 1/3/16",
      "Point Winner 1/3/17",
      "Point Winner 1/3/18",
      "Point Winner 1/3/19",
      "Point Winner 1/3/20",
      "Point Winner 1/4/1",
      "Point Winner 1/4/2",
      "Point Winner 1/4/3",
      "Point Winner 1/4/4",
      "Point Winner 1/4/5",
      "Point Winner 1/4/6",
      "Point Winner 1/4/7",
      "Point Winner 1/4/8",
      "Point Winner 1/4/9",
      "Point Winner 1/5/1",
      "Point Winner 1/5/2",
      "Point Winner 1/5/3",
      "Point Winner 1/5/4",
      "Point Winner 1/5/5",
      "Point Winner 1/5/6",
      "Point Winner 1/5/7",
      "Point Winner 1/5/8",
      "Point Winner 1/5/9",
      "Point Winner 1/6/1",
      "Point Winner 1/6/2",
      "Point Winner 1/6/3",
      "Point Winner 1/6/4",
      "Point Winner 1/6/5",
      "Point Winner 1/6/6",
      "Point Winner 1/6/7",
      "Point Winner 1/6/8",
      "Point Winner 1/6/9",
      "Point Winner 1/7/1",
      "Point Winner 1/7/2",
      "Point Winner 1/7/3",
      "Point Winner 1/7/4",
      "Point Winner 1/7/5",
      "Point Winner 1/7/6",
      "Point Winner 1/7/7",
      "Point Winner 1/7/8",
      "Point Winner 1/7/9",
      "Point Winner 1/8/1",
      "Point Winner 1/8/2",
      "Point Winner 1/8/3",
      "Point Winner 1/8/4",
      "Point Winner 1/8/5",
      "Point Winner 1/8/6",
      "Point Winner 1/8/7",
      "Point Winner 1/8/8",
      "Point Winner 1/8/9",
      "Point Winner 1/9/1",
      "Point Winner 1/9/2",
      "Point Winner 1/9/3",
      "Point Winner 1/9/4",
      "Point Winner 1/9/5",
      "Point Winner 1/9/6",
      "Point Winner 1/9/7",
      "Point Winner 1/9/8",
      "Point Winner 1/9/9",
      "Point Winner 2/1/1",
      "Point Winner 2/1/2",
      "Point Winner 2/1/3",
      "Point Winner 2/1/4",
      "Point Winner 2/1/5",
      "Point Winner 2/1/6",
      "Point Winner 2/1/7",
      "Point Winner 2/1/8",
      "Point Winner 2/1/9",
      "Point Winner 2/2/1",
      "Point Winner 2/2/2",
      "Point Winner 2/2/3",
      "Point Winner 2/2/4",
      "Point Winner 2/2/5",
      "Point Winner 2/2/6",
      "Point Winner 2/2/7",
      "Point Winner 2/2/8",
      "Point Winner 2/2/9",
      "Point Winner 2/3/1",
      "Point Winner 2/3/2",
      "Point Winner 2/3/3",
      "Point Winner 2/3/4",
      "Point Winner 2/3/5",
      "Point Winner 2/3/6",
      "Point Winner 2/3/7",
      "Point Winner 2/3/8",
      "Point Winner 2/3/9",
      "Point Winner 2/4/1",
      "Point Winner 2/4/2",
      "Point Winner 2/4/3",
      "Point Winner 2/4/4",
      "Point Winner 2/4/5",
      "Point Winner 2/4/6",
      "Point Winner 2/4/7",
      "Point Winner 2/4/8",
      "Point Winner 2/4/9",
      "Point Winner 2/5/1",
      "Point Winner 2/5/2",
      "Point Winner 2/5/3",
      "Point Winner 2/5/4",
      "Point Winner 2/5/5",
      "Point Winner 2/5/6",
      "Point Winner 2/5/7",
      "Point Winner 2/5/8",
      "Point Winner 2/5/9",
      "Point Winner 2/6/1",
      "Point Winner 2/6/2",
      "Point Winner 2/6/3",
      "Point Winner 2/6/4",
      "Point Winner 2/6/5",
      "Point Winner 2/6/6",
      "Point Winner 2/6/7",
      "Point Winner 2/6/8",
      "Point Winner 2/6/9",
      "Point Winner 2/7/1",
      "Point Winner 2/7/2",
      "Point Winner 2/7/3",
      "Point Winner 2/7/4",
      "Point Winner 2/7/5",
      "Point Winner 2/7/6",
      "Point Winner 2/7/7",
      "Point Winner 2/7/8",
      "Point Winner 2/7/9",
      "Point Winner 2/8/1",
      "Point Winner 2/8/2",
      "Point Winner 2/8/3",
      "Point Winner 2/8/4",
      "Point Winner 2/8/5",
      "Point Winner 2/8/6",
      "Point Winner 2/8/7",
      "Point Winner 2/8/8",
      "Point Winner 2/8/9",
      "Point Winner 2/9/1",
      "Point Winner 2/9/2",
      "Point Winner 2/9/3",
      "Point Winner 2/9/4",
      "Point Winner 2/9/5",
      "Point Winner 2/9/6",
      "Point Winner 2/9/7",
      "Point Winner 2/9/8",
      "Point Winner 2/9/9",
      "Point Winner 3/1/1",
      "Point Winner 3/1/2",
      "Point Winner 3/1/3",
      "Point Winner 3/1/4",
      "Point Winner 3/1/5",
      "Point Winner 3/1/6",
      "Point Winner 3/1/7",
      "Point Winner 3/1/8",
      "Point Winner 3/1/9",
      "Point Winner 3/2/1",
      "Point Winner 3/2/2",
      "Point Winner 3/2/3",
      "Point Winner 3/2/4",
      "Point Winner 3/2/5",
      "Point Winner 3/2/6",
      "Point Winner 3/2/7",
      "Point Winner 3/2/8",
      "Point Winner 3/2/9",
      "Point Winner 3/3/1",
      "Point Winner 3/3/2",
      "Point Winner 3/3/3",
      "Point Winner 3/3/4",
      "Point Winner 3/3/5",
      "Point Winner 3/3/6",
      "Point Winner 3/3/7",
      "Point Winner 3/3/8",
      "Point Winner 3/3/9",
      "Point Winner 3/4/1",
      "Point Winner 3/4/2",
      "Point Winner 3/4/3",
      "Point Winner 3/4/4",
      "Point Winner 3/4/5",
      "Point Winner 3/4/6",
      "Point Winner 3/4/7",
      "Point Winner 3/4/8",
      "Point Winner 3/4/9",
      "Point Winner 3/5/1",
      "Point Winner 3/5/2",
      "Point Winner 3/5/3",
      "Point Winner 3/5/4",
      "Point Winner 3/5/5",
      "Point Winner 3/5/6",
      "Point Winner 3/5/7",
      "Point Winner 3/5/8",
      "Point Winner 3/5/9",
      "Point Winner 3/6/1",
      "Point Winner 3/6/2",
      "Point Winner 3/6/3",
      "Point Winner 3/6/4",
      "Point Winner 3/6/5",
      "Point Winner 3/6/6",
      "Point Winner 3/6/7",
      "Point Winner 3/6/8",
      "Point Winner 3/6/9",
      "Point Winner 3/7/1",
      "Point Winner 3/7/2",
      "Point Winner 3/7/3",
      "Point Winner 3/7/4",
      "Point Winner 3/7/5",
      "Point Winner 3/7/6",
      "Point Winner 3/7/7",
      "Point Winner 3/7/8",
      "Point Winner 3/7/9",
      "Point Winner 3/8/1",
      "Point Winner 3/8/2",
      "Point Winner 3/8/3",
      "Point Winner 3/8/4",
      "Point Winner 3/8/5",
      "Point Winner 3/8/6",
      "Point Winner 3/8/7",
      "Point Winner 3/8/8",
      "Point Winner 3/8/9",
      "Point Winner 3/9/1",
      "Point Winner 3/9/2",
      "Point Winner 3/9/3",
      "Point Winner 3/9/4",
      "Point Winner 3/9/5",
      "Point Winner 3/9/6",
      "Point Winner 3/9/7",
      "Point Winner 3/9/8",
      "Point Winner 3/9/9",
      "Point Winner 4/1/1",
      "Point Winner 4/1/2",
      "Point Winner 4/1/3",
      "Point Winner 4/1/4",
      "Point Winner 4/1/5",
      "Point Winner 4/1/6",
      "Point Winner 4/1/7",
      "Point Winner 4/1/8",
      "Point Winner 4/1/9",
      "Point Winner 4/2/1",
      "Point Winner 4/2/2",
      "Point Winner 4/2/3",
      "Point Winner 4/2/4",
      "Point Winner 4/2/5",
      "Point Winner 4/2/6",
      "Point Winner 4/2/7",
      "Point Winner 4/2/8",
      "Point Winner 4/2/9",
      "Point Winner 4/3/1",
      "Point Winner 4/3/2",
      "Point Winner 4/3/3",
      "Point Winner 4/3/4",
      "Point Winner 4/3/5",
      "Point Winner 4/3/6",
      "Point Winner 4/3/7",
      "Point Winner 4/3/8",
      "Point Winner 4/3/9",
      "Point Winner 4/4/1",
      "Point Winner 4/4/2",
      "Point Winner 4/4/3",
      "Point Winner 4/4/4",
      "Point Winner 4/4/5",
      "Point Winner 4/4/6",
      "Point Winner 4/4/7",
      "Point Winner 4/4/8",
      "Point Winner 4/4/9",
      "Point Winner 4/5/1",
      "Point Winner 4/5/2",
      "Point Winner 4/5/3",
      "Point Winner 4/5/4",
      "Point Winner 4/5/5",
      "Point Winner 4/5/6",
      "Point Winner 4/5/7",
      "Point Winner 4/5/8",
      "Point Winner 4/5/9",
      "Point Winner 4/6/1",
      "Point Winner 4/6/2",
      "Point Winner 4/6/3",
      "Point Winner 4/6/4",
      "Point Winner 4/6/5",
      "Point Winner 4/6/6",
      "Point Winner 4/6/7",
      "Point Winner 4/6/8",
      "Point Winner 4/6/9",
      "Point Winner 4/7/1",
      "Point Winner 4/7/2",
      "Point Winner 4/7/3",
      "Point Winner 4/7/4",
      "Point Winner 4/7/5",
      "Point Winner 4/7/6",
      "Point Winner 4/7/7",
      "Point Winner 4/7/8",
      "Point Winner 4/7/9",
      "Point Winner 4/8/1",
      "Point Winner 4/8/2",
      "Point Winner 4/8/3",
      "Point Winner 4/8/4",
      "Point Winner 4/8/5",
      "Point Winner 4/8/6",
      "Point Winner 4/8/7",
      "Point Winner 4/8/8",
      "Point Winner 4/8/9",
      "Point Winner 4/9/1",
      "Point Winner 4/9/2",
      "Point Winner 4/9/3",
      "Point Winner 4/9/4",
      "Point Winner 4/9/5",
      "Point Winner 4/9/6",
      "Point Winner 4/9/7",
      "Point Winner 4/9/8",
      "Point Winner 4/9/9",
      "Under/Over 5.5",
      "Under/Over 0.5",
      "Under/Over 1.5",
      "Under/Over 2.5",
      "Under/Over 3.5",
      "Under/Over 4.5",
      "Under/Over 6.5",
      // 'BM 1st Set Winner',
      // 'BM 2nd Set Winner',
      // 'BM 3rd Set Winner',
      // 'BM 4th Set Winner',
      // 'BM 5th Set Winner',
      "1st Set Race To 10.0",
      "1st Set Race To 9.0",
      "1st Set Race To 8.0",
      "1st Set Race To 7.0",
      "1st Set Race To 6.0",
      "1st Set Race To 5.0",
      "1st Set Race To 4.0",
      "1st Set Race To 3.0",
      "1st Set Race To 2.0",
      "1st Set Race To 1.0",
      "2nd Set Race To 10.0",
      "2nd Set Race To 9.0",
      "2nd Set Race To 8.0",
      "2nd Set Race To 7.0",
      "2nd Set Race To 6.0",
      "2nd Set Race To 5.0",
      "2nd Set Race To 4.0",
      "2nd Set Race To 3.0",
      "2nd Set Race To 2.0",
      "2nd Set Race To 1.0",
      "3rd Set Race To 10.0",
      "3rd Set Race To 9.0",
      "3rd Set Race To 8.0",
      "3rd Set Race To 7.0",
      "3rd Set Race To 6.0",
      "3rd Set Race To 5.0",
      "3rd Set Race To 4.0",
      "3rd Set Race To 3.0",
      "3rd Set Race To 2.0",
      "3rd Set Race To 1.0",
      "4th Set Race To 10.0",
      "4th Set Race To 9.0",
      "4th Set Race To 8.0",
      "4th Set Race To 7.0",
      "4th Set Race To 6.0",
      "4th Set Race To 5.0",
      "4th Set Race To 4.0",
      "4th Set Race To 3.0",
      "4th Set Race To 2.0",
      "4th Set Race To 1.0",
      "5th Set Race To 4.0",
      "5th Set Race To 3.0",
      "5th Set Race To 2.0",
      "5th Set Race To 1.0",
      "Total Tie Break in the Match 0.5",
      "Total Tie Break in the Match 1.0",
      "Total Tie Break in the Match 1.5",
      "Total Tie Break in the Match 2.0",
      "Total Tie Break in the Match 2.5",
      "Total Tie Break in the Match 3.5",
      "Game To Deuce 1/1",
      "Game To Deuce 1/2",
      "Game To Deuce 1/3",
      "Game To Deuce 1/4",
      "Game To Deuce 1/5",
      "Game To Deuce 1/6",
      "Game To Deuce 1/7",
      "Game To Deuce 1/8",
      "Game To Deuce 1/9",
      "Game To Deuce 1/10",
      "Game To Deuce 1/11",
      "Game To Deuce 1/12",
      "Game To Deuce 1/13",
      "Game To Deuce 1/14",
      "Game To Deuce 1/15",
      "Game To Deuce 1/16",
      "Game To Deuce 1/17",
      "Game To Deuce 1/18",
      "Game To Deuce 1/19",
      "Game To Deuce 1/20",
      "Game To Deuce 2/1",
      "Game To Deuce 2/2",
      "Game To Deuce 2/3",
      "Game To Deuce 2/4",
      "Game To Deuce 2/5",
      "Game To Deuce 2/6",
      "Game To Deuce 2/7",
      "Game To Deuce 2/8",
      "Game To Deuce 2/9",
      "Game To Deuce 2/10",
      "Game To Deuce 2/11",
      "Game To Deuce 2/12",
      "Game To Deuce 2/13",
      "Game To Deuce 2/14",
      "Game To Deuce 2/15",
      "Game To Deuce 2/16",
      "Game To Deuce 2/17",
      "Game To Deuce 2/18",
      "Game To Deuce 2/19",
      "Game To Deuce 2/20",
      "Game To Deuce 3/1",
      "Game To Deuce 3/2",
      "Game To Deuce 3/3",
      "Game To Deuce 3/4",
      "Game To Deuce 3/5",
      "Game To Deuce 3/6",
      "Game To Deuce 3/7",
      "Game To Deuce 3/8",
      "Game To Deuce 3/9",
      "Game To Deuce 3/10",
      "Game To Deuce 3/11",
      "Game To Deuce 3/12",
      "Game To Deuce 3/13",
      "Game To Deuce 3/14",
      "Game To Deuce 3/15",
      "Game To Deuce 3/16",
      "Game To Deuce 3/17",
      "Game To Deuce 3/18",
      "Game To Deuce 3/19",
      "Game To Deuce 3/20",
      "Game To Deuce 4/1",
      "Game To Deuce 4/2",
      "Game To Deuce 4/3",
      "Game To Deuce 4/4",
      "Game To Deuce 4/5",
      "Game To Deuce 4/6",
      "Game To Deuce 4/7",
      "Game To Deuce 4/8",
      "Game To Deuce 4/9",
      "Game To Deuce 4/10",
      "Game To Deuce 4/11",
      "Game To Deuce 4/12",
      "Game To Deuce 4/13",
      "Game To Deuce 4/14",
      "Game To Deuce 4/15",
      "Game To Deuce 4/16",
      "Game To Deuce 4/17",
      "Game To Deuce 4/18",
      "Game To Deuce 4/19",
      "Game To Deuce 4/20",
      "Game To Deuce 5/1",
      "Game To Deuce 5/2",
      "Game To Deuce 5/3",
      "Game To Deuce 5/4",
      "Game To Deuce 5/5",
      "Game To Deuce 5/6",
      "Game To Deuce 5/7",
      "Game To Deuce 5/8",
      "Game To Deuce 5/9",
      "Game To Deuce 5/10",
      "Game To Deuce 5/11",
      "Game To Deuce 5/12",
      "Game To Deuce 5/13",
      "Game To Deuce 5/14",
      "Game To Deuce 5/15",
      "Game To Deuce 5/16",
      "Game To Deuce 5/17",
      "Game To Deuce 5/18",
      "Game To Deuce 5/19",
      "Game To Deuce 5/20",
      "Game To Deuce 6/1",
      "Game To Deuce 6/2",
      "Game To Deuce 6/3",
      "Game To Deuce 6/4",
      "Game To Deuce 6/5",
      "Game To Deuce 6/6",
      "Game To Deuce 6/7",
      "Game To Deuce 6/8",
      "Game To Deuce 6/9",
      "Game To Deuce 6/10",
      "Game To Deuce 6/11",
      "Game To Deuce 6/12",
      "Game To Deuce 6/13",
      "Game To Deuce 6/14",
      "Game To Deuce 6/15",
      "Game To Deuce 6/16",
      "Game To Deuce 6/17",
      "Game To Deuce 6/18",
      "Game To Deuce 6/19",
      "Game To Deuce 6/20",
      "Game To Deuce 7/1",
      "Game To Deuce 7/2",
      "Game To Deuce 7/3",
      "Game To Deuce 7/4",
      "Game To Deuce 7/5",
      "Game To Deuce 7/6",
      "Game To Deuce 7/7",
      "Game To Deuce 7/8",
      "Game To Deuce 7/9",
      "Game To Deuce 7/10",
      "Game To Deuce 8/1",
      "Game To Deuce 8/2",
      "Game To Deuce 8/3",
      "Game To Deuce 8/4",
      "Game To Deuce 8/5",
      "Game To Deuce 8/6",
      "Game To Deuce 8/7",
      "Game To Deuce 8/8",
      "Game To Deuce 8/9",
      "Game To Deuce 8/10",
      "Game To Deuce 9/1",
      "Game To Deuce 9/2",
      "Game To Deuce 9/3",
      "Game To Deuce 9/4",
      "Game To Deuce 9/5",
      "Game To Deuce 9/6",
      "Game To Deuce 9/7",
      "Game To Deuce 9/8",
      "Game To Deuce 9/9",
      "Under/Over 180s 0.5",
      "Under/Over 180s 1.0",
      "Under/Over 180s 1.5",
      "Under/Over 180s 2.0",
      "Under/Over 180s 2.5",
      "Under/Over 180s 3.0",
      "Under/Over 180s 3.5",
      "Under/Over 180s 4.0",
      "Tied Match",
      "TIED_MATCH"
    ];
    const fixedNonFancyMarkets = [
      "OVER_UNDER_55",
      "OVER_UNDER_45",
      "OVER_UNDER_35",
      "OVER_UNDER_25",
      "OVER_UNDER_15",
      "OVER_UNDER_05",
      "OVER_UNDER_10",
      "2nd Period Winner",
      "1st Period Winner",
      "3rd Period Winner",
      "Both Teams To Score",
      "DRAW_NO_BET",
      "Draw No Bet",
      "HALF_TIME",
      "1st Set Winner Home/Away",
      "2nd Set Winner Home/Away",
      "3rd Set Winner Home/Away",
      "4th Set Winner Home/Away",
      "5th Set Winner Home/Away",
      "1st Set Winner",
      "2nd Set Winner",
      "3rd Set Winner",
      "4th Set Winner",
      "5th Set Winner",
      "6th Set Winner",
      "1st Half Winner",
      "2nd Half Winner",
      "3rd Half Winner",
      "4th Half Winner",
      "5th Half Winner",
      "6th Half Winner",
      "1st Quarter Winner",
      "2nd Quarter Winner",
      "3rd Quarter Winner",
      "4th Quarter Winner",
      "5th Quarter Winner",
      "6th Quarter Winner",
      "Tied Match",
      "TIED_MATCH"
    ];
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
    const isFancyMarketType = marketsforfancy.includes(market_type) || isLineMarket(market_type);
    const marketsforBMfancy = [
      "BM 1st Set Winner",
      "BM 2nd Set Winner",
      "BM 3rd Set Winner",
      "BM 4th Set Winner",
      "BM 5th Set Winner",
      "BM 6th Set Winner"
    ];
    const bigRunnerSessionMarket = /\b(1ST|2ND|3RD)\s+INN\s+(\d+(\.\d+)?\s+OVER|LAMBI)\b/i;
    const marketforfancywithbigrunners = [
      bigRunnerSessionMarket,
      "TOURNAMENT_WINNER",
      "Next Goal 1.0",
      "Next Goal 2.0",
      "Next Goal 3.0",
      "Next Goal 4.0",
      "Next Goal 5.0",
      "Next Goal 6.0",
      "Next Goal 7.0",
      "Next Goal 8.0",
      "Next Goal 9.0",
      "Next Goal 10.0",
      "Match Result/Both Teams to score",
      "Correct Score 1st Set",
      "Correct Score 2nd Set",
      "Correct Score 3rd Set",
      "Correct Score 4th Set",
      "Correct Score 5th Set",
      "Correct Score 6th Set",
      "HT/FT"
      // 'oddeven'
    ];
    // The MO/BM book only debits the runners it lists: a selection outside `runners` (feed list,
    // set by the buffer) books no loss anywhere. game_type/market_type are client-set, so this
    // guards every market that reaches the book, not only the ones the buffer sees as live-tracked.
    if (!isFancyMarketType && (normGameType === "MO" || normGameType === "BM") && !(Array.isArray(runners) && runners.length >= 2 && runners.includes(sel))) {
      throw new Error(MESSAGES.BET.GAME_SUSPEND);
    }
    if (isFancyMarketType) {
      console.log("marketsforfancy", marketsforfancy);
      console.log("market_type", market_type);
      const S = Number(stake);
      let L = Number(lay_size);
      let B = Number(back_size);
      if (market_type === "fancy1" || market_type === "oddeven") {
        console.log("runner_odds", oddN);
        L = (oddN - 1) * 100;
        B = (oddN - 1) * 100;
        console.log("oddeven hit ");
        console.log("L", L);
        console.log("B", B);
      }
      let layword = sel + "lay";
      let backword = sel + "back";
      if (isLineMarket(market_type)) {
        const lineBets = await SportsBet_default.findAll({
          where: { user_id, eventid, market_type, status: "open" },
          attributes: ["bet_type", "odds", "stake_amount"],
          transaction
        });
        const legs = [
          ...lineBets.map((b) => ({ line: Number(b.odds), stake: Number(b.stake_amount), betType: b.bet_type })),
          { line: Number(oddN), stake: S, betType: betTypeLower }
        ].filter((l) => Number.isFinite(l.line) && Number.isFinite(l.stake));
        const probes = [Math.min(...legs.map((l) => l.line)) - 1, ...legs.map((l) => l.line)];
        const worst = Math.min(
          ...probes.map((r) => legs.reduce((sum, l) => sum + linePnl({ runs: r, ...l }), 0))
        );
        newExposures[sel] = Math.min(0, Number(worst.toFixed(2)));
        newExposures[layword] = (oldExposures[layword] || 0) + stake;
        newExposures[backword] = (oldExposures[backword] || 0) - stake;
      } else {
        console.log("oldExposures", oldExposures);
        let layExp = Number(oldExposures?.[layword] || 0);
        let backExp = Number(oldExposures?.[backword] || 0);
        console.log("layExp", layExp);
        console.log("backExp", backExp);
        const layRisk = market_type === "fancy1" || market_type === "oddeven" ? S * L / 100 : S * L / 100;
        const backWin = market_type === "fancy1" || market_type === "oddeven" ? S * B / 100 : S * B / 100;
        if (market_type === "oddeven") {
          if (betTypeLower === "lay" || betTypeLower === "no") {
            layExp += layRisk;
            backExp -= S;
          } else if (betTypeLower === "back" || betTypeLower === "yes") {
            layExp -= S;
            backExp += backWin;
          }
        } else {
          if (betTypeLower === "lay" || betTypeLower === "no") {
            layExp += S;
            backExp -= layRisk;
          } else if (betTypeLower === "back" || betTypeLower === "yes") {
            layExp -= S;
            backExp += backWin;
          }
        }
        console.log("layExp", layExp);
        console.log("backExp", backExp);
        newExposures[layword] = layExp;
        newExposures[backword] = backExp;
        let stakeKey = sel + "totalstake";
        let totalStake = Number(oldExposures?.[stakeKey] || 0) + S;
        newExposures[stakeKey] = totalStake;
        const IS_METER = isMeterMarket(market_type);
        const existingBets = await SportsBet_default.findAll({
          where: { user_id, selection_name: sel, eventid, status: "open" },
          attributes: ["bet_type", "stake_amount", "odds", "size", "liability", "badlo"],
          transaction
        });
        const toContribution = (betType, line, win, lose) => ({
          line: Number(line),
          isYes: ["yes", "back"].includes(String(betType || "").toLowerCase()),
          winAmt: win,
          loseAmt: lose
        });
        const contribs = existingBets.map((b) => {
          const stk = Number(b.stake_amount);
          const sz = market_type === "fancy1" || market_type === "oddeven" ? (Number(b.odds) - 1) * 100 : Number(b.size);
          const liab = Number(b.liability);
          const isYes = ["yes", "back"].includes(String(b.bet_type || "").toLowerCase());
          const legIsBadlo = isBadloBet(b);
          return {
            ...toContribution(
              b.bet_type,
              b.odds,
              legIsBadlo ? stk : isYes ? stk * sz / 100 : stk,
              // win amount
              legIsBadlo ? stk : isYes ? stk : liab > 0 ? liab : stk * sz / 100
              // lose amount
            ),
            stake: stk,
            // meter/line/badlo price off the stake, not a bhav
            isBadlo: legIsBadlo
          };
        });
        contribs.push(
          isBadlo ? { ...toContribution(betTypeLower, oddN, S, S), stake: S, isBadlo: true } : betTypeLower === "lay" || betTypeLower === "no" ? { ...toContribution(betTypeLower, oddN, S, layRisk), stake: S, isBadlo: false } : { ...toContribution(betTypeLower, oddN, backWin, S), stake: S, isBadlo: false }
        );
        const validContribs = contribs.filter(
          (c) => !isNaN(c.line) && c.line > 0 && !isNaN(c.winAmt) && !isNaN(c.loseAmt)
        );
        const pnlAt = (r) => validContribs.reduce((sum, c) => {
          if (c.isBadlo) {
            return sum + badloPnl({
              runs: r,
              line: c.line,
              stake: c.stake,
              betType: c.isYes ? "yes" : "no"
            });
          }
          if (IS_METER) {
            return sum + meterPnl({
              runs: r,
              line: c.line,
              stake: c.stake,
              betType: c.isYes ? "yes" : "no"
            });
          }
          return sum + ((c.isYes ? r >= c.line : r < c.line) ? c.winAmt : -c.loseAmt);
        }, 0);
        let worstCase = 0;
        if (validContribs.length) {
          const lines = validContribs.map((c) => c.line);
          const hasBadlo = validContribs.some((c) => c.isBadlo);
          const points = IS_METER ? [0, ...new Set(lines.map((l) => l + METER_MAX_RUNS))] : [
            Math.min(...lines) - 1,
            ...new Set(lines),
            ...hasBadlo ? [...new Set(lines)].map((l) => l + 0.5) : []
          ];
          worstCase = Math.min(...points.map(pnlAt));
        }
        worstCase = Math.round(worstCase * 100) / 100;
        if (IS_METER && validContribs.length) {
          const capEnd = Math.max(...validContribs.map((c) => c.line)) + METER_MAX_RUNS;
          newExposures[layword] = Math.round(pnlAt(0) * 100) / 100;
          newExposures[backword] = Math.round(pnlAt(capEnd) * 100) / 100;
        }
        if (market_type === "fancy1" || market_type === "oddeven") {
          newExposures[sel] = Math.min(layExp, backExp);
        } else {
          newExposures[sel] = worstCase;
        }
        console.log("[FANCY EXPOSURE TRACK]", {
          selection: sel,
          betType: betTypeLower,
          stake: S,
          layBhav: L,
          backBhav: B,
          layExposure: layExp,
          backExposure: backExp,
          worstCase,
          openBets: existingBets.length + 1
        });
      }
    } else if (normGameType === "MO") {
      newExposures = calculateRunnerExposure({
        runners,
        selectedRunner: sel,
        stake,
        odd: oddN,
        betType: betTypeLower,
        oldExposures
      });
    } else if (normGameType === "BM") {
      const newodds = normalizeOdds(oddN);
      console.log(`Normalized BM odds: ${oddN} \u2192 ${newodds}`);
      newExposures = calculateRunnerExposure({
        runners,
        selectedRunner: sel,
        stake,
        odd: newodds,
        betType: betTypeLower,
        oldExposures
      });
    } else if (isNonFancyMarket(market_type)) {
      let profit = 0;
      let layLiab = 0;
      if (market_type === "Tied Match") {
        let new_odds = oddN / 100;
        profit = Math.round(stake * new_odds * 100) / 100;
        layLiab = Math.round(stake * new_odds * 100) / 100;
      } else {
        profit = Math.round(stake * (oddN - 1) * 100) / 100;
        layLiab = Math.round(stake * (oddN - 1) * 100) / 100;
      }
      if (isDrawSel) {
        if (betTypeLower === "back" || betTypeLower === "yes" || betTypeLower === "Yes") {
          newExposures["The Draw"] = (oldExposures["The Draw"] || 0) + profit;
          newExposures[team_one] = (oldExposures[team_one] || 0) - stake;
          newExposures[team_two] = (oldExposures[team_two] || 0) - stake;
        } else {
          newExposures["The Draw"] = (oldExposures["The Draw"] || 0) - layLiab;
          newExposures[team_one] = (oldExposures[team_one] || 0) + stake;
          newExposures[team_two] = (oldExposures[team_two] || 0) + stake;
        }
      } else {
        const otherTeam = sel === team_one ? team_two : team_one;
        if (betTypeLower === "back") {
          newExposures[sel] = (oldExposures[sel] || 0) + profit;
          newExposures[otherTeam] = (oldExposures[otherTeam] || 0) - stake;
          if (count == 3 || oldExposures["The Draw"] !== void 0) {
            newExposures["The Draw"] = (oldExposures["The Draw"] || 0) - stake;
          }
        } else {
          newExposures[sel] = (oldExposures[sel] || 0) - layLiab;
          newExposures[otherTeam] = (oldExposures[otherTeam] || 0) + stake;
          if (count == 3 || oldExposures["The Draw"] !== void 0) {
            newExposures["The Draw"] = (oldExposures["The Draw"] || 0) + stake;
          }
        }
      }
    } else if (isFancyMatch(market_type, marketsforBMfancy)) {
      const newodds = normalizeOdds(oddN);
      console.log(`Normalized BM odds: ${oddN} \u2192 ${newodds}`);
      newExposures = calculateRunnerExposure({
        runners,
        selectedRunner: sel,
        stake,
        odd: newodds,
        betType: betTypeLower,
        oldExposures
      });
    } else if (isFancyMatch(market_type, marketforfancywithbigrunners)) {
      newExposures = calculateRunnerExposure({
        runners,
        selectedRunner: sel,
        stake,
        odd: oddN,
        betType: betTypeLower,
        oldExposures
      });
    } else {
      throw new Error(`bet is closed for this market`);
    }
    console.log("NEW EXPOSURES:", newExposures);
    let balanceChange = 0;
    if (isFancyMarketType) {
      const oldNegs = Object.entries(oldExposures).filter(([key, val]) => key === sel && val < 0).map(([, val]) => val);
      const newNegs = Object.entries(newExposures).filter(([key, val]) => key === sel && val < 0).map(([, val]) => val);
      const oldMax = oldNegs.length ? Math.abs(Math.min(...oldNegs)) : 0;
      const newMax = newNegs.length ? Math.abs(Math.min(...newNegs)) : 0;
      const liabInc = newMax - oldMax;
      console.log("LIABILITY CALCULATION (MO/BM):");
      console.log("- Old liabilities:", oldNegs);
      console.log("- New liabilities:", newNegs);
      console.log("- Old total liability (blocked):", oldMax);
      console.log("- New total liability (to block):", newMax);
      console.log("- Liability change:", liabInc);
      if (Object.keys(oldExposures).length === 0) balanceChange = newMax;
      else if (liabInc > 0) balanceChange = liabInc;
      else if (liabInc < 0) balanceChange = liabInc;
      if (balanceChange > 0 && currentInr < balanceChange) throw new Error("Bet Not Confirm Check Exposure Limit And Balance");
    } else {
      const oldNegs = Object.values(oldExposures).filter((x) => x < 0);
      const newNegs = Object.values(newExposures).filter((x) => x < 0);
      const oldMax = oldNegs.length ? Math.abs(Math.min(...oldNegs)) : 0;
      const newMax = newNegs.length ? Math.abs(Math.min(...newNegs)) : 0;
      const liabInc = newMax - oldMax;
      console.log("LIABILITY CALCULATION (MO/BM):");
      console.log("- Old liabilities:", oldNegs);
      console.log("- New liabilities:", newNegs);
      console.log("- Old total liability (blocked):", oldMax);
      console.log("- New total liability (to block):", newMax);
      console.log("- Liability change:", liabInc);
      if (Object.keys(oldExposures).length === 0) balanceChange = newMax;
      else if (liabInc > 0) balanceChange = liabInc;
      else if (liabInc < 0) balanceChange = liabInc;
      if (balanceChange > 0 && currentInr < balanceChange) throw new Error("Bet not confirm check balance.");
    }
    console.log("FINAL BALANCE CHANGE:", balanceChange, "(+deduct, -release)");
    for (const [name, amt] of Object.entries(newExposures)) {
      await UserExposure_default.upsert(
        {
          user_id,
          match_id,
          team_name: name,
          exposure_amount: amt,
          match_title,
          game_type: exposureGameType,
          event_id: eventid,
          category: "sports"
        },
        { transaction }
      );
    }
    console.log("het");
    let singleBetLiability;
    if (market_type === "oddeven") {
      singleBetLiability = stake;
    } else if (market_type === "fancy1") {
      singleBetLiability = betTypeLower === "back" || betTypeLower === "yes" ? stake : stake * (oddN - 1);
    } else if (market_type === "Tied Match") {
      let new_odds = oddN / 100;
      singleBetLiability = betTypeLower === "back" ? stake : stake * new_odds;
    } else if (normGameType === "MO" || marketsfornonfancy.includes(market_type)) {
      singleBetLiability = betTypeLower === "back" ? stake : stake * (oddN - 1);
    } else if (normGameType === "MO" || normGameType === "BM") {
      const newodds = normalizeOdds(oddN);
      singleBetLiability = betTypeLower === "back" ? stake : stake * (newodds - 1);
    } else if (bigRunnerSessionMarket.test(market_type)) {
      singleBetLiability = betTypeLower === "back" || betTypeLower === "yes" ? stake : stake * (oddN - 1);
    } else if (isLineMarket(market_type)) {
      singleBetLiability = stake;
    } else if (isMeterMarket(market_type)) {
      singleBetLiability = meterLiability({ line: oddN, stake, betType: betTypeLower });
    } else if (isBadlo) {
      singleBetLiability = badloLiability({ stake, betType: betTypeLower });
    } else {
      singleBetLiability = betTypeLower === "back" || betTypeLower === "yes" ? stake : size * stake / 100;
    }
    console.log("tesr", singleBetLiability);
    let fixed = 0;
    if (!isFancyMarketType) {
      size = 0;
    }
    if (isLineMarket(market_type)) {
      size = 0;
    }
    if (isBadlo && !(Number(size) > 0)) {
      size = Number(betTypeLower === "yes" || betTypeLower === "back" ? back_size : lay_size) || 0;
    }
    size = Number.isFinite(Number(size)) ? Math.round(Number(size)) : 0;
    const storedGameType = isFancyMarketType ? "FAN" : normGameType;
    const finalBetType = (game_type === "FAN" || isFancyMarketType) && bet_type ? bet_type.toLowerCase() === "back" ? "yes" : bet_type.toLowerCase() === "lay" ? "no" : bet_type : bet_type;
    const startTime = match_start_time || /* @__PURE__ */ new Date();
    const newBet = await SportsBet_default.create(
      {
        user_id,
        game_type: storedGameType,
        match_id,
        match_title,
        team_one,
        team_two,
        selection_name,
        category: category || "1",
        bet_type: finalBetType,
        odds: oddN,
        stake_amount: stake,
        original_currency: currency.toUpperCase(),
        original_amount: currency_amount,
        // Server-side at the admin rate; the client's figure is never trusted.
        usd_amount: await inrToUsd(stake),
        liability: singleBetLiability,
        match_start_time: startTime,
        exposure_after_bet: Math.max(0, ...Object.values(newExposures).filter((v) => v < 0).map((v) => Math.abs(v)), 0),
        status: "open",
        eventid,
        ip_address,
        browser,
        fancy_name: fancy_name || "NULL",
        fixed,
        counts: count,
        sport_id: sid,
        fancy_name: fancy_name || "NULL",
        fixed,
        counts: count,
        sport_id: sid,
        market_type,
        // No matching engine: the buffer fills every accepted bet at the live price, so a
        // bet is never resting. The body's flag would make a filled bet refundable via /cancel-bet.
        unmatched: false,
        unmatched_odds: unmatched_odds || null,
        is_cashout: is_cashout === true,
        size,
        runners,
        gtype: gtype || null,
        badlo: isBadlo,
        league_name: effectiveLeagueName,
        // placeCombinedBet stamps both legs of a badlo swap with ONE time — they
        // are a single click, and the statement lists them as one pair.
        ...options.createdAt ? { created_at: options.createdAt } : {}
      },
      { transaction }
    );
    await walletUpdate(wallet, balanceChange, transaction, {
      user_id,
      match_title,
      selection_name,
      market_type,
      game_type,
      match_id,
      eventid,
      sid,
      newBet
    });
    const betExposureValues = Object.values(newExposures);
    console.log("NEW EXPOSURES FOR THIS BET:", newExposures);
    console.log("EXPOSURE VALUES:", betExposureValues);
    let betNetExposure = 0;
    if (betExposureValues.length > 0) {
      const minValue = Math.min(...betExposureValues);
      betNetExposure = minValue < 0 ? Math.abs(minValue) : 0;
    }
    console.log("NET EXPOSURE OF THIS BET:", betNetExposure);
    const exposureResults = await db_default.query(TOTAL_EXPOSURE_SQL, {
      replacements: { user_id },
      type: db_default.QueryTypes.SELECT,
      transaction
    });
    const totalUserExposure = parseFloat(exposureResults[0]?.total_exposure) || 0;
    console.log("Calculated Total User Exposure (Net):", totalUserExposure);
    await TotalExposure_default.upsert(
      {
        user_id,
        total_exposure: totalUserExposure
      },
      { transaction }
    );
    console.log(`\u2705 TotalExposure upserted for user ${user_id}: ${totalUserExposure}`);
    if (!externalTx) {
      await transaction.commit();
      pushBalance(user_id);
    }
    const newBalance = balanceChange !== 0 ? currentInr - balanceChange : currentInr;
    console.log("Transaction completed successfully");
    console.log("Old balance:", currentInr);
    console.log("New balance:", newBalance);
    console.log("Actual balance delta:", newBalance - currentInr);
    return res.json({
      success: true,
      exposure: { [match_id]: { match_title, teams: newExposures } },
      balanceDelta: newBalance - currentInr,
      oldBalance: currentInr,
      newBalance,
      totalExposure: totalUserExposure
    });
  } catch (err) {
    if (!externalTx) await transaction.rollback();
    console.error("PLACE BET ERROR:", err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
};
var MAX_COMBINED_LEGS = 10;
var makeLegRes = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  }
});
var placeCombinedBet = async (req, res) => {
  let transaction = null;
  try {
    const user_id = req.user?.account?.id;
    if (!user_id) return res.status(400).json({ success: false, error: "User ID is required" });
    const legs = Array.isArray(req.body?.bets) ? req.body.bets : null;
    if (!legs || legs.length < 2) {
      return res.status(400).json({ success: false, error: "A combined bet needs at least 2 selections" });
    }
    if (legs.length > MAX_COMBINED_LEGS) {
      return res.status(400).json({ success: false, error: `A combined bet supports at most ${MAX_COMBINED_LEGS} selections` });
    }
    const first = legs[0] || {};
    if (!legs.every((l) => String(l?.eventid) === String(first.eventid) && String(l?.match_id) === String(first.match_id))) {
      return res.status(400).json({ success: false, error: "All combined selections must belong to the same market" });
    }
    const badloErr = badloSlipError(legs);
    if (badloErr) return res.status(400).json({ success: false, error: badloErr });
    const isBadloSlip = legs.every((l) => isBadloLeg(l));
    const firstSide = String(first.bet_type || "").toLowerCase();
    if (!isBadloSlip && !legs.every((l) => String(l?.bet_type || "").toLowerCase() === firstSide)) {
      return res.status(400).json({ success: false, error: "All combined selections must be the same bet type (all back or all lay)" });
    }
    const selNames = legs.map((l) => String(l?.selection_name || "").trim());
    if (selNames.some((s) => !s)) {
      return res.status(400).json({ success: false, error: "Every combined selection needs a selection name" });
    }
    if (!isBadloSlip && new Set(selNames.map((s) => s.toLowerCase())).size !== selNames.length) {
      return res.status(400).json({ success: false, error: "Combined selections must be distinct runners" });
    }
    if (isBadloSlip) {
      const runs = legs.map((l) => Number(l?.odds));
      if (runs.some((r) => !Number.isFinite(r) || r <= 0)) {
        return res.status(400).json({ success: false, error: "Every badlo selection needs a run" });
      }
      if (new Set(runs).size !== runs.length) {
        return res.status(400).json({ success: false, error: "Badlo selections must be on distinct runs" });
      }
    }
    if (legs.some((l) => !Number.isFinite(Number(l?.stake_amount)) || Number(l?.stake_amount) <= 0)) {
      return res.status(400).json({ success: false, error: "Invalid stake on a combined selection" });
    }
    if (legs.some((l) => !Array.isArray(l?.runners) || !l.runners.length)) {
      return res.status(400).json({ success: false, error: "Combined selections are missing the runner list" });
    }
    const legCurrency = (l) => l?.currency ?? l?.original_currency;
    if (legs.some((l) => !legCurrency(l) || typeof legCurrency(l) !== "string")) {
      return res.status(400).json({ success: false, error: "currency is required" });
    }
    const rawStake = isBadloSlip ? Math.max(...legs.map((l) => Number(l.stake_amount))) : legs.reduce((s, l) => s + Number(l.stake_amount), 0);
    const totalStake = await toInr(rawStake, legCurrency(first));
    try {
      const limits = await resolveMarketLimits({
        eventid: first.eventid,
        sid: first.sid,
        match_id: first.match_id,
        mname: first.mname,
        market_type: first.market_type,
        selection_name: first.selection_name
      });
      if (limits) {
        console.log(`[placeCombinedBet] Limits for ${limits.marketName}: min=${limits.minLimit} max=${limits.maxLimit} total=${totalStake}`);
        if (limits.minLimit > 0 && totalStake < limits.minLimit) {
          return res.status(400).json({ success: false, error: `Minimum bet amount is ${limits.minLimit}` });
        }
        if (limits.maxLimit > 0 && totalStake > limits.maxLimit) {
          return res.status(400).json({ success: false, error: `Maximum bet amount is ${limits.maxLimit}` });
        }
      }
    } catch (limitErr) {
      console.warn("[placeCombinedBet] Market limits lookup failed (non-blocking):", limitErr.message);
    }
    for (const leg of legs) {
      const d = await checkBetLive(leg);
      if (!d.accept) {
        console.log(`[placeCombinedBet] \u2717 rejected user=${user_id} gmid=${leg.eventid} market=${leg.match_id} sel=${leg.selection_id} code=${d.code}`);
        return res.status(400).json({ success: false, error: `${leg.selection_name}: ${d.message}`, code: d.code });
      }
    }
    transaction = await db_default.transaction();
    const slipCreatedAt = isBadloSlip ? /* @__PURE__ */ new Date() : null;
    const legResults = [];
    for (const leg of legs) {
      const legReq = {
        user: req.user,
        headers: req.headers,
        connection: req.connection,
        ip: req.ip,
        body: leg
      };
      const legRes = makeLegRes();
      await placeBet(legReq, legRes, { transaction, skipMinStake: true, createdAt: slipCreatedAt });
      if (!legRes.body || legRes.body.success !== true) {
        const msg = legRes.body?.error || legRes.body?.message || "Bet rejected";
        throw new Error(`${leg.selection_name}: ${msg}`);
      }
      legResults.push(legRes.body);
    }
    await transaction.commit();
    transaction = null;
    pushBalance(user_id);
    const last = legResults[legResults.length - 1];
    return res.json({
      success: true,
      legs: legResults.length,
      exposure: last?.exposure,
      balanceDelta: legResults.reduce((s, r) => s + Number(r?.balanceDelta || 0), 0),
      newBalance: last?.newBalance,
      totalExposure: last?.totalExposure
    });
  } catch (err) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rbErr) {
        console.error("COMBINED BET ROLLBACK ERROR:", rbErr.message);
      }
    }
    console.error("PLACE COMBINED BET ERROR:", err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
};
var cancelBet = async (req, res) => {
  const transaction = await db_default.transaction();
  try {
    const user_id = req.user.account.id;
    if (!user_id) throw new Error("User ID is required");
    const { bet_id } = req.body;
    if (!bet_id) throw new Error("bet_id is required");
    const bet = await SportsBet_default.findOne({
      where: { id: bet_id },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!bet) {
      await transaction.rollback();
      return res.status(404).json({ success: false, error: "Bet not found" });
    }
    if (String(bet.user_id) !== String(user_id)) {
      await transaction.rollback();
      return res.status(403).json({ success: false, error: "Not your bet" });
    }
    if (bet.unmatched !== true) {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: "Only unmatched bets can be cancelled" });
    }
    if (bet.status !== "open") {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: `Bet is already ${bet.status}` });
    }
    if (bet.game_type !== "MO" && bet.game_type !== "BM") {
      await transaction.rollback();
      return res.status(400).json({ success: false, error: "Only match-odds unmatched bets can be cancelled" });
    }
    console.log(`[cancelBet] user=${user_id} bet=${bet_id} market=${bet.market_type} match=${bet.match_id}`);
    bet.status = "cancelled";
    bet.result_status = "cancelled";
    bet.updated_at = /* @__PURE__ */ new Date();
    await bet.save({ transaction });
    const cancelExpGameType = exposureIdentity({ marketType: bet.market_type, selectionName: bet.selection_name, badlo: isBadloBet(bet) }).game_type;
    const oldRows = await UserExposure_default.findAll({
      where: { user_id, match_id: bet.match_id, game_type: cancelExpGameType },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const oldExposures = {};
    oldRows.forEach((r) => oldExposures[r.team_name] = Number(r.exposure_amount));
    const remaining = await SportsBet_default.findAll({
      where: {
        user_id,
        match_id: bet.match_id,
        market_type: bet.market_type,
        badlo: isBadloBet(bet),
        status: "open"
      },
      order: [["created_at", "ASC"]],
      transaction
    });
    let replayed = {};
    for (const b of remaining) {
      const runners = Array.isArray(b.runners) ? b.runners : [];
      if (!runners.length) continue;
      const odd = b.game_type === "BM" ? normalizeOdds(Number(b.odds)) : Number(b.odds);
      replayed = calculateRunnerExposure({
        runners,
        selectedRunner: b.selection_name,
        stake: Number(b.stake_amount),
        odd,
        betType: (b.bet_type || "").toLowerCase(),
        oldExposures: replayed
      });
    }
    const newExposures = {};
    for (const name of /* @__PURE__ */ new Set([...Object.keys(oldExposures), ...Object.keys(replayed)])) {
      newExposures[name] = Number((replayed[name] || 0).toFixed(2));
    }
    console.log("[cancelBet] OLD EXPOSURES:", oldExposures);
    console.log("[cancelBet] RECOMPUTED EXPOSURES:", newExposures);
    for (const [name, amt] of Object.entries(newExposures)) {
      await UserExposure_default.upsert(
        {
          user_id,
          match_id: bet.match_id,
          team_name: name,
          exposure_amount: amt,
          match_title: bet.match_title,
          game_type: cancelExpGameType,
          event_id: bet.eventid,
          category: "sports"
        },
        { transaction }
      );
    }
    const oldNegs = Object.values(oldExposures).filter((x) => x < 0);
    const newNegs = Object.values(newExposures).filter((x) => x < 0);
    const oldMax = oldNegs.length ? Math.abs(Math.min(...oldNegs)) : 0;
    const newMax = newNegs.length ? Math.abs(Math.min(...newNegs)) : 0;
    const refund = Number((oldMax - newMax).toFixed(2));
    console.log(`[cancelBet] Liability: old=${oldMax} new=${newMax} refund=${refund}`);
    // OLD (Wallets.cash):
    /*
    const wallet = await Wallet_default.findOne({
      where: { user_id },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!wallet) throw new Error("Wallet not found");
    if (refund > 0) {
      wallet.cash = Number(wallet.cash || 0) + refund;
      if (isNaN(wallet.cash)) throw new Error("Balance calculation resulted in NaN");
      await wallet.save({ transaction });
    }
    const newBalance = Number(wallet.cash || 0);
    */
    // NEW (credits.inr): the cancelled liability goes back to the player's inr.
    const wallet = await Credits_default.findOne({
      where: { uid: user_id },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!wallet) throw new Error("Wallet not found");
    if (refund > 0) {
      wallet.inr = Number(wallet.inr || 0) + refund;
      if (isNaN(wallet.inr)) throw new Error("Balance calculation resulted in NaN");
      await wallet.save({ transaction });
    }
    const newBalance = Number(wallet.inr || 0);
    const exposureResults = await db_default.query(TOTAL_EXPOSURE_SQL, {
      replacements: { user_id },
      type: db_default.QueryTypes.SELECT,
      transaction
    });
    const totalUserExposure = parseFloat(exposureResults[0]?.total_exposure) || 0;
    await TotalExposure_default.upsert({ user_id, total_exposure: totalUserExposure }, { transaction });
    await transaction.commit();
    pushBalance(user_id);
    console.log(`[cancelBet] \u2705 bet=${bet_id} refund=${refund} newBalance=${newBalance} totalExposure=${totalUserExposure}`);
    return res.json({
      success: true,
      cancelled_bet_id: bet.id,
      refund,
      newBalance,
      totalExposure: totalUserExposure,
      exposure: { [bet.match_id]: { match_title: bet.match_title, teams: newExposures } }
    });
  } catch (err) {
    await transaction.rollback();
    console.error("CANCEL BET ERROR:", err.message);
    return res.status(400).json({ success: false, error: err.message });
  }
};
var getFancyBets = async (req, res) => {
  try {
    const user_id = req.user.account.id;
    const { runner, match_id, event_id, sport_id, market_type } = req.query;
    if (!runner || !match_id) {
      return res.status(400).json({ success: false, error: "Missing required parameters" });
    }
    const whereClause = {
      user_id,
      [Op6.or]: [
        { selection_name: { [Op6.iLike]: runner.trim() } },
        { fancy_name: { [Op6.iLike]: runner.trim() } }
      ],
      // match_id param carries the gmid, which bets persist in `eventid`
      eventid: String(event_id || match_id),
      status: "open"
    };
    if (sport_id) whereClause.sport_id = String(sport_id);
    if (market_type) whereClause.market_type = String(market_type);
    const bets = await SportsBet_default.findAll({
      where: whereClause,
      // market_type included so the client can spot fancy1/oddeven, where
      // `size` is market volume rather than a bhav
      // fancy_name carries the khado band width — the ladder needs it to draw
      // the win band (see prepareBetPayload).
      // `badlo` marks the EXACT-RUN legs: the ladder draws them as spikes, not
      // as the step every other session bet draws (helper/badloMarket.js).
      attributes: ["bet_type", "stake_amount", "odds", "size", "liability", "market_type", "fancy_name", "badlo"]
    });
    return res.json({ success: true, bets });
  } catch (err) {
    console.error("GET FANCY BETS ERROR:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
var controller = {
  placeBet,
  placeCombinedBet,
  cancelBet,
  getFancyBets
};
var sportbetscontroller_default = controller;

export { placeBet, sportbetscontroller_default };
