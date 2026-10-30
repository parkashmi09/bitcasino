/* Ported from TENEXCH frontend/src/utils/betHelpers.js, unchanged.
 * prepareBetPayload / oddsFormat / calculateFancyResults / calculateTiedMatchResults /
 * calculateMarketLiability: TENEXCH (no Addaplay equivalent).
 * calculateSingleBetPLValue + calculateMatchOddsResults are SUPERSEDED for the slip by Addaplay's
 * slipProfitLoss / slipExposureRows (addaplay.js); see docs/exchange.md, differences table. */

/**
 * betHelpers.js
 * Ported from old-code SportsPlaceBet.js helpers + realUserUtils.js
 * All API calls use the shared axiosClient.
 */

const normalizeName = (s) => String(s || '').trim().toLowerCase();

// 'BOOKMAKER' / 'Bookmaker 2' / 'MATCH_ODDS' / 'Match Odds' → one comparable key.
// The payload now carries the feed's mname verbatim, so every consumer must
// tolerate spaces and case (see placeBetRules.normalizeMarketKey).
const marketKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const isBookFamilyKey = (k) => k === 'BOOKMAKER' || k === 'BOOKMAKER2';

// BM-family (Bookmaker + Tied Match, gtype match1) multiplier: EVERY quote is
// percent — mult = odds/100, UNFLOORED (reference: back 100 @ 1.25 books +1.25,
// cashout lay @ 2.25 uses 0.0225). No >=10 cutoff. Backend normalizeOdds
// mirrors this exactly.
const bookmakerMult = (o) => o / 100;

/**
 * calculateSingleBetPLValue
 * Returns { profit, loss, exposure } for one bet.
 */
export function calculateSingleBetPLValue({ stake, odds, betType, marketType }) {
  const s = Number(stake) || 0;
  const o = Number(odds) || 0;

  const mtStr = String(marketType || '').toLowerCase();
  const isBookmaker = mtStr.includes('bookmaker');
  const isPercentMkt = isBookmaker || marketType === 'FANCY' || marketType === 'TIED_MATCH';
  // Percent markets (bookmaker / tied / fancy) quote SMALL numbers — 0.75, 1,
  // 1.25 — so any positive quote is valid. Only DECIMAL markets require >= 1.01.
  // (The old flat `o < 1.01` guard zeroed a tied bet at odds 1 → Profit showed 0.)
  if (s <= 0 || o <= 0 || (!isPercentMkt && o < 1.01)) return { profit: 0, loss: 0, exposure: 0 };

  // FANCY / TIED_MATCH: odds are percentage (profit = stake * odds / 100, loss = stake)
  if (marketType === 'FANCY' || marketType === 'TIED_MATCH') {
    const profit = (s * o) / 100;
    const loss = s;
    return { profit, loss, exposure: loss };
  }

  if (isBookmaker) {
    const val = bookmakerMult(o) * s;
    if (betType === 'back' || betType === 'yes') {
      return { profit: val, loss: s, exposure: s };
    } else {
      return { profit: s, loss: val, exposure: val };
    }
  }

  // Standard decimal odds
  if (betType === 'back' || betType === 'yes') {
    const profit = (o - 1) * s;
    const loss = s;
    return { profit, loss, exposure: loss };
  } else {
    const profit = s;
    const loss = (o - 1) * s;
    return { profit, loss, exposure: loss };
  }
}

/**
 * calculateMatchOddsResults
 * Per-runner net P&L for MATCH_ODDS / BOOKMAKER markets.
 * @param {Array} bets - existing matched bets
 * @param {Object|null} currentBet - the current (unsubmitted) bet preview
 * @param {string[]} teams - runner names
 * @returns {{ [team]: number }} net P&L per runner (positive = win, negative = loss)
 */
