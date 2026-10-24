// controller/user/UserStatementController.js — mssports core, moved unchanged
// Wallets → credits: point_ledger.wallet_id now holds the player's credits.id.
// import { Wallet_default } from "../../../models/admin/Wallet.mjs";
import { Credits_default } from "../../../models/user/Credits.mjs";
import { User_default } from "../../../models/user/User.mjs";
import { UserStatementService_default } from "../services/UserStatementService.mjs";
import { DirectStatementService } from "../services/DirectStatementService.mjs";

var UserStatementController = {
  getAccountStatementV2: async (req, res) => {
    try {
      console.log("\u{1F4DD} [UserStatementController] getAccountStatementV2 request:", req.body);
      const id = req.user.user_id || req?.user?.account?.id;
      if (!id) {
        return res.status(401).json({ success: false, message: "User not authenticated or ID missing" });
      }
      const { reportType, fromDate, toDate, search, page, limit } = req.body || {};
      const rt = String(reportType || "ALL").toUpperCase().trim();
      if (!["ALL", "TRANSACTION", "SPORTS"].includes(rt)) {
        return res.status(400).json({ success: false, message: "reportType must be ALL, TRANSACTION or SPORTS" });
      }
      // OLD (Wallets.wallet_id):
      /*
      const wallet = await Wallet_default.findOne({
        where: { user_id: id },
        attributes: ["wallet_id", "username", "createdAt"],
        raw: true
      });
      */
      // NEW (credits.id): the wallet id point_ledger stores; the account's start date comes from
      // the mssports user row (credits has no timestamps).
      const wallet = await Credits_default.findOne({
        where: { uid: id },
        attributes: ["uid", "id"],
        raw: true
      });
      if (!wallet) {
        return res.status(404).json({ success: false, message: "Wallet not found" });
      }
      const account = await User_default.findByPk(id, { attributes: ["createdAt"], raw: true });
      const target = {
        id,
        username: req.user.username,
        // OLD: walletId: wallet.wallet_id,
        // OLD: createdAt: wallet.createdAt,
        walletId: wallet.id,
        createdAt: account?.createdAt || null,
        isDemo: !!req.user.isDemo
      };
      const result = await UserStatementService_default.getAccountStatementV2(target, { reportType: rt, fromDate, toDate, search, page, limit });
      return res.status(200).json(result);
    } catch (error) {
      console.error("\u274C [UserStatementController] getAccountStatementV2 Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
  /**
   * Direct user (koi parent nahi) ka statement — `point_ledger_direct` se (DirectStatementService).
   * Body: { fromDate, toDate, reportType: ALL|SPORTS|CASINO, currency?, search?, page?, limit? }.
   * Agent user ke liye nahi (unka `account-statement-v2`) — 403.
   */
  getDirectAccountStatement: async (req, res) => {
    try {
      const id = req.user.user_id || req?.user?.account?.id;
      if (!id) {
        return res.status(401).json({ success: false, message: "User not authenticated or ID missing" });
      }
      // mssports `users` is keyed `user_id` (there is no `id` column: asking for one was a 500).
      const user = await User_default.findByPk(id, { attributes: ["user_id", "parent_staff_id"], raw: true });
      if (!user) return res.status(404).json({ success: false, message: "User not found" });
      if (user.parent_staff_id != null) {
        return res.status(403).json({ success: false, message: "Agent users use /account-statement-v2" });
      }
      const { reportType, fromDate, toDate, currency, search, page, limit, view } = req.body || {};
      const rt = String(reportType || "ALL").toUpperCase().trim();
      if (!DirectStatementService.REPORT_TYPES.includes(rt)) {
        return res.status(400).json({ success: false, message: "reportType must be ALL, SPORTS, CASINO or TRANSACTION" });
      }
      if (currency != null && !/^[A-Za-z]{2,10}$/.test(String(currency))) {
        return res.status(400).json({ success: false, message: "currency must be a coin code like INR or USDT" });
      }
      const result = await DirectStatementService.getAccountStatement(
        { id, db: User_default.sequelize },
        { reportType: rt, fromDate, toDate, currency, search, page, limit, view: view === "pnl" ? "pnl" : "cash" }
      );
      return res.status(200).json(result);
    } catch (error) {
      console.error("\u274C [UserStatementController] getDirectAccountStatement Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
  /**
   * Result modal data for one SPORTS statement row:
   * us market ke saare bets + winner.
   * Input: matchId (= market/mid) + eventId (= match/gmid) — statement row se.
   */
  getStatementMarketBets: async (req, res) => {
    try {
      const id = req.user.user_id || req?.user?.account?.id;
      if (!id) {
        return res.status(401).json({ success: false, message: "User not authenticated or ID missing" });
      }
      const { matchId, eventId, fancyName } = req.body || {};
      if (!matchId || !eventId) {
        return res.status(400).json({ success: false, message: "matchId and eventId required" });
      }
      const result = await UserStatementService_default.getStatementMarketBets(
        { id, username: req.user.username },
        { matchId, eventId, fancyName }
      );
      if (!result?.success) return res.status(400).json(result);
      return res.status(200).json(result);
    } catch (error) {
      console.error("\u274C [UserStatementController] getStatementMarketBets Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
};
var UserStatementController_default = UserStatementController;

export { UserStatementController_default };
