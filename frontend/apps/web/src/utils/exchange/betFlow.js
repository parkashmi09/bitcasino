/* ─── The bet slip's decisions, composed from both sources ─────────────────────────────────
 *
 * Pure — no React, no network, no toasts. A slip screen calls, in order:
 *
 *   const bv  = buildBetValue({ market, section, betType, odds, match, sid })   // on cell click
 *   const err = prevalidateBet({ bv, stake, odds, originalOdds, isUserModifiedOdds,
 *                                match, markets, signedIn })                    // on Place
 *   if (err) → toast err.message, stop
 *   if (!beginBetSubmit(betMarketKey(bv))) → toast MULTIPLE_BET_NOT_ALLOWED, stop
 *   const { payload, clientRef } = buildPlaceRequest({ bv, odds, stake, isEdited })
 *   await placeBet(payload)   (services/exchange)  … finally endBetSubmit(key)
 *
 * The buffer, the final suspension read, the fancy drift and the bookie-favour decision are NOT
 * done here: mssports runs them ON THE SERVER (`placeBetBuffered`, TENEXCH betBuffer.js) from
 * the `server_buffer` block this file attaches. `evaluateBookieFavour` / `readLiveSide` /
 * `isFancyDriftAcceptable` (addaplay.js) stay available for a slip that wants to PREVIEW them.
 */

import {
  addaplayMarketTitle,
  isVirtualEvent,
  validateUnmatchedOdds,
  readLiveSide,
  violatesRateCap,
  resolveStakeLimits,
  betMarketKey,
} from './addaplay';
import { prepareBetPayload } from './betHelpers';
import { isBallRunning, feedMaxStake } from './oddsHelpers';
import { isBookmakerStyle, isOddsLockedByType, isLaySide, namesOwnLine, MIN_BET_AMOUNT } from './placeBetRules';
import { isBookieFavourMarket } from './bookieFavour';
import { BET_TOAST } from './betToastMessages';

export const SPORT_NAME_BY_SID = { 1: 'Soccer', 2: 'Tennis', 4: 'Cricket', 10: 'HorseRace', 65: 'Greyhound' };

const FANCY_GTYPES = ['fancy', 'fancy1', 'fancy2', 'khado', 'oddeven', 'meter', 'normal', 'cricketcasino'];

/**
 * The clicked-cell snapshot + event enrichment. TENEXCH (no Addaplay equivalent for the mssports
 * payload fields): Market2Block.jsx:57-84 `buildBetValue` + GameDetails.jsx:467-500 enrichment,
 * plus the two fields Addaplay's slip reads (`runnerName`, `marketId`, MatchDetail.jsx:157-173).
 *
 * @param {object} p
 * @param {object} p.market   raw feed market (from useMatchMarkets)
 * @param {object} p.section  the clicked runner (market.section[i])
 * @param {'back'|'lay'|'yes'|'no'} p.betType
 * @param {number} p.odds     the clicked rung's odds
 * @param {number} [p.size]   the clicked rung's size
 * @param {object} p.match    header from useMatchHeader ({ gmid, ename, cname, stime })
 * @param {number|string} p.sid sport id
 */
export function buildBetValue({ market, section, betType, odds, size, match, sid }) {
  const allSections = market?.section || [];
  const best = (side) => (section?.odds || []).find((o) => o.oname === `${side}1`);
  const mtype = String(market?.gtype || '').toLowerCase();
  const mnameLower = String(market?.mname || '').toLowerCase();
  const isFancy = FANCY_GTYPES.includes(mtype);
  const isTied = mtype === 'match1' && mnameLower.includes('tied');
  const isBookmaker = !isTied && (mtype === 'match1' || mnameLower === 'bookmaker');
  const gmid = match?.gmid;
  const limits = resolveStakeLimits(market, section);
  return {
    odds,
    betType,
    team: section?.nat || '',
    teamName: section?.nat || '',
    runnerName: section?.nat || '',
    marketType: market?.mname || '',
    market_type: market?.mname || '',
    market_id: market?.mid,
    marketId: market?.mid,
    selectionId: section?.sid,
    event_id: gmid,
    event_name: match?.ename || '',
    match_title: match?.ename || '',
    league_name: match?.cname || '',
    match_start_time: match?.stime || '',
    market_name: market?.mname || '',
    mname: market?.mname || '',
    gtype: market?.gtype || '',
    section: allSections,
    runners: allSections.map((s) => s.nat || ''),
    outcomes: allSections.map((s) => s.nat || ''),
    team_one: allSections[0]?.nat || '',
    team_two: allSections[1]?.nat || '',
    min: limits.min,
    max: limits.max,
    min_stake: section?.min || market?.min || null,
    max_stake: section?.max || market?.max || null,
    maxb: market?.maxb || null,
    back_size: best('back')?.size,
    lay_size: best('lay')?.size,
    size: size ?? (isLaySide(betType) ? best('lay')?.size : best('back')?.size) ?? 0,
    sid: String(sid ?? ''),
    sports: SPORT_NAME_BY_SID[String(sid)] || 'Cricket',
    game_type: (isFancy || isTied) ? 'FANCY' : isBookmaker ? 'BOOKMAKER' : 'MATCH',
    market,
  };
}

