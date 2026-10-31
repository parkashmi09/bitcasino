'use strict';

/**
 * A sports bet as an operator reads it. mssports stores the literal "NULL" when a market has no
 * fancy name, keeps market codes raw (MATCH_ODDS, oddeven, fancy1, Normal) and puts three scales
 * in one `odds` column: decimal (Match Odds 1.53), the Bookmaker board (40 = 1.40) and a fancy
 * run line (55, its rate in `size`). Shared by Current Bets, a player's Bets tab and Risk.
 */

const present = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s && !/^(null|undefined)$/i.test(s) ? s : '';
};

const NAMES = { normal: 'Fancy', fancy: 'Fancy', fan: 'Fancy', fancy1: 'Fancy 1', oddeven: 'Odd / Even', mo: 'Match Odds', bm: 'Bookmaker' };

/** Fancy lines whose rate is in `size` (the exchange's `line` scale). */
const LINE = /^(normal|fancy|khado|meter|badlo)$/i;

/** MATCH_ODDS → "Match Odds", OVER_UNDER_15 → "Over/Under 1.5", oddeven → "Odd / Even". */
function marketLabel(code) {
  const s = present(code);
  const ou = /^OVER_UNDER_(\d)(\d)$/i.exec(s);
  if (ou) return `Over/Under ${ou[1]}.${ou[2]}`;
  return NAMES[s.toLowerCase()] ?? s.split(/[_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

const typeOf = (bet) => present(bet.market_type) || present(bet.game_type);

/** The fancy name for a fancy bet, else the market's label; null when the row names none. */
function marketName(bet) {
  return present(bet.fancy_name) || marketLabel(typeOf(bet)) || null;
}

/** The rate in its own scale: Bookmaker 40 → "1.40", fancy 55 / 100 → "55 @ 100", else "1.53". */
function rateText(bet) {
  const odds = Number(bet.odds);
  if (bet.odds == null || !Number.isFinite(odds)) return null;
  const type = typeOf(bet);
  if (/bookmaker/i.test(type)) return (odds / 100 + 1).toFixed(2);
  if (LINE.test(type)) {
    const size = Number(bet.size);
    return size > 0 ? `${odds} @ ${size}` : String(odds);
  }
  return odds.toFixed(2);
}

module.exports = { marketLabel, marketName, rateText };
