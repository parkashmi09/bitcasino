/* Ported from TENEXCH frontend/src/utils/bookieFavour.js, unchanged. SUPERSEDED for the auto path by
 * Addaplay's evaluateBookieFavour (addaplay.js; same X/Y rule, but no live price -> accept at X, and
 * every non-fancy market is eligible). manualBetLiveCheck: TENEXCH (no Addaplay equivalent);
 * the manual gate is Addaplay's validateUnmatchedOdds (strict >= / <=). */

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  BOOKIE FAVOUR — Odds Validation Logic
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Applies ONLY to: MATCH_ODDS and BOOKMAKER markets.
 *  Fancy / Normal / other markets skip this entirely.
 *
 *  ─── TERMINOLOGY ───
 *  • selectedOdds   — odds when user clicked the cell
 *  • liveOdds       — odds fetched from API after buffer completes
 *  • editedOdds     — odds if user manually changed via +/- buttons
 *  • isManualEdit   — true if user used +/- buttons to change odds
 *
 *  ─── RULES (Live Odds — No Manual Edit) ─────────────────────────────────────
 *
 *  BACK bets:
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  Live odds >= Selected odds  →  ACCEPT (user gets same or better)  │
 *  │  Live odds <  Selected odds  →  REJECT (odds dropped, worse deal)  │
 *  └─────────────────────────────────────────────────────────────────────┘
 *  Example: Selected 1.38
 *    • Live becomes 1.40  →  ✅ Accept (higher = better for back)
 *    • Live becomes 1.37  →  ❌ Reject (lower  = worse for back)
 *
 *  LAY bets:
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  Live odds <= Selected odds  →  ACCEPT (user gets same or better)  │
 *  │  Live odds >  Selected odds  →  REJECT (odds rose, more liability) │
 *  └─────────────────────────────────────────────────────────────────────┘
 *  Example: Selected 1.36
 *    • Live becomes 1.34  →  ✅ Accept (lower = less liability for lay)
 *    • Live becomes 1.40  →  ❌ Reject (higher = more liability for lay)
 *
 *  ─── RULES (Manual Edit via +/- Buttons) ────────────────────────────────────
 *
 *  When user manually edits odds, comparison is: selectedOdds vs editedOdds.
 *  Live odds are NOT used in this case.
 *
 *  BACK manual edit:
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  Edited > Selected  →  REJECT ("Unmatched bet not allowed")        │
 *  │  Edited <= Selected →  ACCEPT (user accepts lower odds)            │
 *  └─────────────────────────────────────────────────────────────────────┘
 *  Example: Selected 1.38
 *    • User edits to 1.40 (+)  →  ❌ Reject (wants higher than market)
 *    • User edits to 1.30 (-)  →  ✅ Accept (accepts lower)
 *
 *  LAY manual edit:
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  Edited >= Selected →  ACCEPT (user accepts higher liability)      │
 *  │  Edited < Selected  →  REJECT ("Unmatched bet not allowed")        │
 *  └─────────────────────────────────────────────────────────────────────┘
 *  Example: Selected 1.35
 *    • User edits to 1.37 (+)  →  ✅ Accept (accepts higher liability)
 *    • User edits to 1.34 (-)  →  ❌ Reject (wants lower than market)
 *
 *  ─── BUFFER TIMING ──────────────────────────────────────────────────────────
 *
 *  • All accept/reject decisions happen ONLY after buffer time completes.
 *  • During buffer: only monitor + log, never reject early.
 *  • Buffer continuously fetches live odds every 500ms.
 *  • At buffer end: run bookieFavourCheck() with the final values.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// Tolerance for floating point comparison (0.001)
const EPSILON = 0.001;

/**
 * Check if the market type qualifies for Bookie Favour validation.
 * Only MATCH_ODDS and BOOKMAKER markets are validated.
 *
 * @param {string} marketType — e.g. 'MATCH_ODDS', 'BOOKMAKER', 'FANCY', 'Normal'
 * @returns {boolean} true if bookie favour rules apply
 */
