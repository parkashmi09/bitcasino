/* ─── Addaplay's exchange calculations — the SOURCE OF TRUTH for every formula it has ──────────
 *
 * Ported from /Users/apple/Developer/cfz/admins/frontend-kit/main/Addaplay (read-only):
 *   src/utils/betValidation.js       — profit, per-runner exposure preview, min / range, unmatched
 *   src/utils/autoBetRules.js        — bookie favour, locked markets, fancy drift, game type, rate cap
 *   src/services/sports/betMappers.js — settled-bet profit + bet-row normalisation
 *   src/pages/Sports/components/MatchDetail/BetSlip.jsx — market title, slip P/L, anti-spam, buffer
 *   src/pages/Sports/components/MatchDetail/MatchDetail.jsx:151-173 — the clicked-bet object
 *
 * The user's rule: where Addaplay and TENEXCH differ, ADDAPLAY WINS; where Addaplay has nothing,
 * the TENEXCH port beside this file is used and says so ("TENEXCH (no Addaplay equivalent)").
 * Function bodies are kept as in Addaplay; the only adaptation is that Addaplay reads its own
 * TRANSFORMED market (`runners[].team`, `backOdds[2]`, `layOdds[0]`, sportsTransformer.js:32-63)
 * while this layer keeps the RAW mssports feed, so `readLiveSide` reads `section[].nat` and the
 * `back1` / `lay1` rungs — which is exactly what those two transformer slots hold.
 */

/** Float tolerance for every odds comparison. autoBetRules.js:24 */
export const ODDS_EPSILON = 0.001;

// ─── Market title (BetSlip.jsx:84-91) ─────────────────────────────────────────
/* NOTE the two Tied spellings land in DIFFERENT families: the feed's "Tied Match" is priced as
   MATCH_ODDS (decimal) while "tied_match" is TIED_MATCH (percent). Addaplay verbatim — see the
   differences table in docs/exchange.md, the mssports backend books "Tied Match" as percent. */
export function addaplayMarketTitle(mname) {
  const mn = String(mname || '').toLowerCase();
  if (mn === 'match_odds' || mn.includes('match odds')) return 'MATCH_ODDS';
  if (mn === 'tied match') return 'MATCH_ODDS';
  if (mn === 'tied_match') return 'TIED_MATCH';
  if (mn.includes('bookmaker')) return 'BOOKMAKER';
  return 'FANCY';
}

// ─── Profit (betValidation.js:54-63) ──────────────────────────────────────────
export function calculateProfit(odds, stake, marketType) {
  const o = parseFloat(odds) || 0;
  const s = parseFloat(stake) || 0;
  if (!o || !s) return 0;
  const mt = (marketType || '').toUpperCase();
  if (mt === 'MATCH_ODDS' || mt === 'MO') return s * (o - 1);
  if (mt === 'TIED_MATCH') return (o / 100) * s;
  if (mt.includes('BOOKMAKER')) return (s * o) / 100;
  return s;
}

/**
 * The slip's Profit / Loss pair, exactly as BetSlip.jsx renders it (:93-105, :561-571).
 *   profit = calculateProfit(odds, stake, marketTitle)
 *   loss   = back ? stake : profit          ← Addaplay verbatim, also for LAY
 *   show   = mname is literally MATCH_ODDS or BOOKMAKER (the row is hidden otherwise)
 * Values are unrounded; Addaplay prints them with `.toFixed(2)`.
 */
export function slipProfitLoss({ odds, stake, betType, mname }) {
  const isBack = betType === 'back' || betType === 'yes';
  const marketTitle = addaplayMarketTitle(mname);
  const stakeNum = Number(stake) || 0;
  const profit = calculateProfit(Number(odds) || 0, stakeNum, marketTitle);
  const loss = isBack ? stakeNum : profit;
  const upper = String(mname || '').toUpperCase();
  return { profit, loss, marketTitle, show: upper === 'MATCH_ODDS' || upper === 'BOOKMAKER' };
}

