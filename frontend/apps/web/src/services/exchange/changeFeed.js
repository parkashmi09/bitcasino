/**
 * ─── The player's sports data moved ──────────────────────────────────────────────────────
 *
 * TENEXCH apiservices/changeFeed.js. Every money write pushes a `balanceUpdate` on the sports
 * socket the moment it commits (backend lib/helper/pushBalance.mjs: a bet, a cancel, a void; the
 * settlement worker after a payout), and balanceSocket.js announces it here. What moves with the
 * money (the exposure book, open bets) refetches on USER_DATA_CHANGED instead of polling fast.
 * Debounced, so a settlement that pushes several times refetches once.
 */
export const USER_DATA_CHANGED = 'exchange:user-data-changed';
const DEBOUNCE_MS = 300;

let timer = null;
export function announceUserDataChange() {
  clearTimeout(timer);
  timer = setTimeout(() => window.dispatchEvent(new Event(USER_DATA_CHANGED)), DEBOUNCE_MS);
}
