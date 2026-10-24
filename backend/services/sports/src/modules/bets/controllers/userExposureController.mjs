// controller/user/userExposureController.js — mssports core, moved unchanged
import { UserExposure_default } from "../../../models/user/UserExposure.mjs";
import { getexpossurebyid, getUserExposures } from "../services/ExposureService.mjs";

var ExposureController = {
  getAllExposuresForUser: async (req, res) => {
    try {
      const { user_id } = req.body;
      if (!user_id) {
        return res.status(400).json({
          success: false,
          error: "User ID (uuid) is required"
        });
      }
      const exposures = await getUserExposures(user_id);
      return res.status(200).json({
        success: true,
        exposures
      });
    } catch (error) {
      console.error("\u274C getAllExposuresForUser error:", error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },
  // 🎯 Get Exposure By User & Match (POST body)
  getExposureById: async (req, res) => {
    try {
      const { user_id, match_id } = req.body;
      if (!user_id || !match_id) {
        return res.status(400).json({
          success: false,
          error: "user_id and match_id are required"
        });
      }
      const exposureData = await getexpossurebyid(user_id, match_id);
      return res.status(200).json({
        success: true,
        message: "Exposure data fetched successfully",
        data: exposureData
      });
    } catch (error) {
      console.error("\u274C Get exposure error:", error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  },
  // 🎯 Get Exposure By Query Params (GET)
  getExposureByQuery: async (req, res) => {
    try {
      const { match_id } = req.query;
      const user_id = req.user?.account?.id;
      if (!match_id) {
        return res.status(400).json({
          success: false,
          error: "match_id is required"
        });
      }
      if (!user_id) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized"
        });
      }
      const { Op: Op16 } = await import("sequelize");
      const exposureData = await UserExposure_default.findAll({
        where: {
          user_id,
          [Op16.or]: [
            { match_id },
            { event_id: match_id }
          ]
        }
      });
      return res.status(200).json({
        success: true,
        message: "Exposure data fetched successfully",
        data: exposureData
      });
    } catch (error) {
      console.error("\u274C Get exposure by query error:", error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
};
var userExposureController_default = ExposureController;

export { userExposureController_default };