// ─── Per-runner exposure preview (betValidation.js:65-87) ─────────────────────
export function calculateExposurePerSelection(odds, stake, betType, marketType, marketRows, selectedTeam) {
  if (!marketRows || !Array.isArray(marketRows) || !stake || !odds) return [];
  const s = parseFloat(stake) || 0;
  const o = parseFloat(odds) || 0;
  const isLay = betType === 'lay';
  const mt = (marketType || '').toUpperCase();
  const isBookmaker = mt.includes('BOOKMAKER');
  const isTiedMatch = mt === 'TIED_MATCH';
  const usePercentFormula = isBookmaker || isTiedMatch;

  return marketRows.map((row) => {
    const isSelected = row.team === selectedTeam;
    let exposure;
    if (isSelected) {
      exposure = isLay
        ? (usePercentFormula ? -(o / 100) * s : -s * (o - 1))
        : (usePercentFormula ? (o / 100) * s : s * (o - 1));
    } else {
      exposure = isLay ? s : -s;
    }
    return { name: row.team, exposure };
  });
}

/* BetSlip.jsx:153-157 — the preview table: hidden on FANCY, rows from the market's runner names,
   `yes`/`no` folded onto back/lay first (BetSlip.jsx:73). */
export function slipExposureRows({ odds, stake, betType, mname, runners, runnerName }) {
  const marketTitle = addaplayMarketTitle(mname);
  if (marketTitle === 'FANCY' || !runners) return [];
  const side = betType === 'yes' ? 'back' : betType === 'no' ? 'lay' : betType;
  const rows = runners.map((name) => ({ team: name }));
  return calculateExposurePerSelection(Number(odds) || 0, Number(stake) || 0, side, marketTitle, rows, runnerName);
}

// ─── Stake rules (betValidation.js:15-33) ────────────────────────────────────
/** Addaplay's global floor. betValidation.js:17 */
export const ADDAPLAY_MIN_BET = 50;

export function validateMinBetAmount(stake) {
  const num = parseFloat(stake) || 0;
  if (num < 50) return 'Minimum bet amount is ₹50';
  return null;
}

export function validateStakeRange(stake, min, max) {
  const num = parseFloat(stake) || 0;
  if (min != null && num < Number(min)) return 'Bet amount is below minimum range';
  if (max != null && Number(max) > 0 && num > Number(max)) return 'Bet amount exceeds maximum range';
  return null;
}

/* The limits the clicked bet carries — MatchDetail.jsx:171-172: the runner's own value wins,
   else the market's. (No maxb, no 100000 fallback: those are TENEXCH's; this layer's market hook
   folds maxb into `max` with applyMatchOddsLimits first, so `max` here is already the cap the
   server enforces.) */
export function resolveStakeLimits(market, section) {
  return {
    min: section?.min || market?.min,
    max: section?.max || market?.max,
  };
}

/* Manual odds edit — betValidation.js:35-42. Strict: an edited BACK at or above the clicked price
   (or a LAY at or below it) is refused. Only consulted when the user really edited the price. */
export function validateUnmatchedOdds(currentOdds, originalOdds, betType, isUserModified) {
  if (!isUserModified) return null;
  const current = parseFloat(currentOdds) || 0;
  const original = parseFloat(originalOdds) || 0;
  if (betType === 'back' && current >= original) return 'Unmatched bet not allowed';
  if (betType === 'lay' && current <= original) return 'Unmatched bet not allowed';
  return null;
}

const VIRTUAL_LEAGUES = ['Virtual Cricket League', 'T5 XI', 'T10 XI'];

/** betValidation.js:44-47 — Addaplay refuses virtual events outright. */
export function isVirtualEvent(matchInfo) {
  if (!matchInfo?.cname) return false;
  return VIRTUAL_LEAGUES.includes(matchInfo.cname);
}

