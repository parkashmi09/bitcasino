/* Ported from TENEXCH frontend/src/utils/cashoutUtil.js, unchanged.
 * TENEXCH (no Addaplay equivalent) — Addaplay has no cashout. */

// ─── Cashout engine — 2-runner hedge ─────────────────────────────────────────
// Pure math, no React/network. Computes ONE hedge bet that balances the user's
// book on a 2-runner market (Match Odds / Tied / Bookmaker):
//   PRIMARY  — LAY the higher-exposure runner at the best lay price
//   FALLBACK — BACK the lower-exposure runner at the best back price
// Candidates are tried safest-first; each must not worsen the worst-case
// exposure and must sit inside the market's stake limits.
//
// Stake formula: diff / divisor, where divisor is
//   decimal odds:  O          (profit multiplier + the unit stake)
//   percent odds:  (O/100)+1  (Tied always; Bookmaker when O >= 10)
//
// Exposure projection mirrors the backend placeBet walk:
//   mult = percent ? odds/100 : odds-1
//   BACK sel: sel += stake*mult, other -= stake
//   LAY  sel: sel -= stake*mult, other += stake

import { feedMaxStake } from './oddsHelpers';

const EPS = 0.01;

export function isCashoutEligibleMarket(mname, gtype) {
  // gtype-based: any match / match1 market is a valid hedge target
  // (Match Odds, Under/Over, Draw No Bet, Bookmaker, Tied, …). The exactly-2-
  // runner guard in marketHasCashoutPosition still excludes 3-way markets the
  // 2-runner hedge engine can't balance (e.g. 1X2 Home/Draw/Away).
  const g = String(gtype || '').toLowerCase();
  if (g === 'match' || g === 'match1') return true;
  // Fallback to name matching for feeds that don't stamp gtype consistently.
  const n = String(mname || '').toLowerCase();
  if (!n) return false;
  return /match[\s_]*odds/.test(n) || /tied/.test(n) || /bookmaker/.test(n);
}

// Best executable prices for one runner. Prefers the named best tier
// (back1/lay1); falls back to max back / min lay across tiers with odds > 1.
export function pickBestPrices(section) {
  const odds = section?.odds || [];
  const backs = odds.filter(o => (o.otype || '').toLowerCase() === 'back' && Number(o.odds) > 1);
  const lays = odds.filter(o => (o.otype || '').toLowerCase() === 'lay' && Number(o.odds) > 1);
  const back1 = backs.find(o => o.oname === 'back1');
  const lay1 = lays.find(o => o.oname === 'lay1');
  const bestBack = back1 || (backs.length ? backs.reduce((a, b) => (Number(b.odds) > Number(a.odds) ? b : a)) : null);
  const bestLay = lay1 || (lays.length ? lays.reduce((a, b) => (Number(b.odds) < Number(a.odds) ? b : a)) : null);
  return { bestBack, bestLay };
}

// BM-family multiplier — percent for EVERY quote, UNFLOORED (2.25 → 0.0225),
// no >=10 cutoff. Mirrors the backend walk exactly.
const percentMult = (o) => o / 100;

function projectExposures(exposures, runners, selection, betType, odds, stake, usePercent) {
  const mult = usePercent ? percentMult(odds) : odds - 1;
  const out = { ...exposures };
  for (const r of runners) {
    const prev = Number(exposures[r]) || 0;
    if (r === selection) {
      out[r] = betType === 'back' ? prev + stake * mult : prev - stake * mult;
    } else {
      out[r] = betType === 'back' ? prev - stake : prev + stake;
    }
  }
  return out;
}

/**
 * @param market    raw feed market (mname, gtype, min, max, maxb, section[])
 * @param exposures per-runner book for THIS market: { [runnerName]: number }
 * @returns {ok:true, betType, team, selectionId, odds, size, stake,
 *           projectedExposures, worstBefore, worstAfter, limits}
 *        | {ok:false, reason, stake?, limit?}
 */
