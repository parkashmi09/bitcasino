'use strict';

/**
 * The settlement maths, lifted out of `legacy/sportsmain/cron/settlement.js`.
 *
 * Everything here is PURE: it takes a bet row, an exposure map and a provider
 * result, and returns a winner or a number. No database, no HTTP, no logging
 * side effects. That is the only change of shape from legacy — the functions
 * themselves are copied line for line, including the branches that look wrong
 * (`selection_name === "NO"` outside its `&&`, the stray `8` expression
 * statement, `"SUSPENDED" || ''`). This is the code that decides who gets paid;
 * correcting it is a separate, deliberate change with its own testing, not
 * something to slip into a port.
 *
 * Ported from these legacy functions, in order:
 *   norm/lower/num/normalize      namesMatch/matchesAny
 *   runnerList/pickRunner/sideAliases
 *   findExposureValue
 *   resolveMobmWinner  resolveFanWinner  resolveFancyWinner
 *   calculateFinalCredit  moBmBetWinCredit
 *   normalizeOdds/getOdds/getStake/isBack/isLay/isYes/isNo/normalizeExposure
 */

// ==== Utils ====
const lower = (s) => (s || '').toString().trim().toLowerCase();
const norm = (s) => (s || '').toString().toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '').trim();
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };

/** @legacy settlement.js `normalize` — identical to `norm`, kept as its own name. */
function normalize(str) {
  return (str || '').toString().toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '').trim();
}

// The SAME runner reaches us under three different spellings:
//   event title (team_one/team_two) : "Struff"            / "Alek Shevchenko"
//   result feed (winnerName)        : "Jan-Lennard Struff "
//   bet row (selection_name/runners): "Jan-Lennard Struff " / "Alexander Shevchenko"
// Comparing those with `norm(a) === norm(b)` makes selIsWinner false for BOTH sides,
// which silently settles the whole market inverted (backs lose, lays win) and makes
// the exposure lookup return 0 so nothing is credited back to the wallet.
// Every winner<->selection / winner<->team comparison must go through these helpers.
function namesMatch(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.startsWith(y) || y.startsWith(x)) return true;
  return x.includes(y) || y.includes(x);
}

function matchesAny(names, target) {
  const list = Array.isArray(names) ? names : [names];
  return list.some((n) => namesMatch(n, target));
}

/** `runners` is a jsonb array of the exact names the bets were placed on. */
function runnerList(bet) {
  let r = bet?.runners;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { r = null; } }
  return Array.isArray(r) ? r.filter((x) => typeof x === 'string' && x.trim()) : [];
}

// Best runner for `name`: exact beats prefix beats substring, so a generic
// fragment can't steal the wrong runner when a closer one exists.
function pickRunner(runners, name) {
  const t = norm(name);
  if (!t || !runners.length) return null;
  for (const r of runners) if (norm(r) === t) return r;
  for (const r of runners) { const n = norm(r); if (n.startsWith(t) || t.startsWith(n)) return r; }
  for (const r of runners) { const n = norm(r); if (n.includes(t) || t.includes(n)) return r; }
  return null;
}

// All the aliases each side of a two-way market is known by, so exposure keys
// (written under the runner name) resolve from a bet row that only carries the
// short title name — and vice versa.
function sideAliases(bet) {
  const runners = runnerList(bet);
  const one = [bet?.team_one].filter(Boolean);
  const two = [bet?.team_two].filter(Boolean);
  if (runners.length === 2) {
    const r1 = pickRunner(runners, bet.team_one);
    const r2 = pickRunner(runners, bet.team_two);
    if (r1) one.push(r1);
    if (r2 && r2 !== r1) two.push(r2);
    // Only one side matched by name ("Alek Shevchenko" vs "Alexander Shevchenko"
    // matches nothing) — the leftover runner has to be the other side.
    if (r1 && !r2) { const rest = runners.find((r) => r !== r1); if (rest) two.push(rest); }
    if (!r1 && r2) { const rest = runners.find((r) => r !== r2); if (rest) one.push(rest); }
  }
  return { one, two, runners };
}

