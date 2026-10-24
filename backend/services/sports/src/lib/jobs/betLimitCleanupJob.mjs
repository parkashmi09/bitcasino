// jobs/betLimitCleanupJob.js — mssports core, moved unchanged
import { BetLimitOverride_default } from "../../models/admin/BetLimitOverride.mjs";
import { BettingConfigService_default } from "../services/BettingConfigService.mjs";
import { CricketService_default } from "../services/CricketService.mjs";

import cron from "node-cron";
import { Op as Op2 } from "sequelize";
var GRACE_MINUTES = Number(process.env.BET_LIMIT_GRACE_MINUTES) || 4;
var collectEventIds = (nodes, out) => {
  for (const node of nodes || []) {
    if (node?.gmid) out.add(String(node.gmid));
    if (Array.isArray(node?.children)) collectEventIds(node.children, out);
  }
  return out;
};
var runBetLimitCleanup = async () => {
  const rows = await BetLimitOverride_default.findAll({
    where: { scope: "sports" },
    attributes: ["id", "sport_id", "event_id", "ended_at"],
    raw: true
  });
  if (!rows.length) return { checked: 0, stamped: 0, revived: 0, deleted: 0 };
  const sportIds = [...new Set(rows.map((r) => r.sport_id).filter((id) => id != null))];
  const liveBySport = /* @__PURE__ */ new Map();
  await Promise.all(sportIds.map(async (sportId) => {
    try {
      const board = await CricketService_default.fetchCricketData(sportId);
      const t1 = Array.isArray(board?.data?.t1) ? board.data.t1 : [];
      const t2 = Array.isArray(board?.data?.t2) ? board.data.t2 : [];
      const ids = collectEventIds([...t1, ...t2], /* @__PURE__ */ new Set());
      if (ids.size) liveBySport.set(String(sportId), ids);
    } catch (err) {
      console.warn(`[betLimitCleanup] board fetch failed for sport ${sportId}:`, err.message);
    }
  }));
  const now = Date.now();
  const cutoff = new Date(now - GRACE_MINUTES * 60 * 1e3);
  const toStamp = [];
  const toRevive = [];
  const toDelete = [];
  const affectedEvents = /* @__PURE__ */ new Set();
  for (const row of rows) {
    const live = row.sport_id == null ? null : liveBySport.get(String(row.sport_id));
    if (!live) continue;
    if (live.has(String(row.event_id))) {
      if (row.ended_at) toRevive.push(row.id);
      continue;
    }
    if (!row.ended_at) {
      toStamp.push(row.id);
    } else if (new Date(row.ended_at) <= cutoff) {
      toDelete.push(row.id);
      affectedEvents.add(String(row.event_id));
    }
  }
  if (toRevive.length) {
    await BetLimitOverride_default.update({ ended_at: null }, { where: { id: { [Op2.in]: toRevive } } });
  }
  if (toStamp.length) {
    await BetLimitOverride_default.update({ ended_at: new Date(now) }, { where: { id: { [Op2.in]: toStamp } } });
  }
  if (toDelete.length) {
    await BetLimitOverride_default.destroy({ where: { id: { [Op2.in]: toDelete } } });
    await Promise.all(
      [...affectedEvents].map((eventId) => BettingConfigService_default.invalidateEventLimits(eventId))
    );
    console.log(
      `[betLimitCleanup] removed ${toDelete.length} override(s) from ${affectedEvents.size} finished event(s)`
    );
  }
  return {
    checked: rows.length,
    stamped: toStamp.length,
    revived: toRevive.length,
    deleted: toDelete.length
  };
};
cron.schedule("* * * * *", async () => {
  try {
    await runBetLimitCleanup();
  } catch (err) {
    console.error("[betLimitCleanup] run failed:", err.message);
  }
});
console.log(`[betLimitCleanup] scheduled \u2014 finished-match overrides purged after ${GRACE_MINUTES} min`);
