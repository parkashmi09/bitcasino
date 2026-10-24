// sportsbet/betBufferRules.js — mssports core, moved unchanged
import { isLineMarket } from "../../../lib/helper/lineMarket.mjs";

var EPSILON = 1e-3;
var FANCY_EPSILON = 0.01;
var normalizeName = (s) => String(s || "").trim().toLowerCase();
var isLaySide = (betType) => betType === "lay" || betType === "no";
var feedSideFor = (betType, inverted = false) => {
  const lay = isLaySide(betType);
  return (inverted ? !lay : lay) ? "lay" : "back";
};
function isBlockedGameStatus(gs) {
  switch (gs) {
    case "SUSPENDED":
    case "BALL RUNNING":
    case "INACTIVE":
      return true;
    default:
      return false;
  }
}
function isBookieFavourMarket(marketType) {
  const mt = String(marketType || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return mt === "MATCHODDS" || mt === "BOOKMAKER" || mt === "BOOKMAKER2" || mt === "TIEDMATCH";
}
var findMarket = (marketList, marketId) => (marketList || []).find((m) => String(m?.mid) === String(marketId)) || null;
function findRunner(mkt, selectionId, runnerName) {
  if (!mkt?.section) return null;
  if (selectionId) {
    return mkt.section.find((s) => String(s.sid) === String(selectionId)) || null;
  }
  const wantNat = normalizeName(runnerName);
  return mkt.section.find((s) => normalizeName(s.nat) === wantNat) || (mkt.section.length === 1 ? mkt.section[0] : null);
}
var runnerGameStatus = (runner) => String(runner?.gstatus || "").toUpperCase() || String(runner?.status || "").toUpperCase();
var marketBlockedStatus = (mkt) => {
  if (!mkt || String(mkt.gtype || "").toLowerCase() === "match1") return null;
  const s = String(mkt.status || "").toUpperCase();
  return isBlockedGameStatus(s) ? s : null;
};
function readBufferTick({ marketList, marketId, selectionId, betType, feedSideInverted = false }) {
  const mkt = findMarket(marketList, marketId);
  if (!mkt?.section) return { state: "skip" };
  const mktStatus = marketBlockedStatus(mkt);
  if (mktStatus) return { state: "blocked", status: mktStatus };
  const runner = mkt.section.find((s) => String(s.sid) === String(selectionId));
  if (!runner?.odds) return { state: "skip" };
  const gs = runnerGameStatus(runner);
  if (isBlockedGameStatus(gs)) return { state: "blocked", status: gs };
  const feedSide = feedSideFor(betType, feedSideInverted);
  const bestObj = runner.odds.find((o) => String(o.otype || "").toLowerCase() === feedSide && (o.tno === 0 || o.oname === (feedSide === "lay" ? "lay1" : "back1")));
  if (!bestObj || !bestObj.odds || bestObj.odds <= 0) return { state: "blocked", status: "NO_ODDS" };
  return { state: "live", odds: Number(bestObj.odds), size: Number(bestObj.size) || 0 };
}
function finalSuspensionStatus({ marketList, marketId, selectionId, runnerName, strict = false }) {
  const mkt = findMarket(marketList, marketId);
  if (!mkt && strict) return "CLOSED";
  const mktStatus = marketBlockedStatus(mkt);
  if (mktStatus) return mktStatus;
  const runner = findRunner(mkt, selectionId, runnerName);
  if (!runner) return strict ? "CLOSED" : null;
  const gs = runnerGameStatus(runner);
  return isBlockedGameStatus(gs) ? gs : null;
}
function fancyOddsDrift({ marketList, marketId, runnerName, betType, selectedOdds, feedSideInverted = false, strict = false }) {
  const result = { mismatch: false, liveSize: null };
  const unconfirmed = () => strict ? { mismatch: true, liveSize: null, closest: null } : result;
  const mkt = findMarket(marketList, marketId);
  if (!mkt?.section) return unconfirmed();
  const wantNat = normalizeName(runnerName);
  let sectionFound = mkt.section.find((s) => normalizeName(s.nat) === wantNat);
  if (!sectionFound && mkt.section.length === 1) sectionFound = mkt.section[0];
  if (!sectionFound) return unconfirmed();
  const side = feedSideFor(betType, feedSideInverted);
  const oddsArr = sectionFound.odds || [];
  const sideTiers = oddsArr.filter((o) => String(o.otype || "").toLowerCase() === side).map((o) => Number(o.odds)).filter((n) => Number.isFinite(n) && n > 0);
  if (sideTiers.length === 0) return unconfirmed();
  const closest = sideTiers.reduce((best, curr) => Math.abs(curr - selectedOdds) < Math.abs(best - selectedOdds) ? curr : best);
  if (Math.abs(closest - selectedOdds) > FANCY_EPSILON) {
    result.mismatch = true;
    result.closest = closest;
    return result;
  }
  const liveObj = oddsArr.find((o) => String(o.otype || "").toLowerCase() === side && Math.abs(Number(o.odds) - closest) <= FANCY_EPSILON);
  if (liveObj?.size) result.liveSize = Number(liveObj.size);
  return result;
}
function deriveBufferFlags({ marketList, marketId }) {
  const mkt = findMarket(marketList, marketId);
  if (!mkt) return null;
  const gtype = normalizeName(mkt.gtype);
  const mname = mkt.mname || "";
  return {
    ownLine: gtype === "khado" || normalizeName(mname) === "khado",
    liveTracked: gtype === "match" || isBookieFavourMarket(mname),
    lineMarket: gtype === "fancy2" || isLineMarket(mname),
    marketType: mname
  };
}
function manualBetLiveCheck({ betType, editedOdds, liveOdds }) {
  const accept = isLaySide(betType) ? liveOdds <= editedOdds + EPSILON : liveOdds >= editedOdds - EPSILON;
  return { accept, finalOdds: liveOdds };
}
function autoBetCheck({ marketType, betType, selectedOdds, currentOdds }) {
  if (!isBookieFavourMarket(marketType)) return { accept: true, finalOdds: currentOdds };
  if (betType === "back" || betType === "yes") {
    return { accept: currentOdds >= selectedOdds - EPSILON, finalOdds: currentOdds };
  }
  if (isLaySide(betType)) {
    return { accept: currentOdds <= selectedOdds + EPSILON, finalOdds: currentOdds };
  }
  return { accept: true, finalOdds: currentOdds };
}
function readMarketList(body) {
  let node = body;
  for (let i = 0; i < 6 && node && typeof node === "object"; i++) {
    if (Array.isArray(node)) return node;
    node = node.data;
  }
  return Array.isArray(node) ? node : null;
}

export { isLaySide, readBufferTick, finalSuspensionStatus, fancyOddsDrift, deriveBufferFlags, manualBetLiveCheck, autoBetCheck, readMarketList };