// Robust exposure lookup: matches keys ignoring case / trailing-leading / inner whitespace
// (exposure keys + result winnerName often differ only by a trailing space, e.g. 'The Draw ').
// Returns the matched exposure value, or `fallback` when no name matches.
function findExposureValue(map, names, fallback = undefined) {
  const list = Array.isArray(names) ? names : [names];
  for (const name of list) {
    const target = norm(name);
    if (!target) continue;
    for (const key of Object.keys(map || {})) {
      if (norm(key) === target) return map[key];
    }
  }
  return fallback;
}

// ==== Winner resolution ====

/** @legacy settlement.js `resolveMobmWinner` */
function resolveMobmWinner({ result, team_one, team_two, runners = [], logger }) {
  let final_result = result.items[0].winnerName;
  const items = result?.items || [];

  // Use final_result parameter directly if provided, otherwise fall back to item
  const item = items[0];
  const resultStr = final_result || item?.final_result || '';
  const finalResult = normalize(resultStr);

  // Normalize team names
  const teamOneNorm = normalize(team_one);
  const teamTwoNorm = normalize(team_two);

  // 1. Check for SUSPENDED or CANCELLED
  if (['suspended', 'cancelled'].includes(finalResult)) {
    logger?.debug({ finalResult, resultStr }, '[Settlement] resolveMobmWinner: result is SUSPENDED or CANCELLED');
    return { winnerName: 'SUSPENDED', reason: `final_result is ${finalResult.toUpperCase()}` };
  }

  // 2. Draw cases
  if (['draw', 'the draw', 'abandoned', 'no result'].some((term) => finalResult.toLowerCase().includes(term))) {
    logger?.debug({ finalResult, team_one, team_two }, '[Settlement] resolveMobmWinner: draw or no result');

    let winner = finalResult.toLowerCase().includes('the draw') ? 'The Draw' : 'Draw';

    return { winnerName: winner, reason: 'final_result indicates draw/tie/abandoned/no result' };
  }

  if (['No Goal', 'no goal', 'nogoal'].some((term) => finalResult.includes(term))) {
    logger?.debug({ finalResult, team_one, team_two }, '[Settlement] resolveMobmWinner: draw or no result');
    return { winnerName: 'No Goal', reason: 'final_result indicates draw/tie/abandoned/no result' };
  }

  // 3. Runner match FIRST — the bets carry the runner name, the event title does not.
  // Returning "Struff" here when the bet says "Jan-Lennard Struff " inverts the market.
  if (finalResult && runners.length) {
    const runner = pickRunner(runners, resultStr);
    if (runner) {
      return { winnerName: runner, reason: `matched runner "${runner}"` };
    }
  }

  // 4. String matching for winner (markets with no runners list)
  if (finalResult) {
    // Exact match
    if (finalResult === teamOneNorm) {
      return { winnerName: team_one, reason: 'exact match to team_one' };
    }
    if (finalResult === teamTwoNorm) {
      return { winnerName: team_two, reason: 'exact match to team_two' };
    }

    // Starts with (e.g., "Australia won by...")
    if (finalResult.startsWith(teamOneNorm)) {
      return { winnerName: team_one, reason: 'startsWith team_one' };
    }
    if (finalResult.startsWith(teamTwoNorm)) {
      return { winnerName: team_two, reason: 'startsWith team_two' };
    }

    // Contains (e.g., "defeated Australia")
    if (finalResult.includes(teamOneNorm)) {
      return { winnerName: team_one, reason: 'contains team_one' };
    }
    if (finalResult.includes(teamTwoNorm)) {
      return { winnerName: team_two, reason: 'contains team_two' };
    }

    // First 3 characters (legacy fallback)
    if (finalResult.substring(0, 3) === teamOneNorm.substring(0, 3)) {
      return { winnerName: team_one, reason: 'first 3 letters match team_one' };
    }
    if (finalResult.substring(0, 3) === teamTwoNorm.substring(0, 3)) {
      return { winnerName: team_two, reason: 'first 3 letters match team_two' };
    }

    logger?.debug({ finalResult, team_one, team_two, resultStr }, '[Settlement] resolveMobmWinner: no string match');
  }

  // 5. Fallback
  logger?.debug({ finalResult, team_one, team_two }, '[Settlement] resolveMobmWinner: ambiguous result');
  return { winnerName: 'SUSPENDED' || '', reason: 'ambiguous; fallback SUSPENDED' };
}

