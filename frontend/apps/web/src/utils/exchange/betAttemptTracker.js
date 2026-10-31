/* Ported from TENEXCH components/betting/placeBet/betAttemptTracker.js, unchanged (7 attempts /
 * 60s per selection). SUPERSEDED for the submit gate by Addaplay's one-in-flight-per-market rule
 * (addaplay.js beginBetSubmit/endBetSubmit, BetSlip.jsx:485-489); kept for a screen that wants
 * TENEXCH's rolling limit on top. */

// ─── Anti-spam guard for bet submits ─────────────────────────────────────────
// Max MAX_ATTEMPTS submit attempts per SELECTION within the rolling WINDOW_MS;
// the attempt PAST that (the 8th) is blocked and the caller shows the toast
// "Multiple Bet Not Allowed On Same Time AND Same Market." This runs first, so
// it covers every retry loop — bookie-favour rejects, suspended markets and
// odds-changed rechecks all count toward the same limit.
//
// The caller builds the key as market_id|selectionId — per SELECTION, not per
// market, because the fancy feed puts every line ("3 over total", "6 over
// total", …) under one shared market id, and keying on that alone let one
// line's attempts lock out every other line in the match.
//
// Module-level so the count survives panel close/reopen on the same selection.
// A blocked attempt is NOT recorded — once the oldest attempt falls out of
// the window, betting on that selection opens up again by itself.

const WINDOW_MS = 60 * 1000;
const MAX_ATTEMPTS = 7;

const attemptsByMarket = new Map();

export function registerBetAttempt(marketKey) {
  const key = String(marketKey || 'unknown');
  const now = Date.now();
  const recent = (attemptsByMarket.get(key) || []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= MAX_ATTEMPTS) {
    attemptsByMarket.set(key, recent);
    return false; // more than 7 attempts at the same time on the same selection — blocked
  }
  recent.push(now);
  attemptsByMarket.set(key, recent);
  return true;
}
