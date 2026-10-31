// sportsbet/betBuffer.js — mssports core, moved unchanged
import { BettingConfigService_default } from "../../../lib/services/BettingConfigService.mjs";
import { MESSAGES } from "../../../lib/constants/messages.mjs";
import { placeBet } from "../controllers/sportbetscontroller.mjs";
import { isLineMarket } from "../../../lib/helper/lineMarket.mjs";
import { isBadloBet, isBadloLeg } from "../../../lib/helper/badloMarket.mjs";
import { leagueNameForBet } from "../../../lib/services/SportsLeagueResolver.mjs";
import { isHiddenSport, isHiddenLeague } from "../../../lib/constants/hiddenSports.mjs";
import { isLaySide, readBufferTick, finalSuspensionStatus, fancyOddsDrift, deriveBufferFlags, feedRunners, khadoQuote, manualBetLiveCheck, autoBetCheck } from "./betBufferRules.mjs";
import { liveOdds_default } from "./liveOdds.mjs";
import { cleanRef, betInflight_default } from "./betInflight.mjs";

var BUFFER_ENABLED = String(process.env.SERVER_SIDE_BET_BUFFER ?? "true").toLowerCase() !== "false";
var FAIL_CLOSED = String(process.env.BET_FEED_FAIL_CLOSED ?? "true").toLowerCase() !== "false";
var LIVE_DEFAULT_SECONDS = Number(process.env.BET_BUFFER_DEFAULT_SECONDS) || 5;
var FANCY_DEFAULT_SECONDS = Number(process.env.FANCY_BUFFER_DEFAULT_SECONDS) || 3;
var MAX_AGE_MS = Number(process.env.LIVE_ODDS_MAX_AGE_MS) || 5e3;
var FIRST_POLL_WAIT_MS = 3e3;
var TICK_MS = 500;
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var round2 = (n) => Math.round(n * 100) / 100;
var bool = (v) => v === true || v === "true";
var reject = (message, code) => ({ accept: false, message, code });
var liveList = (gmid) => {
  const { list, ageMs } = liveOdds_default.snapshot(gmid);
  return list && ageMs <= MAX_AGE_MS ? list : null;
};
async function resolveBufferSeconds(body, sb, liveTracked) {
  let leagueName = null;
  try {
    leagueName = await leagueNameForBet(body.sid, body.eventid, body.league_name);
  } catch {
    leagueName = body.league_name || null;
  }
  const configured = await BettingConfigService_default.getSportsBufferSeconds(
    body.sid,
    { gtype: sb.gtype, market_type: sb.mname, badlo: body.badlo, league_name: leagueName },
    { allowGlobalFallback: liveTracked }
  ).catch(() => 0);
  if (configured > 0) return configured;
  return liveTracked ? LIVE_DEFAULT_SECONDS : FANCY_DEFAULT_SECONDS;
}
async function runBetBuffer(body, sb, opts = {}) {
  const noWait = opts.noWait === true;
  const gmid = body.eventid;
  const marketId = body.match_id;
  const selectionId = body.selection_id;
  const betType = body.bet_type;
  const slipOdds = Number(body.odds) || 0;
  const selectedOdds = Number(sb.selected_odds) || slipOdds;
  const isCashout = body.is_cashout === true;
  const badlo = isBadloBet(body) || String(body.market_type || "").toLowerCase() === "badlo";
  const runnerName = sb.runner_name || body.nat || body.fancy_name || body.selection_name;
  const stake = Number(body.stake_amount) || 0;
  const canPoll = gmid && body.sid;
  if (FAIL_CLOSED && (!canPoll || !marketId)) return reject(MESSAGES.BET.GAME_SUSPEND, "NO_MARKET_REF");
  const bufferSeconds = noWait ? 0 : await resolveBufferSeconds(body, sb, bool(sb.live_tracked));
  const started = Date.now();
  let finalSize = Number(sb.initial_size) || 0;
  let blocked = false;
  let ticks = 0;
  let liveTicks = 0;
  const firstPoll = canPoll ? liveOdds_default.acquire(gmid, body.sid) : null;
  try {
    if (marketId && selectionId && bufferSeconds > 0 && canPoll) {
      const deadline = started + bufferSeconds * 1e3;
      while (Date.now() + TICK_MS <= deadline) {
        await sleep(TICK_MS);
        ticks++;
        const list2 = liveList(gmid);
        if (!list2) continue;
        const tick = readBufferTick({
          marketList: list2,
          marketId,
          selectionId,
          betType,
          feedSideInverted: bool(sb.line_market)
        });
        if (tick.state === "blocked") {
          blocked = true;
          break;
        }
        if (tick.state !== "live") continue;
        liveTicks++;
        finalSize = tick.size;
      }
      if (!blocked) {
        const rest = deadline - Date.now();
        if (rest > 0) await sleep(rest);
      }
    }
    if (canPoll && !liveList(gmid)) await Promise.race([firstPoll, sleep(FIRST_POLL_WAIT_MS)]);
    const list = canPoll ? liveList(gmid) : null;
    if (!list && marketId) {
      if (FAIL_CLOSED) {
        console.warn(`[betBuffer] FEED MISS gmid=${gmid} market=${marketId} \u2014 rejected (fail closed)`);
        return reject(MESSAGES.BET.GAME_SUSPEND, "FEED_UNAVAILABLE");
      }
      console.warn(`[betBuffer] FEED MISS gmid=${gmid} market=${marketId} \u2014 checks skipped (fail open, BET_FEED_FAIL_CLOSED=false)`);
    }
    const feedFlags = list ? deriveBufferFlags({ marketList: list, marketId }) : null;
    const flags = feedFlags || (FAIL_CLOSED ? null : {
      ownLine: bool(sb.own_line),
      liveTracked: bool(sb.live_tracked),
      lineMarket: bool(sb.line_market),
      marketType: sb.market_type
    });
    if (list && !flags) {
      if (FAIL_CLOSED) return reject(MESSAGES.BET.GAME_SUSPEND, "SUSPENDED:CLOSED");
    }
    const ownLine = Boolean(flags?.ownLine) || badlo;
    const lineMarket = Boolean(flags?.lineMarket);
    const liveTracked = Boolean(flags?.liveTracked) && !ownLine && !lineMarket;
    const edited = bool(sb.edited) && liveTracked;
    const runners = list && marketId ? feedRunners({ marketList: list, marketId }) : null;
    if (runners && liveTracked && !runners.includes(String(body.selection_name ?? ""))) {
      return reject(MESSAGES.BET.GAME_SUSPEND, "RUNNER_NOT_IN_MARKET");
    }
    if (feedFlags && isLineMarket(body.market_type) && !feedFlags.lineMarket) {
      return reject(MESSAGES.BET.GAME_SUSPEND, "MARKET_TYPE_MISMATCH");
    }
    // Settlement reads the band only when market_type is "khado"; any other label on a khado market settles as a plain line.
    if (feedFlags && (body.market_type === "khado") !== feedFlags.ownLine) {
      return reject(MESSAGES.BET.GAME_SUSPEND, "MARKET_TYPE_MISMATCH");
    }
    if (list && marketId) {
      const gs = finalSuspensionStatus({ marketList: list, marketId, selectionId, runnerName, strict: FAIL_CLOSED });
      if (gs) return reject(gs === "BALL RUNNING" ? MESSAGES.BET.BALL_RUNNING : MESSAGES.BET.GAME_SUSPEND, `SUSPENDED:${gs}`);
    }
    // Khado: line and band must be the feed's, the rate is the feed's (yes only: lay1 is the band, not a price).
    if (feedFlags?.ownLine) {
      const q = khadoQuote({ marketList: list, marketId, selectionId });
      if (!q || isLaySide(betType)) return reject(MESSAGES.BET.GAME_SUSPEND, "KHADO_NO_QUOTE");
      if (Math.abs(q.line - slipOdds) > 1e-3 || Number(body.fancy_name) !== q.band) {
        return reject(MESSAGES.BET.ODDS_CHANGED, `KHADO_DRIFT:${slipOdds}/${body.fancy_name}->${q.line}/${q.band}`);
      }
      finalSize = q.rate;
    }
    if (list && !liveTracked && !ownLine && marketId) {
      const drift = fancyOddsDrift({
        marketList: list,
        marketId,
        runnerName,
        betType,
        selectedOdds: slipOdds,
        feedSideInverted: lineMarket,
        strict: FAIL_CLOSED
      });
      if (drift.mismatch) return reject(MESSAGES.BET.ODDS_CHANGED, `FANCY_DRIFT:${slipOdds}->${drift.closest}`);
      if (drift.liveSize) finalSize = drift.liveSize;
    }
    if (blocked) return reject(MESSAGES.BET.GAME_SUSPEND, "BLOCKED_IN_BUFFER");
    let finalOdds = slipOdds;
    if (liveTracked && list) {
      const tick = readBufferTick({ marketList: list, marketId, selectionId, betType, feedSideInverted: false });
      if (tick.state === "live") {
        finalOdds = tick.odds;
        finalSize = tick.size;
      } else if (FAIL_CLOSED) {
        return reject(MESSAGES.BET.GAME_SUSPEND, `NO_LIVE_PRICE:${tick.status || tick.state}`);
      }
    }
    let finalStake = stake;
    if (ownLine) {
      finalOdds = slipOdds;
    } else if (isCashout) {
      const live = liveTracked && finalOdds > 0 ? finalOdds : slipOdds;
      const diff = Number(sb.cashout_diff) || 0;
      if (diff > 0 && Math.abs(live - slipOdds) > 1e-3) {
        const divisor = bool(sb.cashout_percent) ? live / 100 + 1 : live;
        finalStake = round2(diff / divisor);
        const maxStake = Number(sb.max_stake) || 0;
        if (!(finalStake > 0) || maxStake > 0 && finalStake > maxStake) {
          return reject(MESSAGES.BET.RANGE_NOT_VALID, "CASHOUT_RANGE");
        }
      }
      finalOdds = live;
    } else if (edited) {
      const manual = manualBetLiveCheck({ betType, editedOdds: slipOdds, liveOdds: finalOdds });
      if (!manual.accept) return reject(MESSAGES.BET.UNMATCHED_NOT_ALLOWED, `MANUAL_LIMIT:${slipOdds}/${finalOdds}`);
      finalOdds = manual.finalOdds;
    } else {
      const auto = autoBetCheck({ marketType: flags?.marketType ?? sb.market_type, priceGuarded: flags?.priceGuarded, betType, selectedOdds, currentOdds: finalOdds });
      if (!auto.accept) return reject(MESSAGES.BET.ODDS_CHANGE_NOT_CONFIRMED, `ODDS_MOVED:${selectedOdds}->${finalOdds}`);
      finalOdds = auto.finalOdds;
    }
    return { accept: true, odds: finalOdds, size: finalSize, stake: finalStake, runners, bufferSeconds, ticks, liveTicks };
  } finally {
    if (canPoll) liveOdds_default.release(gmid);
  }
}
function applyDecision(body, d) {
  const odds = Number(Number(d.odds).toFixed(2));
  body.odds = odds;
  body.user_rate = odds;
  // shortcut: with BET_FEED_FAIL_CLOSED=false and no feed, the slip's runners are kept.
  if (d.runners) {
    body.runners = d.runners;
    body.team_one = d.runners[0] || "";
    body.team_two = d.runners[1] || "";
  }
  if (d.size > 0) {
    body.size = d.size;
    if (body.bet_type === "back" || body.bet_type === "yes") body.back_size = d.size;
    if (isLaySide(body.bet_type)) body.lay_size = d.size;
  }
  if (d.stake !== Number(body.stake_amount)) {
    const stake = Number(Number(d.stake).toFixed(2));
    body.stake_amount = stake;
    body.original_amount = stake;
    body.amount = stake;
  }
}
var placeBetBuffered = async (req, res) => {
  // Sports / leagues this site does not offer (Politics, E Games, Virtual Cricket) are refused outright.
  if (isHiddenSport(req.body?.sid) || isHiddenLeague(null, req.body?.league_name)) {
    return res.status(400).json({ success: false, error: "This market is not available" });
  }
  // A lone badlo leg is a yes with no liability; badlo only goes through /place-combined.
  if (isBadloLeg(req.body)) {
    return res.status(400).json({ success: false, error: "A badlo yes needs a matching badlo no" });
  }
  let sb = req.body?.server_buffer;
  if (req.body) delete req.body.server_buffer;
  if (isLineMarket(req.body?.market_type)) {
    sb = {
      ...sb && typeof sb === "object" ? sb : {},
      line_market: true,
      own_line: false,
      live_tracked: false,
      edited: false
    };
  }
  const noWait = !sb || typeof sb !== "object" || !BUFFER_ENABLED;
  if (!sb || typeof sb !== "object") sb = {};
  const userId = req.user?.account?.id;
  const ref = cleanRef(sb.client_ref);
  if (ref) {
    const existing = betInflight_default.begin(userId, ref);
    if (existing) {
      if (existing.state === "pending") {
        return res.status(409).json({ success: false, pending: true, error: MESSAGES.BET.BET_ALREADY_PENDING });
      }
      return res.status(existing.status || 200).json({ ...existing.body, duplicate: true });
    }
  }
  let decision = null;
  const sendJson = res.json.bind(res);
  res.json = (payload) => {
    let out = payload;
    if (payload?.success && decision?.accept) {
      out = { ...payload, odds: Number(Number(decision.odds).toFixed(2)), stake: decision.stake, client_ref: ref };
    }
    if (ref) betInflight_default.finish(userId, ref, out, res.statusCode);
    return sendJson(out);
  };
  const t0 = Date.now();
  try {
    decision = await runBetBuffer(req.body, sb, { noWait });
  } catch (err) {
    console.error("[betBuffer] decision error:", err);
    return res.status(500).json({ success: false, error: "Bet placement failed" });
  }
  const tag = `user=${userId} gmid=${req.body.eventid} market=${req.body.match_id} sel=${req.body.selection_id} ${req.body.bet_type} ref=${ref || "-"} ${Date.now() - t0}ms`;
  if (!decision.accept) {
    console.log(`[betBuffer] \u2717 rejected ${tag} code=${decision.code}`);
    return res.status(400).json({ success: false, error: decision.message, code: decision.code });
  }
  console.log(`[betBuffer] \u2713 decided ${tag} X=${sb.selected_odds} slip=${req.body.odds} \u2192 ${decision.odds} stake=${req.body.stake_amount}\u2192${decision.stake} size=${decision.size} buffer=${decision.bufferSeconds}s ticks=${decision.liveTicks}/${decision.ticks}`);
  applyDecision(req.body, decision);
  return placeBet(req, res);
};
async function checkBetLive(body) {
  const sb = isLineMarket(body?.market_type) ? { line_market: true } : {};
  const d = await runBetBuffer(body, sb, { noWait: true });
  if (d.accept) applyDecision(body, d);
  return d;
}
var getBetResult = async (req, res) => {
  const userId = req.user?.account?.id;
  const ref = cleanRef(req.params.client_ref);
  if (!ref) return res.status(400).json({ success: false, error: "Invalid client_ref" });
  const e = betInflight_default.get(userId, ref);
  if (!e) return res.json({ success: true, state: "unknown" });
  return res.json({
    success: true,
    state: e.state,
    message: e.state === "rejected" ? e.body?.error || e.body?.message || null : null,
    odds: e.body?.odds ?? null,
    stake: e.body?.stake ?? null
  });
};

export { placeBetBuffered, checkBetLive, getBetResult };