export function buildMarketCashout({ market, exposures }) {
  const sections = market?.section || [];
  if (sections.length < 2 || !market?.mname) return { ok: false, reason: 'invalid_market' };

  const runners = sections.map(s => (s.nat || '').trim()).filter(Boolean);
  if (runners.length < 2) return { ok: false, reason: 'invalid_market' };
  const [rA, rB] = runners;

  const expA = Number(exposures?.[rA]) || 0;
  const expB = Number(exposures?.[rB]) || 0;
  if (expA === 0 && expB === 0) return { ok: false, reason: 'no_position' };

  const expMap = { [rA]: expA, [rB]: expB };
  const worstBefore = Math.min(expA, expB);
  if (Math.abs(expA - expB) < EPS) return { ok: false, reason: 'already_balanced' };

  const H = expA >= expB ? rA : rB; // drain the higher-exposure runner
  const L = expA >= expB ? rB : rA;
  const diff = expMap[H] - expMap[L];

  const mnameLower = String(market.mname).toLowerCase();
  const isTied = /tied/.test(mnameLower);
  const isBookmaker = /bookmaker/.test(mnameLower) || (market.gtype || '').toLowerCase() === 'match1';
  // Backend percents EVERY BM-family quote (no >=10 cutoff) — mirror it, or the
  // computed hedge stake won't balance the book the backend actually writes
  const isPercent = () => isTied || isBookmaker;

  const secOf = (name) => sections.find(s => (s.nat || '').trim() === name);

  const candidates = [];

  // PRIMARY — lay H at best lay
  const layObj = pickBestPrices(secOf(H)).bestLay;
  if (layObj) {
    const O = Number(layObj.odds);
    const usePercent = isPercent(O);
    // divisor = mult + 1 with the SAME (floored) mult the backend books at
    const divisor = usePercent ? percentMult(O) + 1 : O;
    const stake = Math.max(0, diff / divisor);
    if (stake > 0) {
      candidates.push({
        betType: 'lay', team: H, odds: O, size: Number(layObj.size) || 0, stake, usePercent,
        selectionId: secOf(H)?.sid,
      });
    }
  }

  // FALLBACK — back L at best back
  const backObj = pickBestPrices(secOf(L)).bestBack;
  if (backObj) {
    const O = Number(backObj.odds);
    const usePercent = isPercent(O);
    // divisor = mult + 1 with the SAME (floored) mult the backend books at
    const divisor = usePercent ? percentMult(O) + 1 : O;
    const stake = Math.max(0, diff / divisor);
    if (stake > 0) {
      candidates.push({
        betType: 'back', team: L, odds: O, size: Number(backObj.size) || 0, stake, usePercent,
        selectionId: secOf(L)?.sid,
      });
    }
  }

  if (candidates.length === 0) return { ok: false, reason: 'no_odds' };

  // Project each candidate, sort safest-first (highest resulting floor)
  for (const c of candidates) {
    c.projected = projectExposures(expMap, runners, c.team, c.betType, c.odds, c.stake, c.usePercent);
    c.worstAfter = Math.min(...runners.map(r => c.projected[r]));
  }
  candidates.sort((a, b) => b.worstAfter - a.worstAfter);

  // Limits: min = market.min; max = the feed cap the server enforces (feedMaxStake)
  const minLimit = Number(market.min) || 0;
  const maxLimit = feedMaxStake(market);

  let lastReject = { ok: false, reason: 'no_odds' };
  for (const c of candidates) {
    if (c.worstAfter + EPS < worstBefore) { lastReject = { ok: false, reason: 'worsens' }; continue; }
    const stake2 = Math.round(c.stake * 100) / 100;
    // NO min-stake check for cashout — the hedge stake is computed, not chosen
    // (reference: min-100 tied market opens a 99.02 cashout). Max still applies.
    if (maxLimit > 0 && stake2 > maxLimit) { lastReject = { ok: false, reason: 'above_max', stake: stake2, limit: maxLimit }; continue; }
    return {
      ok: true,
      betType: c.betType,
      team: c.team,
      selectionId: c.selectionId,
      odds: c.odds,
      size: c.size,
      stake: stake2,
      diff,                      // exposure gap the hedge must close
      usePercent: c.usePercent,  // BM/Tied percent pricing vs decimal
      projectedExposures: c.projected,
      worstBefore,
      worstAfter: c.worstAfter,
      limits: { min: minLimit, max: maxLimit },
    };
  }
  return lastReject;
}