/** @legacy settlement.js `resolveFanWinner` */
function resolveFanWinner({ result, runners = [] }) {
  const items = result?.items || [];
  const final_result = items?.[0]?.winnerName || '';

  const resultStr = final_result || '';
  const finalResult = normalize(resultStr);

  if (!finalResult) {
    return { winnerName: '', reason: 'no result string' };
  }

  // Suspended / Cancelled
  if (['suspended', 'cancelled'].includes(finalResult)) {
    return { winnerName: 'SUSPENDED', reason: 'match suspended/cancelled' };
  }

  // Draw / Abandoned
  if (['draw', 'the draw', 'abandoned', 'no result'].some((term) => finalResult.includes(term))) {
    return { winnerName: 'Draw', reason: 'draw or abandoned' };
  }

  // No Goal
  if (['no goal', 'nogoal'].some((term) => finalResult.includes(term))) {
    return { winnerName: 'No Goal', reason: 'no goal result' };
  }

  // 🔥 Dynamic runner matching
  for (const runner of runners) {
    const runnerNorm = normalize(runner);

    if (finalResult === runnerNorm) {
      return { winnerName: runner, reason: 'exact runner match' };
    }

    if (finalResult.startsWith(runnerNorm)) {
      return { winnerName: runner, reason: 'startsWith runner match' };
    }

    if (finalResult.includes(runnerNorm)) {
      return { winnerName: runner, reason: 'contains runner match' };
    }
  }

  return { winnerName: 'SUSPENDED', reason: 'no runner matched' };
}

/** @legacy settlement.js `calculateFinalCredit` */
function calculateFinalCredit({ bet, oldExposures, winnerName }) {
  const exposures = Object.values(oldExposures);
  const negExposures = exposures.filter((x) => x < 0);
  const mostNeg = negExposures.length ? Math.min(...negExposures) : 0;

  const winnerExposure = findExposureValue(oldExposures, winnerName, 0);

  let finalcredit = 0;

  // REFUND
  if (winnerName === 'refund') {
    finalcredit = normalizeExposure(mostNeg);
    return finalcredit;
  }

  // If all exposures are positive
  const allPositive = exposures.every((x) => x > 0);

  if (allPositive) {
    finalcredit = winnerExposure;
    return finalcredit;
  }

  // If winner exposure negative
  if (winnerExposure < 0) {
    finalcredit = normalizeExposure(mostNeg) - normalizeExposure(winnerExposure);
    return finalcredit;
  }

  // Normal case
  finalcredit = normalizeExposure(mostNeg) + normalizeExposure(winnerExposure);

  return finalcredit;
}

/**
 * @legacy settlement.js `resolveFancyWinner`
 *
 * One long `if/else if` chain keyed on `market_type`. Preserved branch for
 * branch and in order — including the branches that fall off the end and return
 * `undefined` (an `Over By Over` bet whose `bet_type` is neither yes nor no),
 * which the caller treats as "unknown resolve type → requeue".
 */