export function calculateMatchOddsResults(bets = [], currentBet = null, teams = []) {
  const allBets = [...(bets || [])];
  if (currentBet) allBets.push(currentBet);

  const validBets = allBets.filter(bet =>
    bet &&
    bet.marketType &&
    bet.odds !== undefined &&
    !isNaN(Number(bet.odds)) &&
    (bet.matchedStake ?? bet.stake) !== undefined &&
    !isNaN(Number(bet.matchedStake ?? bet.stake)) &&
    Number(bet.matchedStake ?? bet.stake) > 0
  );

  const results = {};
  teams.forEach((team) => {
    let net = 0;
    validBets.forEach((bet) => {
      const mtKey = marketKey(bet.marketType);
      const isBook = mtKey === 'MATCHODDS' || isBookFamilyKey(mtKey);
      if (!isBook) return;

      const odds = Number(bet.odds);
      const stake = Number(bet.matchedStake ?? bet.stake);
      if (!stake || isNaN(odds)) return;

      const mult = isBookFamilyKey(mtKey) ? bookmakerMult(odds) : odds - 1;
      const onThisTeam = normalizeName(bet.teamName) === normalizeName(team);

      if (bet.betType === 'back' || bet.betType === 'yes') {
        if (onThisTeam) {
          net += mult * stake;
        } else {
          net -= stake;
        }
      } else if (bet.betType === 'lay' || bet.betType === 'no') {
        if (onThisTeam) {
          net -= mult * stake;
        } else {
          net += stake;
        }
      }
    });
    results[team] = Number(net.toFixed(2));
  });

  return results;
}

/**
 * calculateFancyResults
 * Yes/No net P&L for FANCY markets.
 * @param {Array} bets
 * @returns {{ Yes: number, No: number }}
 */
export function calculateFancyResults(bets = []) {
  const valid = (bets || []).filter(b =>
    b && b.marketType === 'FANCY' &&
    (b.matchedStake ?? b.stake) > 0 &&
    !isNaN(Number(b.odds))
  );
  let yesNet = 0;
  let noNet = 0;

  valid.forEach(bet => {
    const stake = Number(bet.matchedStake ?? bet.stake);
    const odds = Number(bet.odds);
    if (bet.betType === 'yes') {
      yesNet += (stake * odds) / 100;
      noNet -= stake;
    } else if (bet.betType === 'no') {
      noNet += (stake * odds) / 100;
      yesNet -= stake;
    }
  });

  return { Yes: Number(yesNet.toFixed(2)), No: Number(noNet.toFixed(2)) };
}

/**
 * calculateTiedMatchResults
 * Yes/No net for TIED_MATCH. Normalises back→yes, lay→no.
 * @param {Array} bets
 * @returns {{ Yes: number, No: number }}
 */
export function calculateTiedMatchResults(bets = []) {
  const valid = (bets || []).filter(b =>
    b &&
    (b.marketType === 'TIED_MATCH' || b.marketType === 'FANCY') &&
    (b.matchedStake ?? b.stake) > 0 &&
    !isNaN(Number(b.odds))
  );
  let yesNet = 0;
  let noNet = 0;

  valid.forEach(bet => {
    const stake = Number(bet.matchedStake ?? bet.stake);
    const odds = Number(bet.odds);
    const side = (bet.betType === 'back' || bet.betType === 'yes') ? 'yes'
      : (bet.betType === 'lay' || bet.betType === 'no') ? 'no' : null;
    if (side === 'yes') {
      yesNet += (stake * odds) / 100;
      noNet -= stake;
    } else if (side === 'no') {
      noNet += (stake * odds) / 100;
      yesNet -= stake;
    }
  });

  return { Yes: Number(yesNet.toFixed(2)), No: Number(noNet.toFixed(2)) };
}

/**
 * prepareBetPayload
 * Builds the API payload for POST /user/place.
 * Ported from prepareRealBetPayload in realUserUtils.js.
 * Does NOT make any network call itself — just returns the plain object.
 */
/**
 * oddsFormat
 * The `odds` field carries THREE different scales and nothing in the payload
 * says which one — decimal (MATCH_ODDS 13.5), percent (Bookmaker 1000, Tied
 * 0.75) and a RUN LINE (session 143, where the rate lives in `size`). Deriving
 * it from `gtype` alone is impossible (match1+dtype4 = percent, match1+dtype2 =
 * Tied). We stamp it explicitly so the server/settlement never has to guess.
 * Additive only — no existing consumer reads it yet.
 */