/** Can the slip's odds be edited at all? TENEXCH (Addaplay's slip never edits odds). */
export function isOddsEditable(bv) {
  return bv?.gtype === 'match' && !isOddsLockedByType(bv?.marketType, bv?.mname)
    && !isBookmakerStyle(bv?.gtype, bv?.mname);
}

/**
 * The stake range a slip enforces — TENEXCH usePlaceBetPanel.js:258-281. Min: the ₹100 floor or
 * the feed's own min when higher (meter: its feed min as-is, the floor only when it quotes none;
 * a cashout hedge: none). Max: the shaped cap (`bv.max`, applyMatchOddsLimits already folded maxb
 * in), and 0 there means TENEXCH's 100000 default rather than "no ceiling".
 */
export function stakeLimits(bv) {
  const feedMin = Number(bv?.min) || 0;
  const meter = String(bv?.gtype || '').toLowerCase() === 'meter';
  const min = bv?.is_cashout ? 0 : meter ? (feedMin > 0 ? feedMin : MIN_BET_AMOUNT) : Math.max(MIN_BET_AMOUNT, feedMin);
  const rawMax = Number(bv?.max) || 0;
  return { min, max: rawMax > 0 ? rawMax : 100000 };
}

export const isRacingSid = (sid) => String(sid) === '10' || String(sid) === '65';

/**
 * Pre-submit checks, Addaplay's order (BetSlip.jsx:478-510) with the TENEXCH checks Addaplay
 * lacks appended. Returns null when the bet may go, else `{ code, message }`.
 *
 *   1 signed in                      Addaplay   'Please log in to place bets'
 *   2 virtual event                  Addaplay   'Betting not allowed on virtual events'
 *   3 pre-match MO cap 0/1 (not racing)   TENEXCH   'Game Not Active2.'
 *   4 absurd stake (≥1e16 / ≥1e12)   TENEXCH
 *   5 stake within stakeLimits       TENEXCH    'Check Minimum Bet Limit.' / 'Check Maximum Bet Limit1.'
 *                                               (racing at a cap of 1: 'Check Maximum Bet Limit.')
 *   6 manual odds edit               Addaplay   'Unmatched bet not allowed'
 *   7 odds sanity (decimal >1.01 ≤1000, BM >0 ≤100000)   TENEXCH (no Addaplay equivalent)
 *   8 runner still active            Addaplay (+ ball running, this layer's improvement)
 *   9 rate cap 4.00 cricket MO       Addaplay
 * (The in-flight anti-spam check is `beginBetSubmit`, which owns state.)
 */
