/* Feed → kit prop shapes for the match page. Pure, no React and NO money maths: everything that
 * decides a number (status, limits, book keys) is read from `utils/exchange`; this file only
 * re-arranges feed fields into the `{ price, size }` ladders and row objects the kit draws.
 *
 * Feed shapes: services/exchange/feed.js (Market / section / odds) and docs/exchange.md. */

import {
  classifyMarket,
  isMarketSuspended,
  isSectionSuspended,
  isBallRunning,
} from '../../../utils/exchange';
import { marketLabel } from '../../Exchange/marketLabel';

const num = (v) => Number(v) || 0;
const gtypeOf = (m) => String(m?.gtype || '').toLowerCase();

/** One side of a runner's book as a kit ladder, best (tno 0) first. A 0 price is an empty rung. */
export function ladder(section, otype) {
  return (section?.odds || [])
    .filter((o) => String(o.otype || '').toLowerCase() === otype)
    .sort((a, b) => num(a.tno) - num(b.tno))
    .map((o) => ({ price: num(o.odds) > 0 ? num(o.odds) : null, size: num(o.size) || null }));
}

/** The best live price on one feed side (what a line-market bet executes at). */
export function bestPrice(section, otype) {
  return ladder(section, otype)[0]?.price ?? null;
}

/** Feed has the deep (3×3) ladder — "6 price columns". */
export const hasDepth = (market) => (market?.section || []).some((s) => (s.odds || []).length >= 6);

/**
 * The overlay word for one row, or null when it is open. Market-level first (isMarketSuspended
 * already skips the Bookmaker family's stale status), then ball running, then the runner's own
 * status (isSectionSuspended, which also reads `br`).
 */
export function rowStatus(market, section) {
  // A racecard (dtype 12) ignores the market's own SUSPENDED: the feed reports it for a race that
  // is still trading, and TENEXCH RacingDetails locks only per runner (gstatus) and per 0 price.
  if (Number(market?.dtype) !== 12 && isMarketSuspended(market)) return String(market.gstatus || market.status || 'SUSPENDED').toUpperCase();
  if (isBallRunning(section)) return 'BALL RUNNING';
  if (isSectionSuspended(section)) {
    const s = String(section?.gstatus || section?.status || '').toUpperCase();
    return s && s !== 'ACTIVE' && s !== 'OPEN' ? s : 'SUSPENDED';
  }
  return null;
}

/**
 * Which kit block draws a market.
 *   runner  MatchOddsBlock (Match Odds, Bookmaker, Tied, fancy1 back/lay)
 *   fancy   FancyBlock (session No|Yes: Normal, meter …)
 *   single  one-price rows (khado: Yes only; cricketcasino: Back only)
 *   oddeven OddEvenBlock     line  LineMarketBlock (every fancy2 market grouped)
 */
export function marketKind(market) {
  const g = gtypeOf(market);
  if (g === 'fancy1') return 'runner';
  if (g === 'khado' || g === 'cricketcasino') return 'single';
  switch (classifyMarket(market)) {
    case 'MATCH_ODDS':
    case 'BOOKMAKER':
      return 'runner';
    case 'LINE_MARKET':
      return 'line';
    case 'ODD_EVEN':
      return 'oddeven';
    case 'CRICKET_CASINO':
      return 'single';
    default:
      return 'fancy';
  }
}

/** Filter tab a market belongs to (from classifyMarket). */
export function marketTab(market) {
  switch (classifyMarket(market)) {
    case 'MATCH_ODDS':
      return 'odds';
    case 'BOOKMAKER':
      return 'bm';
    case 'FANCY':
      return 'fancy';
    default:
      return 'others';
  }
}

export const TAB_LABELS = [
  ['all', 'All'],
  ['odds', 'Match Odds'],
  ['bm', 'Bookmaker'],
  ['fancy', 'Fancy'],
  ['others', 'Others'],
];

/** Market title as printed ("MATCH_ODDS" → "Match Odds", "OVER_UNDER_15" → "Over/Under 1.5").
 *  Only a feed CODE goes through marketLabel; a named market ("10 over run AFG adv") prints as-is. */
export function marketTitle(market) {
  const n = String(market?.mname || '').trim();
  if (/^[A-Z0-9_]+$/.test(n) && /[A-Z]/.test(n)) return marketLabel(n);
  return n.replace(/_/g, ' ') || 'Market';
}

/** Exposure-book key, exactly as useMatchExposure builds it. */
export const bookKey = (mid, name) => `${String(mid).trim()}:${String(name || '').trim().toLowerCase()}`;

/** The current book for a row, or null when the player has none there. */
export function bookFor(book, mid, name) {
  const v = book?.[bookKey(mid, name)];
  return v == null ? null : Number(v);
}

/** Rows for a single-price block: khado shows "<run> - <band>" and its Yes (back) price. */
export function singleRow(market, section) {
  const g = gtypeOf(market);
  const back = ladder(section, 'back')[0] || { price: null, size: null };
  if (g === 'khado') {
    const band = bestPrice(section, 'lay') || 0;
    return { name: `${section.nat || '—'} - ${band}`, cell: { key: 'yes', side: 'back', ...back }, betType: 'yes', band };
  }
  return { name: section.nat || '—', cell: { key: 'back', side: 'back', ...back }, betType: 'back' };
}

/** "2 Hours 11 Minutes" far out, "4 Minutes 12 Seconds" inside the last hour — TENEXCH RaceTimer:
 *  hours only when non-zero, seconds only in the final hour. null at / after the off. */
export function raceCountdownText(startMs, now) {
  const diff = startMs - now;
  if (!(diff > 0)) return null;
  const total = Math.floor(diff / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h > 0 ? `${h} Hours ` : ''}${m} Minutes${h === 0 ? ` ${s} Seconds` : ''}`;
}

