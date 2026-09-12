'use strict';

/**
 * Market-name tables, copied verbatim from `legacy/sportsmain/cron/settlement.js`.
 *
 * These lists ARE the settlement rules — which branch of `resolveFancyWinner`
 * a bet takes, and whether a "FAN" bet is really a fancy session or a
 * two-outcome side market, is decided by string equality against them. A name
 * dropped or re-spelled here settles bets on the wrong rule, so nothing has
 * been tidied, deduplicated or sorted: the arrays are the legacy arrays,
 * including their repeated entries.
 */

/** @legacy settlement.js `marketsfornonfancy` */
const marketsfornonfancy = [
  'Game Winner 1/2',
  'OVER_UNDER_35',
  'OVER_UNDER_25',
  'OVER_UNDER_15',
  'OVER_UNDER_05',
  'Under/Over 5.5',
  'Under/Over 0.5',
  'Under/Over 1.5',
  'Under/Over 2.5',
  'Under/Over 3.5',
  'Under/Over 4.5',
  'Under/Over 6.5',
  '2nd Period Winner',
  '1st Period Winner',
  '3rd Period Winner',
  'Next Goal 1.0',
  'Next Goal 2.0',
  'Next Goal 3.0',
  'Next Goal 4.0',
  'Next Goal 5.0',
  'Next Goal 6.0',
  'Next Goal 7.0',
  'Next Goal 8.0',
  'Next Goal 9.0',
  'Next Goal 10.0',
  'HALF_TIME',
  'Match Time Result 70:00',
  'Match Time Result 10:00',
  'Match Time Result 30:00',
  'Match Time Result 20:00',
  'Match Time Result 40:00',
  'Match Time Result 60:00',
  'Match Time Result 50:00',
  'Match Time Result 70:00',
  'Match Time Result 80:00',
  'Match Time Result 90:00',
  'Game Winner 1/1',
  'Game Winner 1/2',
  'Game Winner 1/3',
  'Game Winner 1/4',
  'Game Winner 2/2',
  'Game Winner 2/3',
  'Game Winner 2/4',
  'Game Winner 3/3',
  'Game Winner 3/4',
  'Game Winner 4/4',
  'Game Winner 2/7',
  'Game Winner 3/7',
  'Game Winner 4/7',
  'Game Winner 5/7',
  'Game Winner 6/7',
  'Game Winner 7/7',
  '1st Set Winner Home/Away',
  '2nd Set Winner Home/Away',
  '3rd Set Winner Home/Away',
  '4th Set Winner Home/Away',
  '5th Set Winner Home/Away',
  '1st Set Race To 4.0',
  '2nd Set Race To 4.0',
  '3rd Set Race To 4.0',
  '4th Set Race To 4.0',
  '5th Set Race To 4.0',
  'Point Winner 1/3/1',
  'Point Winner 1/3/2',
  'Point Winner 1/3/3',
  'Point Winner 1/2/1',
  'Point Winner 1/1/1',
  'Point Winner 2/3/1',
  'Point Winner 2/3/2',
  'Point Winner 2/3/3',
  'Point Winner 2/2/1',
  'Point Winner 2/2/2',
  'Point Winner 2/1/1',
  'Point Winner 3/3/1',
  'Point Winner 3/3/2',
  'Point Winner 3/3/3',
  'Point Winner 3/2/1',
  'Point Winner 3/2/2',
  'Point Winner 3/2/3',
  'Point Winner 3/1/1',
  'Point Winner 3/1/2',
  'Point Winner 3/1/3',
  'Point Winner 4/4/1',
  'Point Winner 4/4/2',
  'Point Winner 4/4/3',
  'Point Winner 4/4/4',
  'Point Winner 4/3/1',
  'Point Winner 4/3/2',
  'Point Winner 4/3/3',
  'Point Winner 4/3/4',
  'Point Winner 4/2/1',
  'Point Winner 4/2/2',
  'Point Winner 4/2/3',
  'Point Winner 4/2/4',
  'Point Winner 4/1/1',
  'Point Winner 4/1/2',
  'Point Winner 4/1/3',
  'Point Winner 4/1/4',
];

