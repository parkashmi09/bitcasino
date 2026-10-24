// controller/user/StakeButtonValueController.js — mssports core, moved; verifies the platform's tokens
// (lib/identity/platformAccounts.mjs).
import { DEFAULT_GAME_BUTTONS, ensureTable, MAX_GAME_BUTTONS, cleanButtons, seedForUser } from "../services/StakeButtonService.mjs";

import { decodePlatformToken } from "../../../lib/identity/platformAccounts.mjs";
var playerIdFromToken = (req) => {
  try {
    const header = req.header("Authorization");
    if (!header) return null;
    const token = header.replace("Bearer ", "").trim();
    if (!token || token === "null" || token === "undefined") return null;
    const decoded = decodePlatformToken(token);
    if (decoded.user_id) return decoded.user_id;
    return decoded.account?.type === "USER" ? decoded.account.id : null;
  } catch {
    return null;
  }
};
var cleanGame = (list) => cleanButtons(list, DEFAULT_GAME_BUTTONS, MAX_GAME_BUTTONS);
var StakeButtonValueController = {
  // GET /user/stake-button-values
  // Logged in  → that user's own ladder (created with the defaults on first read).
  // Logged out → the defaults, with nothing written.
  getStakeButtonValues: async (req, res) => {
    try {
      const userId = playerIdFromToken(req);
      if (!userId) {
        return res.status(200).json({
          success: true,
          data: { game_buttons: DEFAULT_GAME_BUTTONS }
        });
      }
      const row = await seedForUser(userId);
      res.status(200).json({
        success: true,
        data: {
          game_buttons: cleanGame(row?.game_buttons)
        }
      });
    } catch (error) {
      console.error("Error fetching stake button values:", error);
      res.status(500).json({ success: false, error: "Failed to fetch button values" });
    }
  },
  // POST /user/stake-button-values — writes ONLY the caller's own row.
  updateStakeButtonValues: async (req, res) => {
    try {
      const userId = playerIdFromToken(req);
      if (!userId) {
        return res.status(403).json({ success: false, error: "Only a player account can set stake buttons" });
      }
      const { game_buttons } = req.body;
      if (!game_buttons) {
        return res.status(400).json({ success: false, error: "No data provided to update" });
      }
      await ensureTable();
      const row = await seedForUser(userId);
      if (!row) {
        return res.status(500).json({ success: false, error: "Failed to load button values" });
      }
      if (game_buttons) row.game_buttons = cleanGame(game_buttons);
      await row.save();
      res.status(200).json({
        success: true,
        data: {
          game_buttons: cleanGame(row.game_buttons)
        }
      });
    } catch (error) {
      console.error("Error updating stake button values:", error);
      res.status(500).json({ success: false, error: "Failed to update button values" });
    }
  }
};
var StakeButtonValueController_default = StakeButtonValueController;

export { StakeButtonValueController_default };