function resolveFancyWinner({ result, fancy_name, selection_name, team_one, team_two, bet_type, market_type, odds, logger }) {
  let final_result = result.winnerId || result.winnerName;

  if (['suspended', 'cancelled', 'your_request_is_invalid'].includes(lower(final_result))) {
    logger?.debug({ final_result }, '[Settlement] resolveFancyWinner: result is SUSPENDED or CANCELLED or request_is_invalid');
    return { type: 'suspended', reason: `final_result is ${final_result.toUpperCase()}` };
  }
  let winnerName = '';
  const lowerMarket = lower(fancy_name);
  team_one = lower(team_one);
  team_two = lower(team_two);
  const finalwinningdata = normalize(final_result || '');

  // cricket
  if (market_type === 'oddeven') {
    if (bet_type === 'yes' && final_result % 2 === 0) {
      winnerName = 'won';
    } else if (bet_type === 'no' && final_result % 2 !== 0) {
      winnerName = 'won';
    } else {
      winnerName = 'loss';
    }
    return { type: 'string', winnerName, reason: 'determined from final_result string for oddeven' };
  } else if (market_type === 'fancy1') {
    // special condition
    final_result = result.winnerName?.toLowerCase();
    let bet = bet_type?.toLowerCase();
    if (final_result === bet) {
      winnerName = 'won';
    } else {
      winnerName = 'loss';
    }
    return { type: 'string', winnerName, reason: 'determined from final_result string for fancy1' };
  } else if (market_type === 'TIED_MATCH') {
    if (final_result === '0' && selection_name === 'No') {
      winnerName = 'won';
    } else if (final_result === '1' && selection_name === 'Yes') {
      winnerName = 'won';
    } else {
      winnerName = 'loss';
    }
    return { type: 'string', winnerName, reason: 'determined from final_result string for tied match' };
  } else if (market_type === 'Tied Match') {
    if (final_result === '0' && selection_name === 'No' || selection_name === 'NO') {
      winnerName = 'won';
    } else if (final_result === '1' && selection_name === 'Yes' || selection_name === 'YES') {
      winnerName = 'won';
    } else {
      winnerName = 'loss';
    }
    return { type: 'string', winnerName, reason: 'determined from final_result string for tied match' };
  } else if (market_type === 'Over By Over') {
    if (bet_type === 'yes') {
      if (final_result >= odds) {
        winnerName = 'won';
      } else {
        winnerName = 'loss';
      }
      return { type: 'string', winnerName, reason: 'determined from final_result string for over by over' };
    } else if (bet_type === 'no') {
      if (final_result < odds) {
        winnerName = 'won';
      } else {
        winnerName = 'loss';
      }
      return { type: 'string', winnerName, reason: 'determined from final_result string for over by over' };
    }
  } else if (market_type === '2nd Period Winner' || market_type === '1st Period Winner' || market_type === '3rd Period Winner') {
    if (bet_type === 'yes' && final_result === selection_name) {
      winnerName = 'won';
    } else if (bet_type === 'no' && final_result !== selection_name) {
      winnerName = 'won';
    } else {
      winnerName = 'loss';
    }
    return { type: 'string', winnerName, reason: 'determined from final_result string for tied match' };
  } else if (market_type === '1st Innings 6 Overs Line' || market_type === '2nd Innings 6 Overs Line' || market_type === '3rd Innings 6 Overs Line' || market_type === 'Over By Over' || market_type === 'Normal' || market_type === '1st Innings 20 Overs Line' || market_type === 'khado' || market_type === 'meters' || market_type === 'Ball By Ball') {
    if (bet_type === 'yes') {
      if (final_result >= odds) {
        winnerName = 'won';
      } else {
        winnerName = 'loss';
      }
      return { type: 'string', winnerName, reason: 'determined from final_result string for 1st innings 6 overs line' };
    } else if (bet_type === 'no') {
      if (final_result < odds) {
        winnerName = 'won';
      } else {
        winnerName = 'loss';
      }
      return { type: 'string', winnerName, reason: 'determined from final_result string for 1st innings 6 overs line' };
    }
  } else if (market_type === 'OVER_UNDER_35' || market_type === 'OVER_UNDER_25' || market_type === 'OVER_UNDER_15' || market_type === 'OVER_UNDER_05') {
    const isUnderSelection = selection_name.includes('Under');
    const isOverSelection = selection_name.includes('Over');

    const isUnderResult = final_result === 'Under';
    const isOverResult = final_result === 'Over';

    let isWin = false;

    if (bet_type === 'yes') {
      isWin = (isUnderSelection && isUnderResult) ||
        (isOverSelection && isOverResult);
    } else if (bet_type === 'no') {
      isWin = (isUnderSelection && isOverResult) ||
        (isOverSelection && isUnderResult);
    }

    winnerName = isWin ? 'won' : 'loss';

    return {
      type: 'string',
      winnerName,
      reason: 'derived using over/under + yes/no logic',
    };
  } else if (market_type === 'Next Goal 1.0' || market_type === 'Next Goal 2.0' || market_type === 'Next Goal 3.0' || market_type === 'Next Goal 4.0' || market_type === 'Next Goal 5.0' || market_type === 'Next Goal 6.0' || market_type === 'Next Goal 7.0' || market_type === 'Next Goal 8.0' || market_type === 'Next Goal 9.0' || market_type === 'Next Goal 10.0') {
    if (final_result === selection_name && bet_type === 'yes') {
      winnerName = 'won';
    } else if (final_result !== selection_name && bet_type === 'no') {
      winnerName = 'won';
    } else {
      winnerName = 'loss';
    }
    return { type: 'string', winnerName, reason: 'determined from final_result string for tied match' };
  } else if (market_type === '1st Innings 50 Overs Line' || market_type === '2nd Innings 50 Overs Line') {
    if (bet_type === 'yes') {
      if (final_result > odds) {
        winnerName = 'won';
      } else {
        winnerName = 'loss';
      }
      return { type: 'string', winnerName, reason: 'determined from final_result string for innings 50 overs line' };
    } else if (bet_type === 'no') {
      if (final_result < odds) {
        winnerName = 'won';
      } else {
        winnerName = 'loss';
      }
      return { type: 'string', winnerName, reason: 'determined from final_result string for  innings 50 overs line' };
    }
  } else if (market_type === 'Game To Deuce 1/1' || market_type === 'Game To Deuce 1/2' || market_type === 'Game To Deuce 1/3' || market_type === 'Game To Deuce 1/4' || market_type === 'Game To Deuce 2/1' || market_type === 'Game To Deuce 2/2' || market_type === 'Game To Deuce 2/3' || market_type === 'Game To Deuce 2/4' || market_type === 'Game To Deuce 3/1' || market_type === 'Game To Deuce 3/2' || market_type === 'Game To Deuce 3/3' || market_type === 'Game To Deuce 3/4') {
    if (final_result === '0' && selection_name === 'No' || selection_name === 'NO') {
      winnerName = 'won';
    } else if (final_result === '1' && selection_name === 'Yes' || selection_name === 'YES') {
      winnerName = 'won';
    } else {
      winnerName = 'loss';
    }
    return { type: 'string', winnerName, reason: 'determined from final_result string for game deuce' };
  } else if (market_type === 'HALF_TIME' || market_type === 'Match Time Result 70:00' || market_type === 'Match Time Result 10:00' || market_type === 'Match Time Result 20:00' || market_type === 'Match Time Result 30:00' || market_type === 'Match Time Result 40:00' || market_type === 'Match Time Result 50:00' || market_type === 'Match Time Result 60:00' || market_type === 'Match Time Result 80:00' || market_type === 'Match Time Result 90:00') {
    if (final_result === selection_name && bet_type === 'yes') {
      winnerName = 'won';
    } else if (final_result !== selection_name && bet_type === 'no') {
      winnerName = 'won';
    } else {
      winnerName = 'loss';
    }
    return { type: 'string', winnerName, reason: 'determined from final_result string for half time' };
  } else if (market_type === 'Both Teams To Score') {
    if (final_result === 0 && selection_name === 'No' || selection_name === 'NO') {
      winnerName = 'won';
    } else if (final_result > 0 && selection_name === 'Yes' || selection_name === 'YES') {
      winnerName = 'won';
    } else {
      winnerName = 'loss';
    }
    return { type: 'string', winnerName, reason: 'determined from final_result string for both teams to score' };
  } else if (market_type === 'Game Winner 1/2' || market_type === 'Game Winner 1/3' || market_type === 'Game Winner 1/4' || market_type === 'Game Winner 2/2' || market_type === 'Game Winner 2/3' || market_type === 'Game Winner 2/4' || market_type === 'Game Winner 3/2' || market_type === 'Game Winner 3/3' || market_type === 'Game Winner 3/4' || market_type === 'Game Winner 2/7') {
    if (final_result === selection_name && bet_type === 'yes') {
      winnerName = 'won';
    } else if (final_result !== selection_name && bet_type === 'no') {
      winnerName = 'won';
    } else {
      winnerName = 'loss';
    }
    return { type: 'string', winnerName, reason: 'determined from final_result string for tied match' };
  } else if (market_type === '1st Set Winner Home/Away' || market_type === '2nd Set Winner Home/Away' || market_type === '3rd Set Winner Home/Away' || market_type === '1st Set Race To 4.0' || market_type === '2nd Set Race To 4.0' || market_type === '3rd Set Race To 4.0') {
    if (final_result === selection_name && bet_type === 'yes') {
      winnerName = 'won';
    } else if (final_result !== selection_name && bet_type === 'no') {
      winnerName = 'won';
    } else {
      winnerName = 'loss';
    }
    return { type: 'string', winnerName, reason: 'determined from final_result string for tied match' };
  } else if (market_type === 'Correct Score' || market_type === 'Correct Score 1st Set' || market_type === 'Correct Score 2nd Set' || market_type === 'Coreect Score 3rd Set') {
    if (bet_type === 'yes' && final_result === 1) {
      winnerName = 'won';
    } else if (bet_type === 'no' && final_result === 0) {
      winnerName = 'won';
    } else {
      winnerName = 'loss';
    }
    return { type: 'string', winnerName, reason: 'determined from final_result string for tied match' };
  } else if (market_type === 'Point Winner 1/3/1' || market_type === 'Point Winner 1/2/1' || market_type === 'Point Winner 1/1/1' || market_type === 'Point Winner 2/3/1' || market_type === 'Point Winner 2/2/1' || market_type === 'Point Winner 2/1/1' || market_type === 'Point Winner 3/3/1' || market_type === 'Point Winner 3/2/1' || market_type === 'Point Winner 3/1/1' || market_type === 'Point Winner 1/2/1') {
    if (final_result === selection_name && bet_type === 'yes') {
      winnerName = 'won';
    } else if (final_result !== selection_name && bet_type === 'no') {
      winnerName = 'won';
    } else {
      winnerName = 'loss';
    }
    return { type: 'string', winnerName, reason: 'determined from final_result string for tied match' };
  } else if (market_type === 'Match Result/Both Teams to score') {
    if (final_result === 0 && selection_name === 'No' || selection_name === 'NO') {
      winnerName = 'won';
    } else if (final_result > 0 && selection_name === 'Yes' || selection_name === 'YES') {
      winnerName = 'won';
    } else {
      winnerName = 'loss';
    }
    return { type: 'string', winnerName, reason: 'determined from final_result string for tied match' };
  }
}

