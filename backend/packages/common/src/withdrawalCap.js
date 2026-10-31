'use strict';

const money = require('./money');

/**
 * Withdrawal cap — the owner's "deposit cap" switch of the `withdrawal_requirements` policy.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE SWITCHES (docs/OWNER-PANEL.md §2, owner panel → Features & plan → Policies)
 *
 *   KYC required               ┐ the policy's VARIANT, unchanged: none / kyc / wager /
 *   Wagering complete required ┘ kyc_and_wager = the four combinations of the two switches.
 *   Deposit cap                  the document's `withdrawalCap` block (this file):
 *                                `{ enabled, depositMultiplier, wagerBonus, wagerMultiplier }`.
 *
 * Any combination of the three. An older document (no `withdrawalCap`) reads as the cap off,
 * so nothing changes on a live site until the owner switches it on.
 *
 * ── THE RULE (per currency, in that currency) ───────────────────────────
 *
 *   cap       = deposited × depositMultiplier + min(wagered, deposited × wagerMultiplier)
 *               (the second term only while `wagerBonus` is on)
 *   remaining = max(cap − withdrawn, 0)
 *
 * With 1,000 deposited at the defaults (3×, bonus on, 5×): 1,000 wagered → 3,000 + 1,000 = 4,000;
 * 5,000 or more wagered → 3,000 + 5,000 = 8,000. The bonus unlocks 1:1 with the amount bet, so
 * what is still locked is also how much more the player has to wager to unlock it
 * (`wagerToRaise`).
 *
 * Counted in the currency itself, never converted: the cap limits money out of one wallet
 * column, so a rate move must not change it, and a coin without a USD rate still has a cap.
 * The figures: user-service modules/withdraw-requirements/withdrawCap.js.
 * ═════════════════════════════════════════════════════════════════════════
 */

const DEFAULTS = Object.freeze({ enabled: false, depositMultiplier: 3, wagerBonus: true, wagerMultiplier: 5 });

/** Each multiplier: a positive number, at most 2 decimal places, at most MAX. */
const MAX_MULTIPLIER = 100;
const FIELDS = Object.freeze(['enabled', 'depositMultiplier', 'wagerBonus', 'wagerMultiplier']);

const isMultiplier = (n) =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= MAX_MULTIPLIER && Math.round(n * 100) === n * 100;

/** Reading (the entitlements store, every reader): known fields only; a missing or bad value is its default. */
function cleanWithdrawalCap(value) {
  const given = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    enabled: typeof given.enabled === 'boolean' ? given.enabled : DEFAULTS.enabled,
    depositMultiplier: isMultiplier(given.depositMultiplier) ? given.depositMultiplier : DEFAULTS.depositMultiplier,
    wagerBonus: typeof given.wagerBonus === 'boolean' ? given.wagerBonus : DEFAULTS.wagerBonus,
    wagerMultiplier: isMultiplier(given.wagerMultiplier) ? given.wagerMultiplier : DEFAULTS.wagerMultiplier,
  };
}

/** Saving (strict, mirrored by the owner panel): the first problem, or null. */
function withdrawalCapProblem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'withdrawalCap must be an object';
  const extra = Object.keys(value).find((k) => !FIELDS.includes(k));
  if (extra) return `withdrawalCap.${extra} is not a field (${FIELDS.join(', ')})`;
  for (const k of ['enabled', 'wagerBonus']) {
    if (typeof value[k] !== 'boolean') return `withdrawalCap.${k} must be true or false`;
  }
  for (const k of ['depositMultiplier', 'wagerMultiplier']) {
    if (!isMultiplier(value[k])) return `withdrawalCap.${k} must be a number above 0 and at most ${MAX_MULTIPLIER}, with at most 2 decimals`;
  }
  return null;
}

const dec = (minor) => money.toDecimalString(minor);
const quantised = (v) => money.toMinorQuantised(String(v ?? '0'));

/**
 * The cap from the three totals (decimal strings in one currency) and the settings. Exact
 * (8-place minor units). Negative totals are floored at zero.
 */
function computeCap({ currency, deposited, withdrawn, wagered, settings }) {
  const s = cleanWithdrawalCap(settings);
  const zero = 0n;
  const dep = quantised(deposited) > zero ? quantised(deposited) : zero;
  const out = quantised(withdrawn) > zero ? quantised(withdrawn) : zero;
  const bet = quantised(wagered) > zero ? quantised(wagered) : zero;

  const base = money.multiply(dep, String(s.depositMultiplier));
  const bonusMax = s.wagerBonus ? money.multiply(dep, String(s.wagerMultiplier)) : zero;
  const unlocked = bet < bonusMax ? bet : bonusMax;
  const cap = base + unlocked;
  const remaining = cap > out ? cap - out : zero;

  return {
    enabled: s.enabled,
    currency: String(currency).toUpperCase(),
    deposited: dec(dep),
    withdrawn: dec(out),
    wagered: dec(bet),
    multiplier: s.depositMultiplier,
    wagerBonusEnabled: s.wagerBonus,
    wagerMultiplier: s.wagerMultiplier,
    base: dec(base),
    unlockedByWager: dec(unlocked),
    cap: dec(cap),
    remaining: dec(remaining),
    // Still locked in the wager bonus = what wagering more would unlock, 1:1.
    wagerToRaise: dec(bonusMax - unlocked),
  };
}

module.exports = { DEFAULTS, MAX_MULTIPLIER, FIELDS, cleanWithdrawalCap, withdrawalCapProblem, computeCap, isMultiplier };