/* betValidation.js:3-13 — buffer seconds from a `{ sports: { MATCH_ODDS, Bookmaker } }` config or
   a bare number. mssports serves a different config (`buffers.grid`, see the TENEXCH
   `getSportsBufferSeconds` in services/exchange/config.js) and runs the buffer ON THE SERVER, so
   this is informational — the countdown a slip may show. Addaplay's default when unset is 3s
   (BetSlip.jsx:36). */
export const ADDAPLAY_DEFAULT_BUFFER_SECONDS = 3;

export function getBufferSeconds(bufferTimeConfig, marketTitle) {
  if (bufferTimeConfig == null) return 0;
  if (typeof bufferTimeConfig === 'number') return bufferTimeConfig;
  if (typeof bufferTimeConfig === 'object' && bufferTimeConfig.sports) {
    const upper = (marketTitle || '').toUpperCase();
    if (upper === 'MATCH_ODDS' || upper === 'MO') return Number(bufferTimeConfig.sports.MATCH_ODDS) || 0;
    if (upper.includes('BOOKMAKER') || upper === 'BM') return Number(bufferTimeConfig.sports.Bookmaker) || 0;
    return Number(bufferTimeConfig.sports.MATCH_ODDS) || 0;
  }
  return 0;
}

// ─── Bookie favour (autoBetRules.js) ─────────────────────────────────────────
/** autoBetRules.js:30-36 — fancy / fancy1 only (or a gtype-less market named "fancy"). */
export function isLockedOddsMarket(bet) {
  const gtype = (bet?.gtype || '').toLowerCase();
  if (gtype === 'fancy' || gtype === 'fancy1') return true;
  if (!gtype) return (bet?.mname || '').toLowerCase().includes('fancy');
  return false;
}

/** autoBetRules.js:44 — every non-locked market gets the favour gate. */
export const isFavourEligible = (bet) => !isLockedOddsMarket(bet);

/**
 * autoBetRules.js:56-79, on the RAW feed. The market is found by NAME (as Addaplay does — it
 * matches `mname`, not `mid`), the runner by `nat === runnerName`, and the best rung is `back1` /
 * `lay1` (the transformer's backOdds[2] / layOdds[0]). A rung at 0 counts as "no price".
 * @returns {{found:boolean, suspended:boolean, odds:number|null, size:number}}
 */
export function readLiveSide(markets, bet, sideForApi) {
  const miss = { found: false, suspended: false, odds: null, size: 0 };
  if (!Array.isArray(markets) || !markets.length || !bet) return miss;

  const mn = (bet.mname || '').toLowerCase();
  const liveMarket = markets.find((m) => (m.mname || '').toLowerCase() === mn);
  if (!liveMarket) return miss;

  const liveRunner = (liveMarket.section || []).find((r) => (r.nat || '') === bet.runnerName);
  if (!liveRunner) return miss;

  const status = String(liveRunner.gstatus || '').toUpperCase();
  const suspended = status !== '' && status !== 'ACTIVE' && status !== 'OPEN';

  const oname = sideForApi === 'back' ? 'back1' : 'lay1';
  const tier = (liveRunner.odds || []).find((o) => o.oname === oname);
  const raw = tier && Number(tier.odds) > 0 ? tier.odds : null;
  const odds = raw == null ? null : Number(raw);

  return {
    found: true,
    suspended,
    odds: Number.isFinite(odds) && odds > 0 ? odds : null,
    size: Number(tier?.size) || 0,
  };
}

/** autoBetRules.js:89-102 — X clicked, Y live. No live price → accept at X. Execution is Y. */
export function evaluateBookieFavour(sideForApi, clickedOdds, liveOdds) {
  const X = Number(clickedOdds);
  if (liveOdds == null || !Number.isFinite(liveOdds)) {
    return { accepted: true, executionOdds: X };
  }
  const Y = Number(liveOdds);
  if (sideForApi === 'back' && X > Y + ODDS_EPSILON) return { accepted: false, executionOdds: Y };
  if (sideForApi === 'lay' && X < Y - ODDS_EPSILON) return { accepted: false, executionOdds: Y };
  return { accepted: true, executionOdds: Y };
}

