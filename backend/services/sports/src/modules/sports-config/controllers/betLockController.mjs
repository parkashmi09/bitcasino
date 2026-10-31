// controller/admin/betLockController.js — mssports core, moved unchanged
import { User_default } from "../../../models/user/User.mjs";
import { Staff_default } from "../../../models/admin/Staff.mjs";
import { UserEventMarketLocks_default } from "../../../models/admin/UserEventMarketLocks.mjs";

import { Op as Op14 } from "sequelize";
var toBool = (value) => {
  return value === true || value === "true" || value === 1 || value === "1";
};
var successResponse = (res, message, data = null, count = null) => {
  const response = { success: true, message };
  if (data !== null) response.data = data;
  if (count !== null) response.count = count;
  return res.status(200).json(response);
};
var errorResponse = (res, message, status = 500) => {
  return res.status(status).json({ success: false, error: message });
};
var buildMarketWhere = (event_id, market_id, market_name) => {
  const where = { event_id: String(event_id) };
  if (market_id) {
    where.market_id = String(market_id);
  } else if (market_name) {
    where.market_name = market_name;
  }
  return where;
};
var getMarketLockChildren = async (req, res) => {
  try {
    const { event_id } = req.params;
    const { market_id, market_name } = req.query;
    const loggedInRole = req.user?.role?.toUpperCase();
    const loggedInId = req.user?.account?.id;
    console.log("[BetLock] getMarketLockChildren:", { event_id, market_id, market_name, loggedInRole, loggedInId });
    if (!event_id) {
      return errorResponse(res, "event_id is required", 400);
    }
    if (!market_id && !market_name) {
      return errorResponse(res, "market_id or market_name is required", 400);
    }
    let children = [];
    if (loggedInRole === "OWNER") {
      const staffChildren = await Staff_default.findAll({
        where: { parent_owner_id: loggedInId },
        attributes: ["staff_id", "username", "role", "level"],
        raw: true
      });
      const userChildren = await User_default.findAll({
        where: { parent_owner_id: loggedInId },
        attributes: ["user_id", "username"],
        raw: true
      });
      children = [
        ...staffChildren.map((s) => ({ id: s.staff_id, username: s.username, type: "staff", role: s.role, level: s.level })),
        ...userChildren.map((u) => ({ id: u.user_id, username: u.username, type: "user", role: "USER" }))
      ];
    } else {
      const staffChildren = await Staff_default.findAll({
        where: { parent_id: loggedInId },
        attributes: ["staff_id", "username", "role", "level"],
        raw: true
      });
      const userChildren = await User_default.findAll({
        where: { parent_staff_id: loggedInId },
        attributes: ["user_id", "username"],
        raw: true
      });
      children = [
        ...staffChildren.map((s) => ({ id: s.staff_id, username: s.username, type: "staff", role: s.role, level: s.level })),
        ...userChildren.map((u) => ({ id: u.user_id, username: u.username, type: "user", role: "USER" }))
      ];
    }
    const accountIds = children.map((c) => c.id);
    if (accountIds.length === 0) {
      return successResponse(res, "No children found", [], 0);
    }
    const lockWhere = {
      account_id: { [Op14.in]: accountIds },
      ...buildMarketWhere(event_id, market_id, market_name),
      is_locked: true
    };
    const existingLocks = await UserEventMarketLocks_default.findAll({
      where: lockWhere,
      attributes: ["account_id", "account_type"],
      raw: true
    });
    const lockedSet = new Set(existingLocks.map((l) => `${l.account_type}_${l.account_id}`));
    const result = children.map((c) => ({
      ...c,
      is_locked: lockedSet.has(`${c.type}_${c.id}`)
    }));
    return successResponse(res, "Market lock children retrieved", result, result.length);
  } catch (error) {
    console.error("getMarketLockChildren error:", error);
    return errorResponse(res, "Failed to fetch market lock children");
  }
};
var toggleMarketLock = async (req, res) => {
  try {
    const { account_id, account_type, event_id, market_id, market_name, is_locked } = req.body;
    const loggedInId = req.user?.account?.id;
    if (!account_id || !account_type || !event_id) {
      return errorResponse(res, "account_id, account_type, and event_id are required", 400);
    }
    if (!market_id && !market_name) {
      return errorResponse(res, "market_id or market_name is required", 400);
    }
    if (!["staff", "user"].includes(account_type)) {
      return errorResponse(res, "account_type must be 'staff' or 'user'", 400);
    }
    const lock = toBool(is_locked);
    const findWhere = {
      account_id,
      account_type,
      event_id: String(event_id),
      ...market_id ? { market_id: String(market_id) } : { market_name }
    };
    if (lock) {
      const [record, created] = await UserEventMarketLocks_default.findOrCreate({
        where: findWhere,
        defaults: {
          is_locked: true,
          locked_by: loggedInId,
          market_id: market_id ? String(market_id) : null,
          market_name: market_name || null
        }
      });
      if (!created) {
        await record.update({ is_locked: true, locked_by: loggedInId });
      }
      return successResponse(res, "Market locked successfully", record);
    } else {
      await UserEventMarketLocks_default.destroy({ where: findWhere });
      return successResponse(res, "Market unlocked successfully");
    }
  } catch (error) {
    console.error("toggleMarketLock error:", error);
    return errorResponse(res, "Failed to toggle market lock");
  }
};
var bulkToggleMarketLock = async (req, res) => {
  try {
    const { accounts, event_id, market_id, market_name, is_locked } = req.body;
    const loggedInId = req.user?.account?.id;
    console.log("[BetLock] bulkToggleMarketLock:", { accounts_count: accounts?.length, event_id, market_id, market_name, is_locked, loggedInId });
    if (!Array.isArray(accounts) || accounts.length === 0 || !event_id) {
      return errorResponse(res, "accounts array and event_id are required", 400);
    }
    if (!market_id && !market_name) {
      return errorResponse(res, "market_id or market_name is required", 400);
    }
    const lock = toBool(is_locked);
    let processed = 0;
    for (const acc of accounts) {
      const { account_id, account_type } = acc;
      if (!account_id || !account_type) continue;
      const findWhere = {
        account_id,
        account_type,
        event_id: String(event_id),
        ...market_id ? { market_id: String(market_id) } : { market_name }
      };
      if (lock) {
        const [record, created] = await UserEventMarketLocks_default.findOrCreate({
          where: findWhere,
          defaults: {
            is_locked: true,
            locked_by: loggedInId,
            market_id: market_id ? String(market_id) : null,
            market_name: market_name || null
          }
        });
        if (!created) {
          await record.update({ is_locked: true, locked_by: loggedInId });
        }
      } else {
        await UserEventMarketLocks_default.destroy({ where: findWhere });
      }
      processed++;
    }
    return successResponse(res, `${processed} accounts ${lock ? "locked" : "unlocked"} successfully`, null, processed);
  } catch (error) {
    console.error("bulkToggleMarketLock error:", error);
    return errorResponse(res, "Failed to bulk toggle market locks");
  }
};

export { getMarketLockChildren, toggleMarketLock, bulkToggleMarketLock };