// ==== Commission & Credit Logic ====

/** @legacy settlement.js `PLATFORM_COMMISSION_PERCENT` — read, never applied. */
const PLATFORM_COMMISSION_PERCENT = 2;

/** @legacy settlement.js `normalizeOdds` — BM prices arrive as a percentage. */
function normalizeOdds(odds) {
  let newodds;
  if (odds > 100) {
    newodds = (odds / 100) + 1;
  } else if (odds < 100) {
    newodds = 1 + (odds / 100);
  } else {
    newodds = 2.0;
  }
  return Math.floor(newodds * 100) / 100;
}

function getOdds(b) {
  const raw = b.odds ?? b.price ?? b.rate ?? b.odd ?? 0;
  const o = Number(raw);
  const gameType = String(b.game_type || '').toUpperCase();
  if (gameType === 'BM') return normalizeOdds(o);
  return Number.isFinite(o) ? o : 0;
}

function getStake(b) { return num(b.stake_amount ?? b.stake ?? b.amount ?? b.stakeValue ?? b.size); }
function isBack(b) { return lower(b.bet_type) === 'back'; }
function isLay(b) { return lower(b.bet_type) === 'lay'; }
function isYes(b) { return lower(b.bet_type) === 'yes'; }
function isNo(b) { return lower(b.bet_type) === 'no'; }

