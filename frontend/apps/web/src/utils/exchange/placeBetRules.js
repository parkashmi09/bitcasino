/* Ported from TENEXCH components/betting/placeBet/placeBetRules.js. MIN_BET_AMOUNT is TENEXCH's 100
 * (was Addaplay's 50). Rate cap: the slip uses Addaplay's fixed 4.00 (addaplay.violatesRateCap);
 * maxOddsBlockScope (owner max-odds from betting-config) is TENEXCH and also enforced by the server. */

// ─── Pure betting rules for PlaceBetPanel ────────────────────────────────────
// No React, no side effects — every function here is a pure decision/calc.
// Add new market behaviours by extending the switch blocks below, NOT by
// sprinkling conditions inside the component/hook.

import { calculateSingleBetPLValue } from './betHelpers';
import { BET_TOAST } from './betToastMessages';

// ─── name / class helpers ───────────────────────────────────────────────────

export const normalizeName = (s) => String(s || '').trim().toLowerCase();

export function plClass(n) { return n >= 0 ? 'book-green' : 'book-red'; }

export const isLaySide = (betType) => betType === 'lay' || betType === 'no';

// Odd/Even has NO lay side: Odd and Even are two BACKS on the same 50/50 line,
// both priced ~1.95, each winning stake*(odds-1) and losing its stake. The feed
// carries the Even runner in the LAY price slot and placement stores bet_type
// 'no', so Even bets were drawing the pink lay styling as if they were lays.
//
// DISPLAY ONLY. Exposure, P&L, the book and settlement must keep reading
// bet_type through isLaySide() — 'no' is still what identifies the Even leg.
export const isAllBackMarket = (marketType) =>
  String(marketType || '').toLowerCase() === 'oddeven';

// Should this bet be painted with lay (pink) styling?
export const showsAsLay = (betType, marketType) =>
  !isAllBackMarket(marketType) && isLaySide(betType);

// Odd/Even, keyed on GTYPE only.
//
// The slip cannot use isAllBackMarket() for this: OddEvenBlock passes BOTH
// `marketType: 'FANCY'` and `market_type: 'oddeven'`, and usePlaceBetPanel's
// effectiveMarketType resolves the 'FANCY' one — which never matches. The feed
// calls the market gtype 'oddeven' and nothing else does, so gtype is the one
// field that identifies it. (Bet rows read back from the DB keep carrying
// market_type 'oddeven', so CurrentBets still uses showsAsLay above.)
export const isOddEvenGtype = (gtype) =>
  String(gtype || '').toLowerCase() === 'oddeven';

// Which colour the bet slip takes: 'back' (blue) or 'lay' (pink).
//
// Odd and Even are two BACKS on one 50/50 line — the Even leg is stored as
// bet_type 'no' purely to identify it, so it must NOT take the pink lay panel.
// Every other gtype falls through to the ordinary back/lay rule, so this
// function is the only thing that can change Odd/Even's colour and it cannot
// change anyone else's.
//
// DISPLAY ONLY. Exposure, P&L, the book, the payload and settlement all keep
// reading the side through isLaySide() — 'no' still means the Even leg.
export const panelSideClass = (betType, gtype) =>
  (!isOddEvenGtype(gtype) && isLaySide(betType)) ? 'lay' : 'back';

// Which side of the FEED a slip's bet type reads.
//
// Line markets (fancy2 / dtype 14) invert it: LineMarketBlock renders the feed's
// BACK tiers under "No" and its LAY tiers under "Yes" (the feed quotes run
// LINES there, not prices). A "no" bet on such a market is therefore backed by a
// feed BACK entry — looking it up as a lay lands on a completely different set
// of numbers, and every live check reads a drift that never happened.
export const feedSideFor = (betType, inverted = false) => {
  const lay = isLaySide(betType);
  return (inverted ? !lay : lay) ? 'lay' : 'back';
};

// ─── profit / loss ──────────────────────────────────────────────────────────

export function calcPL(stake, odds, betType, marketType) {
  const { profit, loss } = calculateSingleBetPLValue({ stake, odds, betType, marketType });
  return { profit: Number(profit.toFixed(2)), loss: Number(loss.toFixed(2)) };
}

export function calcProfit(stake, odds, betType, marketType) {
  return calcPL(stake, odds, betType, marketType).profit;
}

