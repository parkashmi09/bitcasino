/* Ported from TENEXCH frontend/src/utils/betToastMessages.js, unchanged. TENEXCH (no Addaplay
 * equivalent) for these keys; Addaplay's own strings live beside its functions in addaplay.js. */

// ─── Central toast strings for the sports bet-placement flow ─────────────────
// Single source of truth — keep the EXACT reference-site wording, including
// punctuation ("Bet Not Valid.." has two dots, "Game Not Active." has one).
// Used by usePlaceBetPanel / placeBetRules; add new bet toasts here first.

// Suspended / market-down reject wording. Held in its own const because TWO
// keys below carry it and they must never drift apart.
//
// Changed 2026-09-12: a suspended bet answers this, NOT the older
// "Bet Not Confirm Reason Game Not Active." that GAME_NOT_ACTIVE used to hold.
// Badlo already used this text, so the two are now one string.
//
// DELIBERATE DEVIATION — do not "correct" it. The live reference reads
// "…game suspense." (checked on a screenshot at 4x), but the user's call is to
// ship "suspend." here instead. It is a decision, not a typo.
const GAME_SUSPENSE = 'Bet Not Confirmed due to game suspend.';

export const BET_TOAST = {
  ENTER_VALID_STAKE: 'Enter a valid stake amount',
  SERVER_ERROR: 'Server Error',
  BET_NOT_VALID: 'Bet Not Valid..',
  MIN_STAKE: (min) => `Minimum bet amount is ${min}`,
  MAX_STAKE: (max) => `Maximum bet amount is ${max}`,
  // Fixed reference wording/HTML for below-min / above-max stake
  MIN_BET_LIMIT: 'Check Minimum Bet Limit.',
  // Virtual cricket (Dim/T5/T10/VCL) uses its own below-min wording and its
  // own ₹200 floor — reference toast is this exact text, trailing space and all
  BET_TOO_SMALL: 'Bet is too small. ',
  MAX_BET_LIMIT: 'Check Maximum Bet Limit1.',
  /* Racing's above-max toast (horse AND greyhound) — the SAME sentence without
     the trailing digit. Captured from the reference on an in-play racecard,
     where the feed
     quotes maxb 1 so the header reads "Max: 1" and any real stake is over the
     cap:
         <div class="toast-body">Check Maximum Bet Limit.</div>
     The digits on the other two are not typos — the reference really does emit
     numbered variants per reject reason (see GAME_NOT_ACTIVE_2 below, and the
     "Check Maximum Bet Limit2." the cashout note mentions) — so this is a third
     variant, not a correction of MAX_BET_LIMIT. Kept separate for that reason:
     every non-racing market keeps the exact text it was verified with. */
  MAX_BET_LIMIT_RACING: 'Check Maximum Bet Limit.',
  // Owner-set Max Odds (admin Settings → Max Odds). `scope` is the sport name
  // from the server, or LIMITED_OVERS_SCOPE for a cricket "Oneday & T20 only"
  // cell. Same text as server MESSAGES.BET.RATE_OVER_LIMIT.
  RATE_OVER_LIMIT: (max, scope) => `Bet Not Accept Rate Over ${Number(max).toFixed(2)} on ${scope}`,
  LIMITED_OVERS_SCOPE: 'Oneday and T20',
  // Every suspension / market-down reject: the SUSPENDED validation case, the
  // final live suspension read (suspensionToastMessage's non-BALL-RUNNING
  // branch), the buffer check and the combined-slip legs. The key name is kept
  // so the 12 call sites stay untouched — see GAME_SUSPENSE above for why the
  // wording changed. BALL RUNNING keeps its own toast.
  GAME_NOT_ACTIVE: GAME_SUSPENSE,
  // Badlo's suspension reject — same wording, same string.
  BADLO_GAME_SUSPENSE: GAME_SUSPENSE,
  // MATCH_ODDS maxb:1 kill-switch — the feed quotes maxb 1 when the market is
  // not bettable while still rendering OPEN. Reference: ~5s loader after
  // submit, then this exact toast (trailing "2", like "Check Maximum Bet Limit2.")
  GAME_NOT_ACTIVE_2: 'Game Not Active2.',
  // Cashout: the computed hedge stake falls outside the market's Min/Max
  // range (e.g. Min 100 / Max 1L header) — reference rejects with this text
  BET_NOT_CONFIRM_RANGE: 'Bet Not Confirm Reason Min and Max Bet Range Not Valid.',
  INVALID_BET: 'Invalid bet',
  BALL_RUNNING: 'Ball Running',
  ODDS_CHANGED: 'Odds changed',
  // Bookie-favour reject (live odds moved against the user) — reference shows
  // this fixed text, never the internal "Odds rose/dropped from X to Y" reason
  BET_NOT_CONFIRM_ODDS_CHANGE: 'Bet not confirm Odds change',
  CHECK_BALANCE: 'Bet Not Confirm Check Balance.',
  /* Racing's version NAMES the balance, so the player is told how short they
     are instead of just being refused. Reference, on a card whose header read
     "Max: 10K" (umaxbof 10000 — i.e. the cap is NOT the in-play 1, so this is a
     funds problem and not a limit one):
         <div class="toast-body">Bet Not Confirm Check Balance. 1253.98</div>
     Two decimals, no thousands separator, one space after the period — printed
     from the same wallet figure the header shows. */
  CHECK_BALANCE_RACING: (balance) => `Bet Not Confirm Check Balance. ${Number(balance || 0).toFixed(2)}`,
  MULTIPLE_BET_NOT_ALLOWED: 'Multiple Bet Not Allowed On Same Time AND Same Market.',
  // Manual odds edit in the favourable direction (BACK edited>selected /
  // LAY edited<selected) — reference (lords BetSlip.js:337-351) rejects it for
  // every user, only the against-market direction is allowed as an unmatched bet.
  UNMATCHED_NOT_ALLOWED: 'Unmatched bet not allowed.',
  BET_PLACED: 'Bet placed Successfully',
  BET_CANCELLED: 'Bet cancelled successfully',
  CANCEL_FAILED: 'Failed to cancel bet',
  NETWORK_ERROR: 'Network error',
  // TENEXCH SetButtonValueModal.jsx (stake-button edit save) — its literals, kept here so the
  // match page and the rail print the same text.
  STAKE_BUTTONS_SAVED: 'Update Button Value',
  STAKE_BUTTONS_FAILED: 'Failed to update button values',
  GENERIC_ERROR: 'Something went wrong',
};
