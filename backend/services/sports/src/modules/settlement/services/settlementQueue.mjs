// sportsbet/betresult/settlementQueue.js — mssports core, moved unchanged
import { SportsBet_default } from "../../../models/user/SportsBet.mjs";
import { SportsEventSettlementJobs_default } from "../../../models/user/SportsEventSettlementJobs.mjs";

import IORedis from "ioredis";
import { Op as Op10 } from "sequelize";
var WAKE_CHANNEL = `sports-settle:wake:${process.env.DB_NAME || "default"}`;
var REARM_AFTER_MS = +(process.env.REARM_AFTER_MS || 2e4);
var noopLog = { info: () => {
}, error: () => {
}, debug: () => {
} };
var pub = null;
function getPublisher2(log = noopLog) {
  if (pub) return pub;
  try {
    pub = new IORedis({
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: +(process.env.REDIS_PORT || 6379),
      maxRetriesPerRequest: null
    });
    pub.on("error", (e) => log.error("[SettleQueue] redis wake error", { error: e.message }));
  } catch (e) {
    log.error("[SettleQueue] redis wake unavailable", { error: e.message });
    pub = null;
  }
  return pub;
}
async function wakeSettlement(count, log = noopLog) {
  const p = getPublisher2(log);
  if (!p) return;
  try {
    await p.publish(WAKE_CHANNEL, String(count));
    log.info("[SettleQueue] settlement worker woken", { count, channel: WAKE_CHANNEL });
  } catch (e) {
    log.error("[SettleQueue] wake publish failed", { error: e.message });
  }
}
async function enqueueSettlementJob(b, declared, log = noopLog) {
  const userId = String(b.user_id);
  const eid = String(b.eventid);
  const betIdStr = String(b.id);
  const betType = (b.bet_type || "").toString().toLowerCase() || "unknown";
  const payload = { user_id: userId, eventid: eid, bet_id: betIdStr, bet_type: betType, bet: b, match_over: declared };
  const now = /* @__PURE__ */ new Date();
  const pointBet = (jobId) => SportsBet_default.update(
    { job_id: jobId },
    { where: { id: b.id, status: { [Op10.in]: ["open", "manual"] } } }
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
async function enqueueManualBets({ eventid, match_id, market_type, log = noopLog }) {
  const where = { status: "manual", eventid: String(eventid) };
  if (match_id) where.match_id = String(match_id);
  if (market_type) where.market_type = market_type;
  const bets = await SportsBet_default.findAll({
    where,
    attributes: [
      "id",
      "user_id",
      "game_type",
      "bet_type",
      "selection_name",
      "odds",
      "stake_amount",
      "match_title",
      "match_id",
      "fancy_name",
      "eventid",
      "created_at",
      "sport_id",
      "market_type",
      "status",
      "team_one",
      "team_two",
      "runners",
      "job_id"
    ],
    order: [["created_at", "ASC"]]
  });
  let queued = 0;
  for (const b of bets) {
    try {
      const r = await enqueueSettlementJob(b, true, log);
      if (r?.action === "created" || r?.action === "re-armed") queued++;
    } catch (e) {
      log.error("[SettleQueue] manual enqueue failed", { betId: b.id, error: e.message });
    }
  }
  if (queued) await wakeSettlement(queued, log);
  log.info("[SettleQueue] manual declare queued", { eventid, match_id, market_type, bets: bets.length, queued });
  return { bets: bets.length, queued };
}

export { enqueueManualBets };