// Slips that print a FIXED `Profit: 0` instead of a computed figure.
//
// The reference never puts a number in that cell for these markets — the run
// ladder in the Run Amount modal is where their P&L is laid out, per run. Held
// here (not as an inline regex in the hook) so it is one rule with one test.
// Matched on the market NAME first, falling back to the type, which is the
// order the slip itself resolves them in.
//
// khado was in this list and is not any more (user, 2026-09-13): its slip shows
// a real figure, computed off the run LINE like any other fancy row, so it
// moves as the − / + step the line. Verified against the reference slip — see
// the note at `displayProfit` in usePlaceBetPanel.
const ZERO_PROFIT_RE = /normal|ball by ball|over by over/;

// Odd/Even joins them, but keyed on GTYPE, not on the name. Its rows are named
// after the session ("1st inn 1 over run odd even") while the market's mname is
// the bare "oddeven", and a loose name match would also catch any fancy line
// that happens to say "odd even". gtype is exact — same reason
// `isOddEvenGtype` exists for the blue-panel rule above.
/* HORSE racing joins them — and horse only, not greyhound. The reference has a
   SEPARATE slip for the horse racecard (raceBetData / changeBetAmountHorse) and
   its Profit is the literal string "0":
       a("b",{staticClass:"mb-0"},[t._v("0")])
   Greyhound goes through the NORMAL slip, which computes one:
       a("b",{staticClass:"mb-0"},[t._v(t._s(parseFloat($store.state.bet.profit)))])
   That split is real in our code too: App.jsx routes sid 10 to RacingDetails
   and leaves 65 on GameDetails (market-13 / Market13Block). So this flag is set
   by RacingDetails alone — the odds-field rule below applies to BOTH codes, the
   profit rule only to horse. A racecard's MATCH_ODDS is gtype 'match' like any
   football market, so neither can be told from gtype or mname. */
export const showsZeroProfit = (mname, marketType, gtype, { isHorseRacing = false } = {}) =>
  isHorseRacing
  || isOddEvenGtype(gtype)
  || ZERO_PROFIT_RE.test(String(mname || marketType || '').toLowerCase());

// ─── market family ──────────────────────────────────────────────────────────
// Single source of truth for "which kind of market is this". New market types
// get a case here and every consumer (exposure filter, P&L section, win/loss
// calc) picks it up automatically.

export const MARKET_FAMILY = {
  MATCH_ODDS: 'MATCH_ODDS',
  BOOKMAKER: 'BOOKMAKER',
  TIED_MATCH: 'TIED_MATCH',
  OTHER: 'OTHER',
};

