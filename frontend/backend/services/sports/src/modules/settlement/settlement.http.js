'use strict';

/**
 * Transport-level helpers shared by the two settlement jobs.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE TWO CRONS NORMALIZE MARKET NAMES DIFFERENTLY, AND IT MATTERS
 *
 * Both files define functions called `normalizeText` and `normalizeMarketType`,
 * and they are NOT the same functions:
 *
 *   job.js         normalizeText       strips every non-alphanumeric, then uppercases
 *                  normalizeMarketType collapses whitespace, uppercases
 *   settlement.js  normalizeText       trims + uppercases + collapses whitespace ONLY
 *                  normalizeMarketType trims + uppercases ONLY
 *
 * So a market named "1st Innings 6 Overs Line" normalizes to
 * "1ST INNINGS 6 OVERS LINE" in both — but "Under/Over 2.5" becomes
 * "UNDEROVER 25" for the scanner and "UNDER/OVER 2.5" for the payout worker,
 * and "Match Time Result 70:00" loses its colon in one and keeps it in the
 * other. The scanner deciding a market is declared does NOT imply the payout
 * worker will find the same market.
 *
 * Both pairs are kept, named for the file they came from. Collapsing them to
 * one implementation would change which markets settle, in a way that is
 * invisible until a specific market type appears.
 * ═════════════════════════════════════════════════════════════════════════
 */

/** @legacy job.js `normalizeText` */
function scanNormalizeText(v) {
  if (!v) return '';

  return String(v)
    .replace(/\s+/g, ' ')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .toUpperCase();
}

/** @legacy job.js `normalizeMarketType` */
function scanNormalizeMarketType(v) {
  if (!v) return '';

  return String(v)
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** @legacy settlement.js `normalizeText` */
function normalizeText(v) {
  if (!v) return '';
  return String(v)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/** @legacy settlement.js `normalizeMarketType` */
function normalizeMarketType(v) {
  if (!v) return '';
  return String(v).trim().toUpperCase();
}

/** @legacy both files `sleep` */
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** @legacy both files `jitter` — spreads retries so N workers do not resynchronise. */
function jitter(ms) { return Math.round(ms * (1 + Math.random() * 0.25)); }

/** @legacy both files `parseRetryAfter` — seconds, or an HTTP-date, into ms. */
function parseRetryAfter(h) {
  if (!h) return null;
  const n = Number(h);
  if (!Number.isNaN(n)) return Math.max(0, Math.round(n * 1000));
  const d = Date.parse(h);
  return Number.isNaN(d) ? null : Math.max(0, d - Date.now());
}

/** @legacy both files `formatName` — declared, never called. Kept for parity. */
function formatName(name) {
  return (name || '').replace(/\s+/g, '').toLowerCase();
}

module.exports = {
  scanNormalizeText,
  scanNormalizeMarketType,
  normalizeText,
  normalizeMarketType,
  sleep,
  jitter,
  parseRetryAfter,
  formatName,
};