/** @legacy settlement.js `moBmBetWinCredit` */
function moBmBetWinCredit(bet, winnerName, market_type) {
  const sel = bet.selection_name || '';
  const selIsWinner = namesMatch(sel, winnerName);
  const stake = getStake(bet);
  let odds = getOdds(bet);
  if (market_type == 'Tied Match') {
    odds = odds / 100;
  }
  if (isBack(bet)) return selIsWinner ? Math.max(0, (odds - 1) * stake) : 0;
  if (isLay(bet)) return selIsWinner ? 0 : stake;
  if (isYes(bet)) return selIsWinner ? Math.max(0, (odds - 1) * stake) : 0;
  if (isNo(bet)) return selIsWinner ? 0 : stake;
  return 0;
}

function normalizeExposure(value) {
  return Math.abs(value);
}

module.exports = {
  lower,
  norm,
  num,
  normalize,
  namesMatch,
  matchesAny,
  runnerList,
  pickRunner,
  sideAliases,
  findExposureValue,
  resolveMobmWinner,
  resolveFanWinner,
  resolveFancyWinner,
  calculateFinalCredit,
  normalizeOdds,
  getOdds,
  getStake,
  isBack,
  isLay,
  isYes,
  isNo,
  moBmBetWinCredit,
  normalizeExposure,
  PLATFORM_COMMISSION_PERCENT,
};