// Market types reach us in three spellings for the same thing: our internal
// label ('BOOKMAKER'), the feed's mname ('Bookmaker 2') and the exposure row's
// game_type (= market_type, so also 'Bookmaker 2'). Strip everything that is
// not a letter/digit so all three collapse onto one key — otherwise
// 'Bookmaker 2' fell through to OTHER and lost its runner book.
export function normalizeMarketKey(marketType) {
  return String(marketType || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function getMarketFamily(marketType) {
  switch (normalizeMarketKey(marketType)) {
    case 'MATCHODDS':
      return MARKET_FAMILY.MATCH_ODDS;
    case 'BOOKMAKER':
    case 'BOOKMAKER2':
      return MARKET_FAMILY.BOOKMAKER;
    case 'TIEDMATCH':
      return MARKET_FAMILY.TIED_MATCH;
    default:
      return MARKET_FAMILY.OTHER;
  }
}

// Markets that carry a per-runner book (win/loss + exposure display)
export function hasRunnerBook(marketType) {
  return getMarketFamily(marketType) !== MARKET_FAMILY.OTHER;
}

// ─── Owner-set Max Odds ──────────────────────────────────────────────────────
// "Bet Not Accept Rate Over <max> on <Sport>": the owner sets a max rate per
// sport × Match Odds / Bookmaker in admin Settings → Max Odds (delivered with
// the betting config — apiservices/bettingConfig.getSportsMaxOddsRule). Applies
// to BACK and LAY alike (the "rate" is the odds value, side-independent). The
// server re-checks every bet (sportbetscontroller STEP 4.6).
//
// A cricket cell can be "Oneday & T20 only": Test matches are then EXEMPT (high
// match-odds are normal there) and the toast reads "... on Oneday and T20".

// Cricket format detection from competition (cname) + event (ename) name. Test
// formats are the ONLY cricket a "Oneday & T20 only" cell exempts; everything
// else (ODI, T20, franchise T20 leagues, The Hundred) is treated as
// limited-overs. Erring toward "limited-overs" is the SAFE default (applies the
// cap when unsure). Server mirror: server/helper/cricketFormat.js.
const TEST_FORMAT_RE = /\btest\b|ashes|first[\s-]?class|county\s+champ|sheffield\s+shield|ranji|plunket/i;

export function isCricketLimitedOvers({ sid, cname, ename }) {
  if (String(sid) !== '4') return false;            // cricket (sid 4) only
  if (TEST_FORMAT_RE.test(`${cname || ''} ${ename || ''}`)) return false; // Test → exempt
  return true;                                       // ODI / T20 / other limited-overs
}

// The toast scope ("Football" / "Oneday and T20") when this bet breaks the
// owner's max-odds rule → reject; null when it may be placed. `rule` is what
// getSportsMaxOddsRule returned (null = no cap on this market).
export function maxOddsBlockScope({ rule, odds, limitedOvers }) {
  if (!rule || !(Number(rule.max) > 0)) return null;
  if (!(Number(odds) > Number(rule.max))) return null;
  if (rule.limitedOversOnly) return limitedOvers ? BET_TOAST.LIMITED_OVERS_SCOPE : null;
  return rule.sport;
}

// Does an exposure item from the API belong to the market this panel is on?
export function exposureItemMatchesMarket(itemGameType, ourMarketType) {
  const ourFamily = getMarketFamily(ourMarketType);
  switch (ourFamily) {
    case MARKET_FAMILY.MATCH_ODDS:
    case MARKET_FAMILY.BOOKMAKER:
      return getMarketFamily(itemGameType) === ourFamily;
    default:
      return true;
  }
}

// ─── odds editability ───────────────────────────────────────────────────────

const LOCKED_ODDS_TYPES = ['normal', 'over by over', 'fancy1', 'khado', 'meter', 'oddeven'];

export function isOddsLockedByType(marketType, mname) {
  return LOCKED_ODDS_TYPES.includes((marketType || '').toLowerCase()) ||
    LOCKED_ODDS_TYPES.includes((mname || '').toLowerCase());
}

// Bookmaker-family markets (gtype match1 — "Bookmaker", "Bookmaker 2",
// "BM 2nd Set Winner"…): odds render as a plain <span>, not an input
export function isBookmakerStyle(gtype, mname) {
  if (gtype === 'match1') return true;
  if (/bookmaker/i.test(mname)) return true;
  return /^\s*bm\b/i.test(mname);
}

// ─── bet-slip odds field ────────────────────────────────────────────────────
// How the slip shows the rate, per market type. Only types whose reference
// slip has been seen get their own case; the rest keep the read-only input
// until a reference DOM says otherwise.
//   TEXT     — `<div><span>42</span></div>`   (Normal fancy, Bookmaker)
//   STEPPER  — − <input> +, user-editable     (Match Odds)
//   READONLY — `<input readonly>`             (everything not yet confirmed)
export const ODDS_FIELD = {
  TEXT: 'text',
  STEPPER: 'stepper',
  READONLY: 'readonly',
};

export function getOddsFieldMode(gtype, mname, { isRacing = false } = {}) {
  /* Racing first, for the same reason the stepper comment below already gives:
     the reference rule is
         "khado"!=gType && "match"!=gType && "fancy2"!=gType || 65==etid
     — the `|| etid` arm pulls racing OUT of the stepper even though its
     MATCH_ODDS is gtype 'match'. Its slip prints the rate as a bare span:
         a("div",{},[ a("span",[ t._s(raceBetData.uRate) ]) ])
     with no − / + at all. Ours fell through to `case 'match'` and drew the
     trio. */
  if (isRacing) return ODDS_FIELD.TEXT;
  // Bookmaker first: a "Bookmaker"-named market can still arrive as gtype
  // 'match', and it has always rendered as a span.
  if (isBookmakerStyle(gtype, mname)) return ODDS_FIELD.TEXT;
  switch (gtype) {
    case 'match':
      return ODDS_FIELD.STEPPER;
    // Khado gets the stepper SHAPE too. The reference bundle picks the field by
    // gtype: `"khado"!=gType && "match"!=gType && "fancy2"!=gType || 65==etid`
    // renders a plain `<span>`, everything else the `− <input> +` trio — so
    // khado, match and fancy2 (but never racing, etid 65) show the stepper.
    //
    // The buttons STEP on khado (they used to be inert): see isKhadoPanel /
    // stepKhadoLine below — its field is a run line, so it moves by whole runs
    // and not along the decimal-odds ladder.
    // Line markets (fancy2 / dtype 14) get the trio too — the same reference
    // rule listed them alongside khado and match, and the capture of "1st
    // Innings 20 Overs Line" shows `− <input> +` in its slip.
    // Khado is read-only here (2026-10-25): the server takes its line from the feed and
    // refuses any other, so a stepped line could only fail.
    case 'khado':
      return ODDS_FIELD.READONLY;
    case 'fancy2':
      return ODDS_FIELD.STEPPER;
    case 'fancy':
      return ODDS_FIELD.TEXT;
    // Odd/Even prints the rate as bare text too. Measured off the live
    // reference (tenexch.com, oddeven row "1st inn 7 over run odd even"): the
    // slip shows `1.96` straight on the blue panel, while ours fell through to
    // READONLY and drew it inside a white input box.
    case 'oddeven':
      return ODDS_FIELD.TEXT;
    // Cricket-casino Number grids (dtype 9, "2ND INN 6 OVER GAW VS TKR") print
    // the rate as bare text too — reference slip for "0 Number" @ 9.5 is
    // `<div><span>9.5</span></div>`, ours drew a white readonly input.
    case 'cricketcasino':
      return ODDS_FIELD.TEXT;
    default:
      return ODDS_FIELD.READONLY;
  }
}

// ─── odds tick ladder ───────────────────────────────────────────────────────
// Step size depends on the range the value sits in:
//   1–2: 0.01 | 2–3: 0.02 | 3–4: 0.05 | 4–6: 0.1 | 6–10: 0.2
//   10–20: 0.5 | 20–30: 1 | 30–50: 2 | 50–100: 5 | 100–1000: 10

const ODDS_TICK_BANDS = [
  [1, 2, 0.01], [2, 3, 0.02], [3, 4, 0.05], [4, 6, 0.1], [6, 10, 0.2],
  [10, 20, 0.5], [20, 30, 1], [30, 50, 2], [50, 100, 5], [100, 1000, 10],
];

function oddsStepFor(value, dir) {
  // Decrement at a band boundary uses the LOWER band's step (2.00 − → 1.99);
  // increment at the boundary uses the upper band (2.00 + → 2.02)
  const x = dir > 0 ? value : value - 0.000001;
  const band = ODDS_TICK_BANDS.find(([lo, hi]) => x >= lo && x < hi);
  if (band) return band[2];
  return x >= 1000 ? 10 : 0.01;
}

/* Khado's slip field is a RUN LINE ("6 over Khado run BT adv - 9" → 45), not a
   price, so its − / + move it by one run. Running it through stepOdds would use
   the decimal ladder and jump 45 → 47 (the 30–50 band steps by 2), which is not
   a line the market offers. Never negative. */
export const isKhadoPanel = (gtype, marketType, mname) =>
  [gtype, marketType, mname].some(v => String(v || '').toLowerCase() === 'khado');

/* Markets whose slip field is a run LINE the punter NAMES, not a price the
   bookie quotes: khado ONLY. The reference gives it the − <input> + trio, and
   stepping it is the whole point — the punter is choosing which line to bet,
   and the book accepts the line they name.

   That is why the price-protection machinery may not touch it:
     • the manual-edit gate would REJECT a stepped-up back (E > X)
     • the bookie-favour checks would overwrite it with the feed's price
   Both exist to stop a punter executing at a better price than the bookie
   quoted. A named line is not a price, so there is nothing to protect against,
   and what the slip shows must be what is placed. (The live drift check DOES
   run for it since 2026-09-14 — it compares the clicked rung, see Step 5.)

   Line markets (gtype fancy2 / dtype 14) sat in this set from 2026-09-13 to
   2026-09-14 and are NOT in it any more (user: "if I increase the odds it
   should fall on the main odds"). They keep the stepper trio
   (getOddsFieldMode), but the field is a QUOTED price: every line bet executes
   at the side's MAIN (tno-0) quote — LineMarketBlock's `betOdds` — exactly as
   a click on a depth cell does. While they were here, a line stepped to 134
   against a 124–129 book was sent as the bet price and booked at 134. */
export const namesOwnLine = (gtype, marketType, mname) =>
  isKhadoPanel(gtype, marketType, mname);

export function stepKhadoLine(prevStr, dir) {
  const n = Math.round(parseFloat(prevStr) || 0);
  return String(Math.max(0, n + dir));
}

export function stepOdds(prevStr, dir) {
  const n = parseFloat(prevStr) || 0;
  const step = oddsStepFor(n, dir);
  const next = Math.max(1.01, Math.min(1000, Math.round((n + dir * step) * 100) / 100));
  // No decimal padding — 38 stays 38, 1.99 stays 1.99 (never 38.00)
  return String(Number(next.toFixed(2)));
}

// ─── live game status ───────────────────────────────────────────────────────

export function isBlockedGameStatus(gs) {
  switch (gs) {
    case 'SUSPENDED':
    case 'BALL RUNNING':
    case 'INACTIVE':
      return true;
    default:
      return false;
  }
}

export function suspensionToastMessage(gs) {
  switch (gs) {
    case 'BALL RUNNING':
      return BET_TOAST.BALL_RUNNING;
    default:
      return BET_TOAST.GAME_NOT_ACTIVE;
  }
}

// ─── pre-submit validation ──────────────────────────────────────────────────
// Returns a BET_ERROR code (or null when the bet is placeable). The hook maps
// each code to its toast/side-effect in ONE switch — add new rejection reasons
// here first, then handle the code there.

// Global minimum bet floor — no manual bet may be placed below this amount,
// regardless of the market's own (often 0) min. Cashout hedges are exempt
// (their stake is computed, not chosen). Applied in usePlaceBetPanel.
// TENEXCH's floor, ₹100 (the user chose TENEXCH over Addaplay's 50 on 2026-10-21; docs/exchange.md).
export const MIN_BET_AMOUNT = 100;

// Virtual cricket (Dim "(e)" / T5 XI / T10 XI / Virtual Cricket League) carries
// its own, higher floor — the reference refuses anything below 200 with the
// "Bet is too small." toast instead of "Check Minimum Bet Limit.".
// TENEXCH (no Addaplay equivalent) — Addaplay refuses virtual events outright
// (betValidation.js:44-47, BetSlip.jsx:482), so the TENEXCH floor only matters if that refusal
// is ever lifted.
export const VIRTUAL_MIN_BET_AMOUNT = 200;

export const BET_ERROR = {
  EMPTY_STAKE: 'EMPTY_STAKE',
  ABSURD_SERVER: 'ABSURD_SERVER',   // 16+ zeros → fake loader, then "Server Error"
  ABSURD_INVALID: 'ABSURD_INVALID', // 12–15 zeros → instant "Bet Not Valid.."
  BELOW_MIN: 'BELOW_MIN',
  ABOVE_MAX: 'ABOVE_MAX',
  SUSPENDED: 'SUSPENDED',
  INVALID: 'INVALID',
};

export function getBetValidationError({ stakeNum, minStake, maxStake, suspended, isValid }) {
  if (stakeNum <= 0) return BET_ERROR.EMPTY_STAKE;
  if (stakeNum >= 1e16) return BET_ERROR.ABSURD_SERVER;
  // Amounts with 12–15 zeros (1e12 up to but not including 1e16) — reference
  // rejects these instantly with the "Bet Not Valid.." toast
  if (stakeNum >= 1e12) return BET_ERROR.ABSURD_INVALID;
  if (minStake > 0 && stakeNum < minStake) return BET_ERROR.BELOW_MIN;
  if (maxStake > 0 && stakeNum > maxStake) return BET_ERROR.ABOVE_MAX;
  if (suspended) return BET_ERROR.SUSPENDED;
  if (!isValid) return BET_ERROR.INVALID;
  return null;
}

/* ── Racing betting window (HORSE only, sid 10) ─────────────────────────────────────────────
   A horse race takes bets only in the last RACE_BET_WINDOW_MINUTES before the off — the server
   (sportbetscontroller placeBet) refuses earlier bets with the same sentence. Greyhound (65) is
   open until the off: TENEXCH's server gates sid 10 only, and the live reference took a sid 65
   bet 2h11m before the off (BC games sports issues #9). The feed's "M/D/YYYY h:mm:ss AM" start
   is IST wall time, read as IST for every viewer. Unreadable start → open. TENEXCH racingUtils. */
export const RACING_SIDS = new Set(['10']);
export const RACE_BET_WINDOW_MINUTES = 5;
export const RACE_WINDOW_TOAST = `Bet will be accepted ${RACE_BET_WINDOW_MINUTES} minutes before the market starts, Thanks.`;

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export function parseFeedIstTime(stime) {
  const m = String(stime || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return null;
  const [, mo, day, yr, hh, mi, ss, ap] = m;
  let h = Number(hh);
  if (ap?.toUpperCase() === 'PM' && h !== 12) h += 12;
  if (ap?.toUpperCase() === 'AM' && h === 12) h = 0;
  return Date.UTC(Number(yr), Number(mo) - 1, Number(day), h, Number(mi), Number(ss || 0)) - IST_OFFSET_MS;
}

export function isRaceBettingOpen(sid, stime, now = Date.now()) {
  if (!RACING_SIDS.has(String(sid))) return true;
  const start = parseFeedIstTime(stime);
  return start == null ? true : (start - now) / 60000 <= RACE_BET_WINDOW_MINUTES;
}
