// middleware/authMiddleware.js — mssports core, moved; the one change: tokens are verified as the
// platform's own (lib/identity/platformAccounts.mjs) instead of with TENEXCH's JWT_SECRET.
import { User_default } from "../../models/user/User.mjs";
import { Staff_default } from "../../models/admin/Staff.mjs";
import { Owner_default } from "../../models/admin/Owner.mjs";
import { isTokenBlacklisted } from "../helper/tokenBlacklist.mjs";
import { Executive_default } from "../../models/Executive.mjs";

import { verifyPlatformToken } from "../identity/platformAccounts.mjs";
var authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    if (!authHeader) return res.status(401).json({ error: "Access denied. No token provided." });
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token || token === "null" || token === "undefined") {
      return res.status(401).json({ error: "Access denied. No valid token provided." });
    }
    if (await isTokenBlacklisted(token)) {
      return res.status(401).json({ error: "Token invalidated. Please log in again." });
    }
    // A write (bet placement) re-reads the player's live state — see verifyPlatformToken.
    const decoded = await verifyPlatformToken(token, { refresh: !["GET", "HEAD", "OPTIONS"].includes(req.method) });
    // An executive works only on the admin routes, where the platform's staff auth ran first (req.staff)
    // and each route checks the executive's granted permission. Elsewhere it would act with its parent's
    // full powers, so it is refused.
    if (decoded.platform_executive_id && Number(req.staff?.executiveId) !== Number(decoded.platform_executive_id)) {
      return res.status(403).json({ error: "Executive accounts can use the sports admin screens only." });
    }
    let actor = decoded.actor;
    let account = decoded.account;
    if (!actor || !account) {
      if (decoded.owner_id) {
        actor = { type: "OWNER", id: decoded.owner_id };
        account = { type: "OWNER", id: decoded.owner_id };
      } else if (decoded.staff_id) {
        actor = { type: "STAFF", id: decoded.staff_id };
        account = { type: "STAFF", id: decoded.staff_id };
      } else if (decoded.user_id) {
        actor = { type: "USER", id: decoded.user_id };
        account = { type: "USER", id: decoded.user_id };
      }
    }
    req.user = {
      actor,
      account,
      role: decoded.role?.toUpperCase(),
      level: decoded.level || null,
      username: decoded.username || null,
      permissions: decoded.permissions || null,
      platformStaffId: decoded.platform_staff_id ?? null,
      platformExecutiveId: decoded.platform_executive_id ?? null
    };
    if (req.user.actor?.type === "EXECUTIVE") {
      const executive = await Executive_default.findByPk(req.user.actor.id);
      if (!executive || executive.active === false) {
        return res.status(401).json({ error: "Executive account is disabled. Access denied." });
      }
      req.user.permissions = executive.permissions || {};
      req.user.role = (executive.role || req.user.role || "").toUpperCase();
      const parent = executive.parent_type === "OWNER" ? await Owner_default.findByPk(executive.parent_id) : await Staff_default.findByPk(executive.parent_id);
      if (!parent) {
        return res.status(401).json({ error: "Parent account not found. Access denied." });
      }
      if (executive.parent_type === "STAFF" && parent.active === false) {
        return res.status(401).json({ error: "Account is inactive. Access denied." });
      }
      req.user.username = parent.username;
      req.user.level = parent.level ?? null;
      console.log(
        `\u2705 Authenticated | actor=EXECUTIVE:${executive.id} | account=${req.user.account.type}:${req.user.account.id} | role=${req.user.role} | as=${parent.username}`
      );
      return next();
    }
    if (req.user.account?.type === "USER") {
      const user = await User_default.findByPk(req.user.account.id);
      if (!user || user.status !== "Active") {
        return res.status(401).json({ error: "Account is inactive. Access denied." });
      }
      if (user.login_id && decoded.sid !== user.login_id) {
        return res.status(401).json({ error: "Session expired. You have been logged out because your account was used on another device." });
      }
      if (user.is_demo && user.demo_expires_at && new Date(user.demo_expires_at).getTime() <= Date.now()) {
        return res.status(401).json({ error: "Demo session expired. Please login again.", demoExpired: true });
      }
      req.user.isDemo = !!user.is_demo;
    }
    if (req.user.account?.type === "STAFF") {
      const staff = await Staff_default.findByPk(req.user.account.id);
      if (!staff || req.user.role !== "OWNER" && !staff.active) {
        return res.status(401).json({ error: "Account is inactive. Access denied." });
      }
      if (staff.login_id && decoded.sid !== staff.login_id) {
        return res.status(401).json({ error: "Session expired. You have been logged out because your account was used on another device." });
      }
    }
    if (req.user.account?.type === "OWNER") {
      const owner = await Owner_default.findByPk(req.user.account.id);
      if (owner && owner.login_id && decoded.sid !== owner.login_id) {
        return res.status(401).json({ error: "Session expired. You have been logged out because your account was used on another device." });
      }
    }
    console.log(
      `\u2705 Authenticated | actor=${req.user.actor.type}:${req.user.actor.id} | account=${req.user.account.type}:${req.user.account.id} | role=${req.user.role}`
    );
    next();
  } catch (err) {
    console.error("\u274C authMiddleware error:", err.message);
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired. Please log in again." });
    }
    return res.status(401).json({ error: "Invalid or malformed token. Please log in again." });
  }
};
var authMiddleware_default = authMiddleware;

export { authMiddleware_default };