/** autoBetRules.js:108 */
export const FANCY_DRIFT_TOLERANCE = 0.01;

/** autoBetRules.js:110-124 — ANY tier on EITHER side within 0.01 of X passes; nothing to compare → pass. */
export function isFancyDriftAcceptable(markets, bet, clickedOdds) {
  const mn = (bet?.mname || '').toLowerCase();
  const liveMarket = (markets || []).find((m) => (m.mname || '').toLowerCase() === mn);
  const liveRunner = liveMarket?.section?.find((r) => (r.nat || '') === bet?.runnerName);
  if (!liveRunner) return true;

  const tiers = (liveRunner.odds || [])
    .map((t) => Number(t?.odds))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!tiers.length) return true;

  const X = Number(clickedOdds);
  return tiers.some((t) => Math.abs(t - X) <= FANCY_DRIFT_TOLERANCE);
}

// ─── Game type + rate cap (autoBetRules.js:146-177) ───────────────────────────
export function resolveGameType(mname, gtype) {
  const mn = (mname || '').toLowerCase();
  if (mn === 'match_odds' || mn.includes('match odds')) return { gameType: 'MO', fancyName: '' };
  if (mn === 'tied match' || mn === 'tied_match') return { gameType: 'MO', fancyName: '' };
  if (mn.includes('bookmaker')) return { gameType: 'BM', fancyName: '' };

  const gt = (gtype || '').toLowerCase();
  if (gt === 'match') return { gameType: 'MO', fancyName: '' };
  if (gt === 'match1') return { gameType: 'BM', fancyName: '' };
  return { gameType: 'FAN', fancyName: 'FANCY' };
}

export const RATE_CAP = 4.0;

/** `marketTitle` is addaplayMarketTitle(mname); `matchData` carries sid + cname. */
export function isRateCapped(matchData, marketTitle) {
  if (marketTitle !== 'MATCH_ODDS') return false;
  const sid = Number(matchData?.sid ?? matchData?.sportId);
  if (sid !== 4) return false;
  const cname = String(matchData?.cname || matchData?.competition || '').toLowerCase();
  if (cname.includes('test')) return false;
  return true;
}

export const violatesRateCap = (odds, matchData, marketTitle) =>
  isRateCapped(matchData, marketTitle) && Number(odds) > RATE_CAP + ODDS_EPSILON;

// ─── Anti-spam: one in-flight submit per market+runner (BetSlip.jsx:66, :485-489, :437) ──────
const inFlight = new Set();

/** The key BetSlip.jsx:485 builds. */
export const betMarketKey = (bet) => `${bet?.marketId || bet?.mname}|${bet?.runnerName}`;

/** false = already submitting on this key → toast MULTIPLE_BET_NOT_ALLOWED. */
export function beginBetSubmit(key) {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  return true;
}

export function endBetSubmit(key) {
  inFlight.delete(key);
}

// ─── Settled-bet profit + row normalisation (betMappers.js) ───────────────────
const pick = (...values) => values.find((v) => v !== undefined && v !== null);
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const isFancyBet = (bet) =>
  String(bet.gameType || '').toUpperCase() === 'FAN'
  || ['yes', 'no'].includes(String(bet.side || '').toLowerCase());

/** betMappers.js:54-75 — null while unsettled. */
export function betProfit(bet) {
  const result = String(bet.resultStatus || '').toLowerCase();
  const side = String(bet.side || '').toLowerCase();
  const isBack = side === 'back' || side === 'yes';

  const stake = num(bet.stake);
  const odds = num(bet.odds);
  const liability = num(bet.liability) || stake;
  // A fancy row's `odds` is the run line (YES 55 @ 100 -> 55); it pays on the rate, `size`.
  const rate = num(bet.size) || odds;

  if (result === 'won' || result === 'win') {
    if (isFancyBet(bet)) return isBack ? (stake * rate) / 100 : stake;
    return isBack ? stake * (odds - 1) : stake;
  }
  if (result === 'lost' || result === 'loss') {
    if (isFancyBet(bet)) return isBack ? -stake : -((stake * rate) / 100);
    return isBack ? -stake : -liability;
  }
  if (result === 'void' || result === 'refund' || result === 'cancelled') return 0;
  return null;
}