export function oddsFormat(betValue) {
  const gtype = String(betValue?.gtype || '').toLowerCase();
  if (gtype === 'match') return 'decimal';
  if (gtype === 'match1') return 'percent';           // Bookmaker + Tied Match (o/100)
  if (gtype === 'fancy' || gtype === 'khado' || gtype === 'meter' || gtype === 'badlo') return 'line'; // rate is in `size`
  return 'decimal';                                    // oddeven / fancy1 / cricketcasino
}

export function prepareBetPayload(betValue, oddsNum, stakeNum, user, effectiveMarketType, effectiveBetType, effectiveTeam) {
  // Anything that is NOT match_odds or bookmaker is fancy-category
  const mtLower = String(effectiveMarketType || '').toLowerCase();
  const isMatchOrBookmaker = mtLower.includes('match_odds') || mtLower.includes('match odds') || mtLower.includes('bookmaker');
  const isFancyMarket = !isMatchOrBookmaker;
  const gameType = String(betValue?.game_type || 'MATCH');
  // "Tied Match" (gtype match1) is sent as FANCY so the backend accepts its
  // sub-1 odds; its market_type MUST stay "Tied Match" so the backend routes to
  // the dedicated unfloored Tied Match exposure branch (book = stake*odds/100).
  const isTied = String(betValue?.mname || betValue?.market_name || '').toLowerCase().includes('tied')
    && (betValue?.gtype === 'match1');

  // fancy_name: use the runner/selection name for fancy markets, never the game_type literal
  const fancyName = isFancyMarket
    ? String(betValue?.fancy_name || betValue?.team || betValue?.teamName || effectiveTeam || '')
    : '';

  // Khado rows quote TWO prices: back = the run line (50) and lay = the BAND
  // WIDTH (9) — the bet wins only if the runs land in 50…58. Nothing else on
  // the bet row records that width, so a khado bet persists it AS fancy_name.
  // `selection_name` below deliberately keeps the runner name: settlement
  // matches results on selection_name and the exposure map keys on it, so both
  // would break if the width leaked in there.
  const khadoRange = Number(betValue?.khado_range) || 0;
  const isKhadoBet = String(betValue?.gtype || '').toLowerCase() === 'khado';

  // Badlo is an EXACT-RUN swap that lives INSIDE an ordinary session market and
  // keeps that market's market_type ('Normal'). It travels as a FLAG, which the
  // server persists to SportsBet.badlo and routes every badlo money path on.
  // An earlier build forced market_type to the literal 'badlo': that gave these
  // rows their own market bucket, printed "badlo" as the market name in the bet
  // list, and split the runner's Normal book. `odds` carries the exact run,
  // `bet_type` yes = +stake on that run / no = -stake on it.
  const isBadloBet = betValue?.badlo === true;

  // gtype fancy3 = Under/Over OUTCOME market (virtual cricket "Total Runs /
  // Fours / Sixs", dtype 18). It quotes DECIMAL odds on two runners and the
  // line rides in the section's `min` (9.5), never in the price — so it is a
  // match-odds market, not a session bet. Sent as FANCY it normalises to FAN
  // server-side and then matches NO exposure branch at all (it is absent from
  // marketsforfancy AND isNonFancyMarket rejects it), so the bet booked zero
  // exposure and blocked zero balance. Rewritten HERE, not on the bet value,
  // so the panel still sees the feed's real gtype and keeps the odds locked
  // (usePlaceBetPanel derives oddsEditable from gtype === 'match').
  const isUnderOverOutcome = String(betValue?.gtype || '').toLowerCase() === 'fancy3';

  return {
    sports: betValue?.sports || 'Cricket',
    event_name: betValue?.event_name || '',
    market_name: betValue?.market_name || '',
    // market_type is the FEED's mname, verbatim — never our internal
    // classifyMarket() label. classifyMarket collapses every gtype 'match1'
    // market to 'BOOKMAKER', so "Bookmaker" and "Bookmaker 2" arrived
    // indistinguishable: the server keys UserExposure on market_type
    // (sportbetscontroller.js:963) and settlement joins UPPER(market_type) to
    // the result's mname (customMarketResolvers.js:66 already expects the
    // literal 'BOOKMAKER 2'). Both bookmakers therefore shared one exposure
    // bucket and settled off one result row.
    market_type: isTied
      ? 'Tied Match'
      : String(betValue?.mname || betValue?.market_name || betValue?.market_type || effectiveMarketType || ''),
    category: String((isFancyMarket || isTied) ? '1' : '0'),
    eventid: String(betValue?.event_id || ''),
    // League/competition (feed cname) — stored on SportsBet.league_name so the
    // statement Result modal can print "Sport -> League -> Match -> Market".
    league_name: String(betValue?.league_name || betValue?.cname || ''),
    fancy_name: (isKhadoBet && khadoRange > 0) ? String(khadoRange) : fancyName,
    fixed: 0,
    game_type: isUnderOverOutcome ? 'MATCH' : gameType,
    match_id: String(betValue?.match_id || betValue?.market_id || ''),
    match_start_time: String(betValue?.match_start_time || ''),
    match_title: String(betValue?.match_title || ''),
    odds: Number(oddsNum.toFixed(2)),
    original_amount: Number(stakeNum.toFixed(2)),
    original_currency: 'INR',
    selection_name: String(
      isFancyMarket
        ? (betValue?.fancy_name && betValue.fancy_name !== 'Unknown'
          ? betValue.fancy_name
          : (effectiveTeam && effectiveTeam !== 'Unknown'
            ? effectiveTeam
            : (effectiveBetType === 'yes' ? 'YES' : 'NO')))
        : effectiveTeam
    ),
    sid: betValue?.sid || '',
    // `sid` above is the SPORT id (4 = cricket) — it has never carried the
    // runner. The blocks capture the real runner id as `selectionId`
    // (section.sid) but it was dropped here, so settlement and UserExposure
    // could only key on the free-text `selection_name`. Send both, explicitly
    // named. Additive: `sid` keeps its old meaning for existing consumers.
    selection_id: betValue?.selectionId ?? betValue?.selection_id ?? null,
    sport_id: betValue?.sid || '',
    odds_format: oddsFormat(betValue),
    stake_amount: Number(stakeNum.toFixed(2)),
    team_one: (betValue?.market_type === 'TIED_MATCH' || (betValue?.market_type || '').toLowerCase() === 'tied match')
      ? String((betValue?.runners || [])[0] || 'Yes')
      : String(betValue?.team_one || ''),
    team_two: (betValue?.market_type === 'TIED_MATCH' || (betValue?.market_type || '').toLowerCase() === 'tied match')
      ? String((betValue?.runners || [])[1] || 'No')
      : String(betValue?.team_two || ''),
    user_id: String(user?.user_id || user?.id || '0'),
    count: betValue?.count || betValue?.outcomes?.length || 2,
    bet_type: effectiveBetType,
    badlo: isBadloBet,
    settlened: 'pending',
    nation: betValue?.team || effectiveTeam || '',
    user_rate: oddsNum,
    amount: stakeNum,
    place_date: new Date().toISOString().slice(0, 19).replace('T', ' '),
    // Reference sends these as NUMBERS (eventid/match_id stay strings) — the
    // route param arrives as a string and was never cast, so bet rows carried
    // "578372397" where the result feed compares 578372397.
    event_id: Number(betValue?.event_id) || betValue?.event_id || '',
    market_id: Number(betValue?.market_id) || betValue?.market_id || '',
    runners: betValue?.runners || [],
    back_size: betValue?.back_size || 0,
    lay_size: betValue?.lay_size || 0,
    size: betValue?.size || 0,
    unmatched: betValue?.unmatched !== undefined ? betValue.unmatched : false,
    // Unmatched contract (backend-verified): odds = original clicked odds,
    // unmatched_odds = the price the user asked for via +/-
    unmatched_odds: betValue?.unmatched_odds ?? null,
    // Cashout bets are money-wise normal; the flag lets the pipeline skip
    // post-buffer odds-change rejection and marks the row for reporting
    is_cashout: betValue?.is_cashout === true,
    runner_odds: betValue?.runner_odds || (() => {
      // Find the selected section's odds by matching nat/selectionId
      const sections = betValue?.market?.section || betValue?.section;
      if (!Array.isArray(sections)) return sections?.odds || [];
      const nat = (betValue?.nat || betValue?.fancy_name || effectiveTeam || '').trim().toLowerCase();
      const sid = betValue?.selectionId;
      const found = sections.find(s =>
        (sid && (String(s.sid) === String(sid))) ||
        (nat && (s.nat || '').trim().toLowerCase() === nat)
      );
      return found?.odds?.filter(o => o.oname === 'back1' || o.oname === 'lay1').map(o => ({ odds: o.odds, oname: o.oname })) || [];
    })(),
    mname: betValue?.mname || betValue?.market_name || effectiveMarketType || '',
    gtype: isUnderOverOutcome ? 'match' : (betValue?.gtype || betValue?.game_type || 'MATCH'),
    // Reference posts `section` as a JSON STRING, not an array. The server
    // accepts both (sportbetscontroller.js:204-212 JSON.parse-es a string) but
    // the column then stores two different shapes depending on which client
    // wrote the row — anything reading it back has to handle both. Match the
    // reference: always a string.
    section: (() => {
      // Prefer market.section (full runners array) over betValue.section (individual runner object)
      const mktSec = betValue?.market?.section;
      if (Array.isArray(mktSec)) return JSON.stringify(mktSec);
      const s = betValue?.section;
      if (Array.isArray(s)) return JSON.stringify(s);
      if (typeof s === 'string') {
        try {
          const parsed = JSON.parse(s);
          return JSON.stringify(Array.isArray(parsed) ? parsed : []);
        } catch {
          return '[]';
        }
      }
      return '[]';
    })(),
    nat: betValue?.nat || effectiveTeam || '',
  };
}