/** @legacy settlement.js `fixedNonFancyMarkets` */
const fixedNonFancyMarkets = [
  'OVER_UNDER_55',
  'OVER_UNDER_45',
  'OVER_UNDER_35',
  'OVER_UNDER_25',
  'OVER_UNDER_15',
  'OVER_UNDER_05',
  'OVER_UNDER_10',
  'Match Result/Both Teams to score',
  'HT/FT',
  '1X2 Corners',
  'CORRECT_SCORE',

  '2nd Period Winner',
  'BOTH_TEAMS_TO_SCORE',
  '1st Period Winner',

  '3rd Period Winner',

  'Both Teams To Score',

  'DRAW_NO_BET',
  'Draw No Bet',

  'HALF_TIME',

  '1st Set Winner Home/Away',
  '2nd Set Winner Home/Away',
  '3rd Set Winner Home/Away',
  '4th Set Winner Home/Away',
  '5th Set Winner Home/Away',

  '1st Set Winner',
  '2nd Set Winner',
  '3rd Set Winner',
  '4th Set Winner',
  '5th Set Winner',
  '6th Set Winner',

  '1st Half Winner',
  '2nd Half Winner',
  '3rd Half Winner',
  '4th Half Winner',
  '5th Half Winner',
  '6th Half Winner',

  '1st Quarter Winner',
  '2nd Quarter Winner',
  '3rd Quarter Winner',
  '4th Quarter Winner',
  '5th Quarter Winner',
  '6th Quarter Winner',

  'Tied Match',
  'TIED_MATCH',
];

/** @legacy settlement.js `marketsfor01fancy` */
const marketsfor01fancy = [
  'TIED_MATCH',
  'Tied Match',
  'Game To Deuce 1/1',
  'Game To Deuce 1/2',
  'Game To Deuce 1/3',
  'Game To Deuce 1/4',
  'Game To Deuce 2/1',
  'Game To Deuce 2/2',
  'Game To Deuce 2/3',
  'Game To Deuce 2/4',
  'Game To Deuce 3/1',
  'Game To Deuce 3/2',
  'Game To Deuce 3/3',
  'Game To Deuce 3/4',
  'Game To Deuce 4/1',
  'Game To Deuce 4/2',
  'Game To Deuce 4/3',
  'Game To Deuce 4/4',
  'Both Teams To Score',
  'Match Result/Both Teams to score',
];

/**
 * Market types the manual-result lookup keys on `fancyName` as well.
 *
 * @legacy settlement.js `fetchManualResult` → `marketsforfancyCheck`
 *
 * Note this is a THIRD list of fancy market types in the codebase, alongside
 * `settlement.constants.js` `FANCY_MARKET_TYPES` (grouping, 25 entries) and
 * `SELECTION_SCOPED_MARKETS` (the manual-declare write filter, 7 entries). It
 * is kept separate because it gates a different decision — whether the cron's
 * result lookup narrows to one session — and the three lists do not agree.
 */
const marketsforfancyCheck = [
  '1st Innings 6 Overs Line',
  '2nd Innings 6 Overs Line',
  '3rd Innings 6 Overs Line',
  '1st Innings 50 Overs Line',
  '2nd Innings 50 Overs Line',
  '3rd Innings 50 Overs Line',
  '1st Innings 40 Overs Line',
  '2nd Innings 40 Overs Line',
  '3rd Innings 40 Overs Line',
  '1st Innings 30 Overs Line',
  '2nd Innings 30 Overs Line',
  '3rd Innings 30 Overs Line',
  '1st Innings 20 Overs Line',
  '2nd Innings 20 Overs Line',
  '3rd Innings 20 Overs Line',
  '1st Innings 10 Overs Line',
  '2nd Innings 10 Overs Line',
  '3rd Innings 10 Overs Line',
  'Over By Over',
  'Ball By Ball',
  'Normal',
  'khado',
  'meter',
  'fancy1',
  'oddeven',
];

/**
 * Is this "FAN" bet actually a two-outcome side market rather than a session?
 *
 * @legacy settlement.js `isNonFancyMarket`
 *
 * Decides whether `processFanBet` hands off to `processnonfancy` (exposure-based
 * payout) or resolves it as a fancy line (odds/size-based payout). The fixed
 * list plus the nine regexes are copied exactly, in order — the first match
 * wins and the order is load-bearing.
 */