export function prevalidateBet({ bv, stake, odds, originalOdds, isUserModifiedOdds = false, match, markets, signedIn }) {
  const fail = (code, message) => ({ code, message });
  if (!signedIn) return fail('NOT_SIGNED_IN', 'Please log in to place bets');
  if (isVirtualEvent(match)) return fail('VIRTUAL', 'Betting not allowed on virtual events');

  const racing = isRacingSid(bv?.sid);
  const mkt = bv?.market;
  // TENEXCH usePlaceBetPanel.js:580-608: the feed's pre-match cap (umaxbof 0/1, folded into max)
  // means MATCH_ODDS is not open yet — the reference answers this, not a limit message.
  if (!racing && String(bv?.gtype || '').toLowerCase() === 'match' && String(bv?.mname || '').toUpperCase() === 'MATCH_ODDS'
    && (Number(mkt?.maxb) === 1 || (mkt?.umaxbof !== undefined && (Number(mkt?.max) || 0) <= 1))) {
    return fail('GAME_NOT_ACTIVE_2', BET_TOAST.GAME_NOT_ACTIVE_2);
  }

  const stakeNum = Number(stake) || 0;
  if (stakeNum >= 1e16) return fail('ABSURD_SERVER', BET_TOAST.SERVER_ERROR);
  if (stakeNum >= 1e12) return fail('ABSURD_INVALID', BET_TOAST.BET_NOT_VALID);
  const { min, max } = stakeLimits(bv);
  if (stakeNum < min) return fail('BELOW_MIN', BET_TOAST.MIN_BET_LIMIT);
  if (stakeNum > max) return fail('ABOVE_MAX', racing && max <= 1 ? BET_TOAST.MAX_BET_LIMIT_RACING : BET_TOAST.MAX_BET_LIMIT);

  const side = bv?.betType === 'yes' ? 'back' : bv?.betType === 'no' ? 'lay' : bv?.betType;
  const unmatchedErr = validateUnmatchedOdds(odds, originalOdds, side, isUserModifiedOdds);
  if (unmatchedErr) return fail('UNMATCHED', unmatchedErr);

  const o = Number(odds) || 0;
  const bm = isBookmakerStyle(bv?.gtype, bv?.mname);
  const lineFamily = ['fancy', 'fancy2', 'khado', 'meter'].includes(String(bv?.gtype || '').toLowerCase());
  const valid = lineFamily ? o > 0 : (bm ? o > 0 && o <= 100000 : o > 1.01 - 1e-9 && o <= 1000);
  if (!valid) return fail('INVALID', BET_TOAST.INVALID_BET);

  const live = readLiveSide(markets, bv, side);
  const liveRunner = (markets || []).find((m) => String(m.mid) === String(bv?.market_id))
    ?.section?.find((s) => String(s.sid) === String(bv?.selectionId));
  if (liveRunner && isBallRunning(liveRunner)) return fail('BALL_RUNNING', BET_TOAST.BALL_RUNNING);
  if (live.found && live.suspended) return fail('SUSPENDED', 'Bet Not Confirm Reason Game Not Active.');

  const marketTitle = addaplayMarketTitle(bv?.mname);
  if (violatesRateCap(odds, { sid: bv?.sid, cname: match?.cname ?? bv?.league_name }, marketTitle)) {
    return fail('RATE_CAP', 'Bet Not Accept Rate Over 4.00 on Oneday and T20');
  }
  return null;
}

/** A unique id per submit, sent as `server_buffer.client_ref` (TENEXCH utils/pendingBet.js). */
export function newClientRef() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  } catch { /* insecure context */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The POST /place body. TENEXCH (no Addaplay equivalent for THIS backend): Addaplay's body
 * (BetSlip.jsx:183-219) targets a different server (`/api/v1/sports/bets/`, `game_type` MO/BM/FAN,
 * no `selection_id`, no `server_buffer`); mssports' `placeBetBuffered` reads TENEXCH's
 * `prepareBetPayload` shape plus `server_buffer` (usePlaceBetPanel.js:759-776).
 *
 * @param {object} p
 * @param {object} p.bv        from buildBetValue (or a cashout betValue from computeCashoutClick)
 * @param {number} p.odds      the price sent: E when the user edited it, else the clicked X
 * @param {number} p.stake
 * @param {boolean} [p.isEdited] the user changed the price (manual path; E is their limit)
 * @param {number} [p.selectedOdds] X — defaults to bv.odds
 * @param {object} [p.user]  `{ id }` — only echoed into `user_id`, which the server ignores
 * @returns {{ payload: object, clientRef: string }}
 */
export function buildPlaceRequest({ bv, odds, stake, isEdited = false, selectedOdds, user = null }) {
  const clientRef = newClientRef();
  const oddsNum = Number(odds) || 0;
  const stakeNum = Number(stake) || 0;
  const betType = bv?.betType;
  const team = bv?.team || bv?.teamName || '';
  const marketType = bv?.marketType || bv?.mname || '';
  const isLine = String(bv?.gtype || '').toLowerCase() === 'fancy2';
  const maxStake = Number(bv?.max_stake) || feedMaxStake(bv) || 100000;
  const payload = {
    ...prepareBetPayload(bv, oddsNum, stakeNum, user, marketType, betType, team),
    server_buffer: {
      client_ref: clientRef,
      selected_odds: Number(selectedOdds ?? bv?.odds) || oddsNum,
      edited: !!isEdited,
      live_tracked: isBookieFavourMarket(marketType) || bv?.gtype === 'match',
      own_line: namesOwnLine(bv?.gtype, marketType, bv?.mname),
      line_market: isLine,
      runner_name: team || bv?.nat || bv?.fancy_name || '',
      market_type: marketType,
      gtype: bv?.gtype || '',
      mname: bv?.mname || '',
      initial_size: Number(bv?.size || 0),
      max_stake: maxStake,
      cashout_diff: Number(bv?.cashoutDiff) || 0,
      cashout_percent: !!bv?.cashoutPercent,
    },
  };
  // `user_id` stays in the body exactly as TENEXCH sends it (prepareBetPayload); the server
  // IGNORES it and takes the account from the token (spec §9.3).
  return { payload, clientRef };
}

export { betMarketKey };
