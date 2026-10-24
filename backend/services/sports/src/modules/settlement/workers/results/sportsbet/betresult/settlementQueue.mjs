// sportsbet/betresult/settlementQueue.js — mssports results worker, moved unchanged
import { SportsEventSettlementJobs_default } from "../../models/user/SportsEventSettlementJobs.mjs";
import { SportsBet_default } from "../../models/user/SportsBet.mjs";

import IORedis from "ioredis";
import { Op as Op2 } from "sequelize";
var WAKE_CHANNEL = `sports-settle:wake:${process.env.DB_NAME || "default"}`;
var REARM_AFTER_MS = +(process.env.REARM_AFTER_MS || 2e4);
var noopLog = { info: () => {
}, error: () => {
}, debug: () => {
} };
var pub = null;
function getPublisher(log2 = noopLog) {
  if (pub) return pub;
  try {
    pub = new IORedis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: +(process.env.REDIS_PORT || 6379),
      maxRetriesPerRequest: null
    });
    pub.on("error", (e) => log2.error("[SettleQueue] redis wake error", { error: e.message }));
  } catch (e) {
    log2.error("[SettleQueue] redis wake unavailable", { error: e.message });
    pub = null;
  }
  return pub;
}
async function wakeSettlement(count, log2 = noopLog) {
  const p = getPublisher(log2);
  if (!p) return;
  try {
    await p.publish(WAKE_CHANNEL, String(count));
    log2.info("[SettleQueue] settlement worker woken", { count, channel: WAKE_CHANNEL });
  } catch (e) {
    log2.error("[SettleQueue] wake publish failed", { error: e.message });
  }
}
async function enqueueSettlementJob(b, declared, log2 = noopLog) {
  const userId = String(b.user_id);
  const eid = String(b.eventid);
  const betIdStr = String(b.id);
  const betType = (b.bet_type || "").toString().toLowerCase() || "unknown";
  const payload = { user_id: userId, eventid: eid, bet_id: betIdStr, bet_type: betType, bet: b, match_over: declared };
  const now = /* @__PURE__ */ new Date();
  const pointBet = (jobId) => SportsBet_default.update(
    { job_id: jobId },
    { where: { id: b.id, status: { [Op2.in]: ["open", "manual"] } } }
  );
  const existing = await SportsEventSettlementJobs_default.findOne({
    where: { user_id: userId, eventid: eid, bet_id: betIdStr },
    attributes: ["job_id", "status", "updated_at"]
  });
  if (existing && (existing.status === "queued" || existing.status === "processing")) {
    if (String(b.job_id || "") !== String(existing.job_id)) await pointBet(existing.job_id);
    return { jobId: existing.job_id, action: "already-live" };
  }
  if (existing) {
    const age = Date.now() - new Date(existing.updated_at).getTime();
    if (age < REARM_AFTER_MS) return { jobId: existing.job_id, action: "cooldown" };
    await existing.update({ status: "queued", run_after: now, updated_at: now, error_msg: null, payload });
    await pointBet(existing.job_id);
    return { jobId: existing.job_id, action: "re-armed" };
  }
  let job;
  try {
    job = await SportsEventSettlementJobs_default.create({
      user_id: userId,
      eventid: eid,
      bet_id: betIdStr,
      bet_type: betType,
      status: "queued",
      priority: 5,
      run_after: now,
      payload,
      created_at: now,
      updated_at: now
    });
  } catch (e) {
    if (e.name === "SequelizeUniqueConstraintError") return { action: "race-skip" };
    throw e;
  }
  await pointBet(job.job_id);
  return { jobId: job.job_id, action: "created" };
}

export { WAKE_CHANNEL, wakeSettlement, enqueueSettlementJob };