function isNonFancyMarket(market_type) {
  // 1️⃣ fixed names
  if (fixedNonFancyMarkets.includes(market_type)) {
    return true;
  }

  // 2️⃣ Game Winner X/Y
  if (/^Game Winner\s+(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)$/.test(market_type)) {
    return true;
  }

  // 3️⃣ Match Time Result 10:00, 70:00, etc
  if (/^Match Time Result\s+\d{2}:\d{2}$/.test(market_type)) {
    return true;
  }

  // 4️⃣ Set Race To 1.0 – 15.0 (all sets)
  if (/^\d+(?:st|nd|rd|th)\s+Set Race To\s+(?:[1-9]|1[0-5])\.0$/.test(market_type)) {
    return true;
  }
  if (/^TEAM_[A-Z]+_\d+$/.test(market_type)) {
    return true;
  }

  // 5️⃣ Under/Over 0.5 , 1.5 , 180s etc
  if (/^Under\/Over(?: 180s)?\s+\d+(\.\d)?$/.test(market_type)) {
    return true;
  }

  // 6️⃣ Total Tie Break in the Match X.X
  if (/^Total Tie Break in the Match\s+\d+(\.\d)?$/.test(market_type)) {
    return true;
  }

  // 7️⃣ Point Winner A/B/C
  if (/^Point Winner\s+(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)$/.test(market_type)) {
    return true;
  }

  // 8️⃣ Game To Deuce A/B   (your current list)
  if (/^Game To Deuce\s+(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)$/.test(market_type)) {
    return true;
  }

  // 9️⃣ Game To Deuce A/B/C (future support – as you mentioned before)
  if (/^Game To Deuce\s+(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)\/(?:[1-9]|1\d|20)$/.test(market_type)) {
    return true;
  }

  // 🔟 Next Goal X.0
  if (/^Next Goal\s+\d+(\.\d)?$/.test(market_type)) {
    return true;
  }

  return false;
}

/**
 * The fancy market types paid at `odds`, not at `size/100`.
 *
 * @legacy settlement.js `processFanBet` — the long inline `||` chain that
 * decides between the "fancy" and "normal" credit formulas. Extracted to a Set
 * so the branch reads as a lookup, with every name preserved exactly as
 * written, duplicates included.
 */
const ODDS_PRICED_FANCY_MARKETS = new Set([
  'TIED_MATCH', 'OVER_UNDER_35', 'OVER_UNDER_25', 'OVER_UNDER_15', 'OVER_UNDER_05', 'Tied Match',
  'Game Winner 1/2', 'Game Winner 1/3', '1st Set Winner Home/Away', '2nd Set Winner Home/Away', '3rd Set Winner Home/Away',
  'Next Goal 1.0', 'Next Goal 2.0', 'Next Goal 3.0', 'Next Goal 4.0', 'Next Goal 5.0', 'Next Goal 6.0',
  'Game Winner 2/2', 'Game Winner 2/3', 'Game Winner 2/4', 'Game Winner 3/2', 'Game Winner 3/3', 'Game Winner 3/4',
  'Game Winner 2/7', 'Game Winner 4/3', 'Game Winner 4/4',
  '1st Period Winner', '2nd Period Winner', '3rd Period Winner',
  'Game To Deuce 1/1', 'Game To Deuce 1/2', 'Game To Deuce 1/3', 'Game To Deuce 1/4',
  'Game To Deuce 2/1', 'Game To Deuce 2/2', 'Game To Deuce 2/3', 'Game To Deuce 2/4',
  'Game To Deuce 3/1', 'Game To Deuce 3/2', 'Game To Deuce 3/3', 'Game To Deuce 3/4',
  'Correct Score', 'Correct Score1', 'Correct Score 1st Set', 'Correct Score 2nd Set', 'Correct Score 3rd Set',
  '1st Set Race To 4.0', '2nd Set Race To 4.0', '3rd Set Race To 4.0',
  'Point Winner 1/3/1', 'Point Winner 1/2/1', 'Point Winner 1/1/1',
  'Point Winner 2/3/1', 'Point Winner 2/2/1', 'Point Winner 2/1/1',
  'Point Winner 3/3/1', 'Point Winner 3/2/1', 'Point Winner 3/1/1',
  'Point Winner 1/3/2', 'Point Winner 1/2/2', 'Point Winner 1/1/2',
  'Point Winner 2/3/2', 'Point Winner 2/2/2', 'Point Winner 2/1/2',
  'Point Winner 3/3/2', 'Point Winner 3/2/2', 'Point Winner 3/1/2',
  'HALF_TIME',
  'Match Result/Both Teams to score', 'Both Teams To Score',
  'Match Time Result 70:00', 'Match Time Result 10:00', 'Match Time Result 20:00', 'Match Time Result 30:00',
  'Match Time Result 40:00', 'Match Time Result 50:00', 'Match Time Result 60:00', 'Match Time Result 80:00',
  'Match Time Result 90:00',
  'oddeven', 'fancy1',
]);

module.exports = {
  marketsfornonfancy,
  fixedNonFancyMarkets,
  marketsfor01fancy,
  marketsforfancyCheck,
  ODDS_PRICED_FANCY_MARKETS,
  isNonFancyMarket,
};