export function isBookieFavourMarket(marketType) {
  // Strip spaces/underscores so 'MATCH_ODDS', 'Match Odds', 'BOOKMAKER',
  // 'Bookmaker 2' and 'Tied Match' all resolve. The payload carries the feed's
  // mname verbatim now, so a raw === comparison would silently skip the check
  // on Bookmaker 2 and let an adverse odds move through.
  const mt = String(marketType || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return mt === 'MATCHODDS' || mt === 'BOOKMAKER' || mt === 'BOOKMAKER2' || mt === 'TIEDMATCH';
}

/**
 * Validate BACK bet odds after buffer completion.
 *
 * Rule: For back bets, odds going UP or staying same = good for user = ACCEPT.
 *       Odds going DOWN = bad for user = REJECT.
 *
 * @param {number} selectedOdds — odds when user clicked the cell
 * @param {number} currentOdds  — live odds after buffer OR manually edited odds
 * @returns {boolean} true if bet should be ACCEPTED
 */
export function isBackOddsAcceptable(selectedOdds, currentOdds) {
  // Accept if current odds >= selected odds (same or better for user)
  return currentOdds >= selectedOdds - EPSILON;
}

/**
 * Validate LAY bet odds after buffer completion.
 *
 * Rule: For lay bets, odds going DOWN or staying same = good for user = ACCEPT.
 *       Odds going UP = bad for user (more liability) = REJECT.
 *
 * @param {number} selectedOdds — odds when user clicked the cell
 * @param {number} currentOdds  — live odds after buffer OR manually edited odds
 * @returns {boolean} true if bet should be ACCEPTED
 */
export function isLayOddsAcceptable(selectedOdds, currentOdds) {
  // Accept if current odds <= selected odds (same or less liability for user)
  return currentOdds <= selectedOdds + EPSILON;
}

/**
 * Validate manually edited BACK bet odds.
 *
 * Rule: If user increases odds via +/- → REJECT (unmatched, wants better than market).
 *       If user decreases or keeps same → ACCEPT (user sacrifices for guaranteed match).
 *
 * @param {number} selectedOdds — original odds when cell was clicked
 * @param {number} editedOdds   — odds after user's manual +/- edit
 * @returns {{ accept: boolean, reason: string }}
 */
export function validateBackManualEdit(selectedOdds, editedOdds) {
  // User increased odds → unmatched (wants more than market offers)
  if (editedOdds > selectedOdds + EPSILON) {
    return { accept: false, reason: 'Unmatched bet not allowed' };
  }
  // User decreased or kept same → accept
  return { accept: true, reason: '' };
}

/**
 * Validate manually edited LAY bet odds.
 *
 * Rule: If user increases odds via +/- → ACCEPT (user takes on more liability).
 *       If user decreases odds → REJECT (unmatched, wants less liability than market).
 *
 * @param {number} selectedOdds — original odds when cell was clicked
 * @param {number} editedOdds   — odds after user's manual +/- edit
 * @returns {{ accept: boolean, reason: string }}
 */
export function validateLayManualEdit(selectedOdds, editedOdds) {
  // User decreased odds → unmatched (wants less liability than market offers)
  if (editedOdds < selectedOdds - EPSILON) {
    return { accept: false, reason: 'Unmatched bet not allowed' };
  }
  // User increased or kept same → accept
  return { accept: true, reason: '' };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ENTRY POINT 1 of 2 — MANUAL BET (user edited the price)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Kept completely separate from the auto path on purpose: the auto (live-odds)
 *  rules were already working and must not be disturbed by manual-bet changes.
 *
 *  Two questions, in order:
 *
 *  1. GATE (instant, at submit, before any buffer / API call)
 *     Compares EDITED (E) vs CLICKED (X) only — live odds play no part.
 *       BACK  E > X → reject   ·  BACK  E < X → accept
 *       LAY   E < X → reject   ·  LAY   E > X → accept
 *     E == X (edit-then-revert) is not an edit at all — the caller routes it to
 *     the auto path instead.
 *
 *  2. LIVE CHECK (after the buffer, only for a bet the gate accepted)
 *     An allowed edit does NOT mean "execute at E". E is only the user's LIMIT
 *     — "E tak bhi chalega". The bet executes at the buffer-end LIVE price Y,
 *     and Y is compared against E (X is out of the picture by now):
 *
 *       BACK  (E below X, e.g. X 2.3 → E 2.1)
 *         Y 2.2  → accept @ 2.2   (live, better than the limit)
 *         Y 2.1  → accept @ 2.1   (equality always accepts)
 *         Y 2.0  → REJECT — the limit broke: paying 2.1 when the market is at
 *                  2.0 would be better-than-market for the user
 *       LAY   (E above X, e.g. X 2.3 → E 2.5) — mirror
 *         Y 2.4  → accept @ 2.4   ·  Y 2.5 → accept  ·  Y 2.6 → REJECT
 *
 *     The rejection uses the SAME 'Unmatched bet not allowed.' toast as the
 *     gate — it is the same situation (user asking better than the market),
 *     just discovered after the buffer, not an "odds changed" case.
 *
 *  Runs on EVERY editable market, not just MATCH_ODDS: TO_QUALIFY, HALF_TIME,
 *  OVER_UNDER… are all gtype 'match' and therefore editable too.
 */

/** Step 1 — the instant gate. @returns {{ accept, reason }} */
export function manualBetGate({ betType, selectedOdds, editedOdds }) {
  const isLay = betType === 'lay' || betType === 'no';
  return isLay
    ? validateLayManualEdit(selectedOdds, editedOdds)
    : validateBackManualEdit(selectedOdds, editedOdds);
}

/**
 * Step 2 — post-buffer live check. E is the user's limit; Y is what executes.
 * @returns {{ accept, reason, finalOdds }} finalOdds = the LIVE price Y.
 */
export function manualBetLiveCheck({ betType, editedOdds, liveOdds }) {
  const isLay = betType === 'lay' || betType === 'no';
  const accept = isLay
    ? isLayOddsAcceptable(editedOdds, liveOdds)   // Y must stay ≤ E
    : isBackOddsAcceptable(editedOdds, liveOdds); // Y must stay ≥ E
  return {
    accept,
    reason: accept ? '' : `Live ${liveOdds} broke the user's limit of ${editedOdds}`,
    // Execution is at the LIVE price, never at the limit the user typed.
    finalOdds: liveOdds,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ENTRY POINT 2 of 2 — AUTO BET (untouched price, live-odds rules)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  The original, working behaviour — compares LIVE vs CLICKED after the buffer:
 *    BACK  live ≥ clicked → accept @ live   ·  else reject
 *    LAY   live ≤ clicked → accept @ live   ·  else reject
 *  Only MATCH_ODDS / BOOKMAKER are validated; anything else passes through.
 *
 *  @returns {{ accept, reason, finalOdds }}
 */
export function autoBetCheck({ marketType, betType, selectedOdds, currentOdds }) {
  if (!isBookieFavourMarket(marketType)) {
    return { accept: true, reason: '', finalOdds: currentOdds };
  }

  const isBack = betType === 'back' || betType === 'yes';
  const isLay = betType === 'lay' || betType === 'no';

  if (isBack) {
    const accept = isBackOddsAcceptable(selectedOdds, currentOdds);
    return {
      accept,
      reason: accept ? '' : `Odds dropped from ${selectedOdds} to ${currentOdds}`,
      finalOdds: currentOdds,
    };
  }

  if (isLay) {
    const accept = isLayOddsAcceptable(selectedOdds, currentOdds);
    return {
      accept,
      reason: accept ? '' : `Odds rose from ${selectedOdds} to ${currentOdds}`,
      finalOdds: currentOdds,
    };
  }

  // Unknown bet type → accept
  return { accept: true, reason: '', finalOdds: currentOdds };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  LEGACY COMBINED ENTRY POINT
 * ═══════════════════════════════════════════════════════════════════════════════
 *  Superseded by manualBetGate / manualBetLiveCheck / autoBetCheck above. Kept
 *  so nothing that still imports it breaks; new code should use the split pair.
 *
 * Runs the full bookie favour check based on:
 *  - Market type (only MATCH_ODDS / BOOKMAKER)
 *  - Bet type (back/lay)
 *  - Whether user manually edited odds
 *  - Selected vs current/edited odds
 *
 * @param {Object} params
 * @param {string} params.marketType      — 'MATCH_ODDS', 'BOOKMAKER', etc.
 * @param {string} params.betType         — 'back', 'lay', 'yes', 'no'
 * @param {number} params.selectedOdds    — odds at time of click
 * @param {number} params.currentOdds     — live odds after buffer completion
 * @param {boolean} params.isManualEdit   — true if user used +/- to change odds
 * @param {number} params.editedOdds      — manually edited odds value (only if isManualEdit)
 * @returns {{ accept: boolean, reason: string, finalOdds: number }}
 */
export function bookieFavourCheck({
  marketType,
  betType,
  selectedOdds,
  currentOdds,
  isManualEdit = false,
  editedOdds = 0,
}) {
  // Step 1: Skip check for non-qualifying markets (Fancy, Normal, etc.)
  if (!isBookieFavourMarket(marketType)) {
    return { accept: true, reason: '', finalOdds: isManualEdit ? editedOdds : currentOdds };
  }

  const isBack = betType === 'back' || betType === 'yes';
  const isLay = betType === 'lay' || betType === 'no';

  // Step 2: Manual edit path — compare selected vs edited odds
  if (isManualEdit && editedOdds > 0) {
    if (isBack) {
      const result = validateBackManualEdit(selectedOdds, editedOdds);
      return { ...result, finalOdds: editedOdds };
    }
    if (isLay) {
      const result = validateLayManualEdit(selectedOdds, editedOdds);
      return { ...result, finalOdds: editedOdds };
    }
  }

  // Step 3: Live odds path — compare selected vs live odds after buffer
  if (isBack) {
    const accept = isBackOddsAcceptable(selectedOdds, currentOdds);
    return {
      accept,
      reason: accept ? '' : `Odds dropped from ${selectedOdds} to ${currentOdds}`,
      finalOdds: currentOdds,
    };
  }

  if (isLay) {
    const accept = isLayOddsAcceptable(selectedOdds, currentOdds);
    return {
      accept,
      reason: accept ? '' : `Odds rose from ${selectedOdds} to ${currentOdds}`,
      finalOdds: currentOdds,
    };
  }

  // Fallback: unknown bet type → accept
  return { accept: true, reason: '', finalOdds: currentOdds };
}