/**
 * calculateMarketLiability
 * Returns total liability (exposure) for a set of bets in one market.
 * Used by demo submission to compute the delta change in exposure.
 */
export function calculateMarketLiability(bets) {
  if (!bets || !bets.length) return 0;
  const marketType = bets[0].marketType;

  if (marketType === 'MATCH_ODDS' || marketType === 'BOOKMAKER') {
    const teams = [...new Set(bets.map(b => b.teamName))];
    const marketResults = {};

    teams.forEach(winningTeam => {
      let net = 0;
      bets.forEach(bet => {
        const stake = Number(bet.stake);
        const odds = Number(bet.odds);
        const mult = marketType === 'BOOKMAKER' ? bookmakerMult(odds) : odds - 1;
        const onThisTeam = normalizeName(bet.teamName) === normalizeName(winningTeam);

        if (bet.betType === 'back' || bet.betType === 'yes') {
          if (onThisTeam) {
            net += mult * stake;
          } else {
            net -= stake;
          }
        } else {
          if (onThisTeam) {
            net -= mult * stake;
          } else {
            net += stake;
          }
        }
      });
      marketResults[winningTeam] = net;
    });

    const minPL = Math.min(...Object.values(marketResults));
    return minPL < 0 ? Math.abs(minPL) : 0;

  } else if (marketType === 'FANCY') {
    let yesNet = 0;
    let noNet = 0;
    bets.forEach(bet => {
      const stake = Number(bet.stake);
      const odds = Number(bet.odds);
      if (bet.betType === 'yes') {
        yesNet += (stake * odds) / 100;
        noNet -= stake;
      } else {
        noNet += (stake * odds) / 100;
        yesNet -= stake;
      }
    });
    const minPL = Math.min(yesNet, noNet);
    return minPL < 0 ? Math.abs(minPL) : 0;
  }

  return 0;
}
