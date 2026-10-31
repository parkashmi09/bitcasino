// controller/admin/SportsLockController.js — mssports core, moved unchanged
import { User_default } from "../../../models/user/User.mjs";
import { Staff_default } from "../../../models/admin/Staff.mjs";
import { MESSAGES } from "../../../lib/constants/messages.mjs";
import { StaffSportsLock_default } from "../../../models/admin/StaffSportsLock.mjs";
import { UserSportsLock_default } from "../../../models/admin/UserSportsLock.mjs";
import { OWNER_UPLINE_NO, uplineNo } from "../../../lib/helper/uplineLevelNo.mjs";

import { Op as Op5 } from "sequelize";
var SportsLockController = {
  // Get locks for a target
  getSportsLocks: async (req, res) => {
    try {
      const { targetId } = req.params;
      const { type } = req.query;
      console.log("DEBUG getSportsLocks:", { targetId, type, reqUser: req.user });
      if (!targetId || !type) {
        return res.status(400).json({ success: false, message: "Missing targetId or type" });
      }
      let locks = [];
      if (type === "USER") {
        locks = await UserSportsLock_default.findAll({ where: { user_id: targetId } });
      } else if (type === "OWNER") {
        locks = await StaffSportsLock_default.findAll({ where: { owner_id: targetId } });
      } else {
        locks = await StaffSportsLock_default.findAll({ where: { staff_id: targetId } });
      }
      return res.status(200).json({
        success: true,
        data: locks
      });
    } catch (error) {
      console.error("Error fetching sports locks:", error);
      return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
  },
  // Update Lock (Toggle)
  updateSportsLock: async (req, res) => {
    try {
      const {
        targetId,
        targetType,
        // 'USER', 'STAFF', 'OWNER'
        sportId,
        seriesId,
        matchId,
        marketId,
        isLocked
      } = req.body;
      console.log("DEBUG updateSportsLock:", req.body, req.user);
      const loggedInId = req.user.account ? req.user.account.id : req.user.id;
      const loggedInRole = req.user.role;
      if (targetType === "OWNER") {
        if (loggedInRole !== "OWNER") {
          return res.status(403).json({ success: false, message: "Only Owner can manage Owner locks" });
        }
      }
      let lock;
      const sportIdStr = sportId ? String(sportId) : null;
      const seriesIdStr = seriesId ? String(seriesId) : null;
      const matchIdStr = matchId ? String(matchId) : null;
      const marketIdStr = marketId ? String(marketId) : null;
      const lockData = {
        sport_id: sportIdStr,
        series_id: seriesIdStr,
        match_id: matchIdStr,
        market_id: marketIdStr,
        is_locked: isLocked
      };
      const uniqueWhere = {
        sport_id: sportIdStr,
        series_id: seriesIdStr,
        match_id: matchIdStr,
        market_id: marketIdStr
      };
      if (targetType === "USER") {
        uniqueWhere.user_id = targetId;
        if (req.body.lockType) uniqueWhere.lock_type = req.body.lockType;
        lock = await UserSportsLock_default.findOne({ where: uniqueWhere });
        if (lock) {
          lock.is_locked = isLocked;
          await lock.save();
        } else {
          lock = await UserSportsLock_default.create({
            ...lockData,
            user_id: targetId,
            lock_type: req.body.lockType || (marketIdStr ? "MARKET" : matchIdStr ? "MATCH" : seriesIdStr ? "SERIES" : "SPORT")
          });
        }
      } else {
        if (targetType === "OWNER") {
          uniqueWhere.owner_id = targetId;
          uniqueWhere.staff_id = null;
          lockData.owner_id = targetId;
          lockData.staff_id = null;
        } else {
          uniqueWhere.staff_id = targetId;
          uniqueWhere.owner_id = null;
          lockData.staff_id = targetId;
          lockData.owner_id = null;
        }
        if (req.body.lockType) uniqueWhere.lock_type = req.body.lockType;
        lock = await StaffSportsLock_default.findOne({ where: uniqueWhere });
        if (lock) {
          lock.is_locked = isLocked;
          await lock.save();
        } else {
          lock = await StaffSportsLock_default.create({
            ...lockData,
            lock_type: req.body.lockType || (marketIdStr ? "MARKET" : matchIdStr ? "MATCH" : seriesIdStr ? "SERIES" : "SPORT")
          });
        }
      }
      return res.status(200).json({ success: true, data: lock });
    } catch (error) {
      console.error("Error updating sports lock:", error);
      if (error.name === "SequelizeUniqueConstraintError") {
        return res.status(400).json({ success: false, message: "Lock already exists, please refresh." });
      }
      return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
  },
  /**
   * Check if a bet is locked for a user via sports lock hierarchy.
   * Checks: User locks → Parent staff locks → up to Owner locks.
   * At each level checks: Sport → Series → Match → Market (broader lock blocks narrower).
   *
   * @param {number} userId - The user placing the bet
   * @param {string} sportId - Sport ID (e.g. "4" for Cricket)
   * @param {string|null} seriesId - Series/competition name (nullable)
   * @param {string|null} matchId - Match/event ID (nullable)
   * @param {string|null} marketId - Market ID (nullable)
   * @returns {{ allowed: boolean, message: string }}
   */
  // `options.transaction`: see BetLockService.isBettingAllowed — placeBet
  // passes its transaction so the check does not need a second connection.
  checkSportsLock: async (userId, sportId, seriesId, matchId, marketId, options = {}) => {
    const tx = options.transaction ? { transaction: options.transaction } : {};
    try {
      if (!userId || !sportId) return { allowed: true };
      const sportIdStr = String(sportId);
      const isBlockedByLocks = (locks) => {
        for (const lock of locks) {
          if (!lock.is_locked) continue;
          if (!lock.series_id && !lock.match_id && !lock.market_id) {
            return { blocked: true, reason: "Sport is locked" };
          }
          if (lock.series_id && !lock.match_id && !lock.market_id) {
            if (seriesId && String(lock.series_id) === String(seriesId)) {
              return { blocked: true, reason: "Series is locked" };
            }
          }
          if (lock.match_id && !lock.market_id) {
            if (matchId && String(lock.match_id) === String(matchId)) {
              return { blocked: true, reason: "Match is locked" };
            }
          }
          if (lock.market_id) {
            if (matchId && String(lock.match_id) === String(matchId) && marketId && String(lock.market_id) === String(marketId)) {
              return { blocked: true, reason: "Market is locked" };
            }
          }
        }
        return { blocked: false };
      };
      const userLocks = await UserSportsLock_default.findAll({
        where: { user_id: userId, sport_id: sportIdStr, is_locked: true },
        raw: true,
        ...tx
      });
      const userCheck = isBlockedByLocks(userLocks);
      const user = await User_default.findOne({
        where: { user_id: userId },
        attributes: ["parent_staff_id", "parent_owner_id"],
        raw: true,
        ...tx
      });
      if (!user) {
        return userCheck.blocked ? { allowed: false, message: MESSAGES.BET.GAME_LOCKED_CONTACT_UPLINE(OWNER_UPLINE_NO) } : { allowed: true };
      }
      const chain = [];
      let currentStaffId = user.parent_staff_id;
      while (currentStaffId) {
        const staff = await Staff_default.findOne({
          where: { staff_id: currentStaffId },
          attributes: ["parent_id", "level"],
          raw: true,
          ...tx
        });
        chain.push({ id: currentStaffId, level: staff?.level });
        currentStaffId = staff?.parent_id || null;
      }
      const staffIds = chain.map((s) => s.id);
      if (userCheck.blocked) {
        const n = chain.length ? uplineNo(chain[0].level) : OWNER_UPLINE_NO;
        return { allowed: false, message: MESSAGES.BET.GAME_LOCKED_CONTACT_UPLINE(n) };
      }
      if (staffIds.length > 0) {
        const staffLocks = await StaffSportsLock_default.findAll({
          where: {
            staff_id: { [Op5.in]: staffIds },
            sport_id: sportIdStr,
            is_locked: true
          },
          raw: true,
          ...tx
        });
        for (const s of chain) {
          const own = staffLocks.filter((l) => String(l.staff_id) === String(s.id));
          if (isBlockedByLocks(own).blocked) {
            return { allowed: false, message: MESSAGES.BET.GAME_LOCKED_CONTACT_UPLINE(uplineNo(s.level)) };
          }
        }
      }
      if (user.parent_owner_id) {
        const ownerLocks = await StaffSportsLock_default.findAll({
          where: { owner_id: user.parent_owner_id, staff_id: null, sport_id: sportIdStr, is_locked: true },
          raw: true,
          ...tx
        });
        const ownerCheck = isBlockedByLocks(ownerLocks);
        if (ownerCheck.blocked) {
          return { allowed: false, message: MESSAGES.BET.GAME_LOCKED_CONTACT_UPLINE(OWNER_UPLINE_NO) };
        }
      }
      return { allowed: true };
    } catch (error) {
      console.error("\u274C checkSportsLock error:", error);
      return { allowed: true };
    }
  }
};
var SportsLockController_default = SportsLockController;

export { SportsLockController_default };