/** betMappers.js:85-136 — one bet shape whatever endpoint (camel or snake) served it. */
export function normaliseBet(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const bet = {
    id: pick(raw.id, raw.bet_id, raw.betId) ?? null,
    matchId: pick(raw.matchId, raw.match_id) ?? null,
    matchTitle: pick(raw.matchTitle, raw.match_title, raw.event_name, raw.eventName) ?? '',
    eventId: pick(raw.eventId, raw.eventid, raw.event_id) ?? null,
    sportId: pick(raw.sportId, raw.sport_id) ?? null,
    gameType: pick(raw.gameType, raw.game_type) ?? '',
    marketType: pick(raw.marketType, raw.market_type) ?? '',
    // The bet route stores the literal "NULL" when a market has no fancy name.
    fancyName: [pick(raw.fancyName, raw.fancy_name) ?? ''].map(String).find((v) => v.toUpperCase() !== 'NULL') ?? '',
    selection: pick(raw.selection, raw.selectionName, raw.selection_name, raw.nat, raw.team) ?? '',
    side: String(pick(raw.side, raw.betType, raw.bet_type) ?? '').toLowerCase(),
    odds: num(pick(raw.odds, raw.user_rate, raw.rate)),
    // A fancy line's rate (YES 55 @ 100). Odd/even carries a placeholder size (1000000), not a rate.
    size: String(pick(raw.gtype, raw.market_type) ?? '').toLowerCase() === 'oddeven' ? 0 : num(pick(raw.size)),
    stake: num(pick(raw.stake, raw.stakeAmount, raw.stake_amount, raw.amount)),
    liability: num(pick(raw.liability, raw.exposure)),
    status: String(pick(raw.status) ?? '').toLowerCase(),
    resultStatus: pick(raw.resultStatus, raw.result_status) ?? null,
    teamOne: pick(raw.teamOne, raw.team_one) ?? '',
    teamTwo: pick(raw.teamTwo, raw.team_two) ?? '',
    createdAt: pick(raw.createdAt, raw.created_at, raw.place_date) ?? null,
    settledAt: pick(raw.settledAt, raw.match_end_time, raw.matchEndTime) ?? null,
    startsAt: pick(raw.matchStartTime, raw.match_start_time) ?? null,
    username: pick(raw.username) ?? null,
    raw,
  };
  bet.isOpen = bet.status === 'open' || bet.resultStatus === 'pending' || !bet.resultStatus;
  bet.profit = betProfit(bet);
  bet.isWin = bet.profit != null && bet.profit > 0;
  bet.isLoss = bet.profit != null && bet.profit < 0;
  return bet;
}

/** betMappers.js:146-151 */
export function normaliseBets(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : payload?.data ?? payload?.rows ?? payload?.bets ?? payload?.sportsBets ?? [];
  return (Array.isArray(rows) ? rows : []).map(normaliseBet).filter(Boolean);
}

// ─── Display (MatchDetail/utils.js:1-30) ──────────────────────────────────────
/** utils.js:1-6 — integers bare, else 2 dp; 0 / '-' → '--'. */
export function formatOddAddaplay(odd) {
  if (!odd || odd === '--' || odd === '-') return '--';
  const val = typeof odd === 'number' ? odd : parseFloat(odd);
  if (isNaN(val) || val === 0) return '--';
  return val % 1 === 0 ? val.toFixed(0) : val.toFixed(2);
}

/** utils.js:26-30 — the blocking status of a runner row, or null when clickable. */
export function getRowStatus(runner) {
  const gs = runner?.gstatus ? String(runner.gstatus).toUpperCase() : 'ACTIVE';
  if (gs === 'ACTIVE' || gs === 'OPEN') return null;
  return gs;
}
