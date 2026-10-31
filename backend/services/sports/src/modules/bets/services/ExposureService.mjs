// services/ExposureService.js — mssports core, moved unchanged
import { init_db } from "../../../lib/config/db.mjs";
import { TotalExposure_exports, init_TotalExposure } from "../../../models/user/TotalExposure.mjs";
import { UserExposure_default } from "../../../models/user/UserExposure.mjs";

init_db();
init_TotalExposure();
async function getUserTotalExposure(user_id) {
  const TotalExposure2 = (await Promise.resolve().then(() => (init_TotalExposure(), TotalExposure_exports))).default;
  const record = await TotalExposure2.findOne({ where: { user_id } });
  if (record) {
    return parseFloat(record.total_exposure);
  }
  return null;
}
async function getexpossurebyid(user_id, match_id) {
  const { Op: Op16 } = await import("sequelize");
  return await UserExposure_default.findAll({
    where: {
      user_id,
      [Op16.or]: [
        { match_id },
        { event_id: match_id }
      ]
    }
  });
}
async function getUserExposures(userId) {
  const rows = await UserExposure_default.findAll({
    where: { user_id: Number(userId) },
    raw: true
  });
  const exposures = {};
  for (const row of rows) {
    const matchId = row.match_id;
    const teamName = row.team_name;
    const amount = Number(row.exposure_amount || 0);
    if (!exposures[matchId]) {
      exposures[matchId] = {
        match_title: row.match_title || "",
        teams: {}
      };
    }
    const current = Number(exposures[matchId].teams[teamName] || 0);
    exposures[matchId].teams[teamName] = current + amount;
  }
  return exposures;
}

export { getUserTotalExposure, getexpossurebyid, getUserExposures };