// Reason → user-facing toast text (reference wording)
export function cashoutToastMessage(result) {
  switch (result?.reason) {
    case 'no_position': return 'No active bets to cashout';
    case 'already_balanced': return 'You are not eligible for cashout!';
    // Computed stake outside the market's Min/Max range — reference wording
    case 'below_min': return 'Bet Not Confirm Reason Min and Max Bet Range Not Valid.';
    case 'above_max': return 'Bet Not Confirm Reason Min and Max Bet Range Not Valid.';
    case 'no_odds':
    case 'worsens':
      return 'You are not eligible for cashout'
    default:
      return 'Cashout not available';
  }
}

// Per-runner book for one market out of the page-level `${mid}:${runner}` map
function marketExposureMap(market, matchExposures) {
  const mid = market?.mid != null ? String(market.mid).trim() : '';
  const exposures = {};
  for (const s of market?.section || []) {
    const nat = (s.nat || '').trim();
    if (!nat) continue;
    exposures[nat] = Number(matchExposures?.[`${mid}:${nat.toLowerCase()}`]) || 0;
  }
  return exposures;
}

// Button enable-state: the user actually holds a position on this market
export function marketHasCashoutPosition(market, matchExposures) {
  if (!isCashoutEligibleMarket(market?.mname, market?.gtype)) return false;
  if ((market?.section || []).length !== 2) return false;
  return Object.values(marketExposureMap(market, matchExposures)).some(v => v !== 0);
}

// Cashout click → either { error: toastText } or { betValue } ready for
// GameDetails.handleBetClick (opens PlaceBetPanel pre-filled, is_cashout on).
// The selection name sent is the UNTRIMMED section.nat — byte-identical to the
// runners array every bet payload builds from the same sections.
export function computeCashoutClick({ market, marketType, matchExposures, matchId, eventName }) {
  const exposures = marketExposureMap(market, matchExposures);
  const result = buildMarketCashout({ market, exposures });
  if (!result.ok) return { error: cashoutToastMessage(result) };

  const allSections = market.section || [];
  const chosen = allSections.find(s => (s.nat || '').trim() === result.team) || {};
  const rawTeamName = chosen.nat || result.team;
  const { bestBack, bestLay } = pickBestPrices(chosen);

  return {
    betValue: {
      odds: result.odds,
      betType: result.betType,
      team: rawTeamName,
      teamName: rawTeamName,
      marketType,
      market_type: marketType,
      market_id: market.mid,
      selectionId: chosen.sid,
      event_id: matchId,
      event_name: eventName || '',
      market_name: market.mname || '',
      mname: market.mname || '',
      gtype: market.gtype || '',
      section: allSections,
      runners: allSections.map(s => s.nat || ''),
      outcomes: allSections.map(s => s.nat || ''),
      team_one: allSections[0]?.nat || '',
      team_two: allSections[1]?.nat || '',
      min_stake: chosen.min || market.min || null,
      max_stake: chosen.max || market.max || null,
      maxb: market.maxb || null,
      back_size: bestBack?.size,
      lay_size: bestLay?.size,
      size: result.size,
      market,
      is_cashout: true,
      cashoutStake: result.stake,
      cashoutDiff: result.diff,
      cashoutPercent: result.usePercent,
    },
  };
}
