// services/admin/ActivityLogService.js — mssports core, moved unchanged
import { UserActivityLog_default } from "../../models/admin/UserActivityLog.mjs";

var ActivityLogService = {
  /**
   * Log a user activity
   * @param {Object} params
   * @param {Object} params.req - Express request object (to extract IP and User Agent)
   * @param {Object} params.user - User object (should contain id, username, role/user_type)
   * @param {string} params.action - Action name (e.g., 'LOGIN', 'PASSWORD_CHANGE')
   * @param {string} [params.details] - Optional details
   */
  log: async ({ req, user, action, details = null }) => {
    try {
      const ip_address = req.headers["x-forwarded-for"] || req.socket.remoteAddress || req.ip;
      const browser_detail = req.headers["user-agent"];
      let user_type = "USER";
      if (user.role === "OWNER") {
        user_type = "OWNER";
      } else if (user.role && user.role !== "USER") {
        user_type = "STAFF";
      } else if (user.user_type) {
        user_type = user.user_type;
      }
      let userIdField = {};
      if (user_type === "OWNER") {
        userIdField = { owner_id: user.id || user.owner_id };
      } else if (user_type === "STAFF") {
        userIdField = { staff_id: user.id || user.staff_id };
      } else {
        userIdField = { user_id: user.id || user.user_id };
      }
      await UserActivityLog_default.create({
        username: user.username,
        ...userIdField,
        user_type,
        action,
        ip_address,
        browser_detail,
        details: typeof details === "object" ? JSON.stringify(details) : details
      });
      console.log(`\u{1F4DD} Activity Logged: ${user.username} - ${action}`);
    } catch (error) {
      console.error("\u274C Failed to log activity:", error.message);
    }
  },
  /**
   * Get logs with filters and pagination
   */
  getLogs: async ({ startDate, endDate, logType, userId, userType, page = 1, limit = 10 }) => {
    try {
      const { Op: Op16 } = await import("sequelize");
      const offset = (page - 1) * limit;
      const where = {};
      if (startDate && endDate) {
        where.createdAt = {
          [Op16.between]: [new Date(startDate), /* @__PURE__ */ new Date(endDate + "T23:59:59.999Z")]
        };
      }
      if (logType) {
        where.action = logType;
      }
      if (userId && userType) {
        where.user_type = userType;
        if (userType === "OWNER") where.owner_id = userId;
        else if (userType === "STAFF") where.staff_id = userId;
        else where.user_id = userId;
      }
      const { count, rows } = await UserActivityLog_default.findAndCountAll({
        where,
        order: [["createdAt", "DESC"]],
        limit: parseInt(limit),
        offset: parseInt(offset)
      });
      return {
        total: count,
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page),
        logs: rows
      };
    } catch (error) {
      console.error("\u274C Failed to fetch logs:", error.message);
      throw error;
    }
  }
};
var ActivityLogService_default = ActivityLogService;

export { ActivityLogService_default };
