// controller/user/OneClickButtonListController.js — mssports core, moved unchanged
import { OneClickButtonList_default } from "../../../models/user/OneClickButtonList.mjs";

var DEFAULT_BUTTONS = [100, 200, 300];
var tableReady2 = null;
var ensureTable2 = () => {
  if (!tableReady2) {
    tableReady2 = OneClickButtonList_default.sync().catch((e) => {
      tableReady2 = null;
      throw e;
    });
  }
  return tableReady2;
};
var OneClickButtonListController = {
  // GET /user/buttonlist — the user's 1-Click Betting stake values
  getButtonList: async (req, res) => {
    try {
      const userId = req.user.account.id;
      await ensureTable2();
      const row = await OneClickButtonList_default.findOne({ where: { user_id: userId } });
      const buttons = row && Array.isArray(row.buttons) && row.buttons.length === 3 ? row.buttons : DEFAULT_BUTTONS;
      res.status(200).json({ success: true, data: { buttons } });
    } catch (error) {
      console.error("Error fetching one-click button list:", error);
      res.status(500).json({ success: false, error: "Failed to fetch button list" });
    }
  },
  // POST /user/updatebuttonlist — save the user's 1-Click Betting stake values
  updateButtonList: async (req, res) => {
    try {
      const userId = req.user.account.id;
      const { buttons } = req.body;
      const clean = Array.isArray(buttons) ? buttons.map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0) : [];
      if (clean.length !== 3) {
        return res.status(400).json({ success: false, error: "buttons must be an array of 3 positive numbers" });
      }
      await ensureTable2();
      const [row] = await OneClickButtonList_default.findOrCreate({
        where: { user_id: userId },
        defaults: { buttons: clean }
      });
      if (JSON.stringify(row.buttons) !== JSON.stringify(clean)) {
        row.buttons = clean;
        await row.save();
      }
      res.status(200).json({
        success: true,
        message: "Button list updated successfully",
        data: { buttons: row.buttons }
      });
    } catch (error) {
      console.error("Error updating one-click button list:", error);
      res.status(500).json({ success: false, error: "Failed to update button list" });
    }
  }
};
var OneClickButtonListController_default = OneClickButtonListController;

export { OneClickButtonListController_default };
