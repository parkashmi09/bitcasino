'use strict';

/**
 * Owner-only ON/OFF options of a feature: how it behaves, not whether the site has it.
 *
 * They travel in the owner panel's entitlement document as
 * `options: { <feature>: { <option>: boolean } }` (docs/OWNER-PANEL.md §2). The site admin never
 * sees or edits them. A key the document lacks reads as its DEFAULT here (not as "on", unlike a
 * flag), so a new option never changes a live site, and the defaults are today's behaviour.
 *
 * Mirrored, with labels, in `owner-panel/src/configs/entitlementCatalogue.ts` (FEATURE_OPTIONS).
 * Keys are a contract: add, never rename.
 */
const FEATURE_OPTIONS = Object.freeze({
  spin_wheel: Object.freeze({
    /** A new player gets one free spin (no deposit needed). */
    grant_on_registration: true,
    /** A player earns one spin after their first qualifying deposit (no cooldown). */
    grant_on_first_deposit: false,
    /** After the cooldown, a qualifying deposit earns the next spin. */
    grant_on_every_deposit: true,
    /** A won code may be applied to the player's first deposit (OFF: it waits for a later one). */
    bonus_on_first_deposit: true,
    /** A won code may be applied to a later (not first) deposit. */
    bonus_on_later_deposits: true,
  }),
  bonus: Object.freeze({
    /**
     * Bonuses (first-deposit, spin wheel) go to the player's locked BONUS BALANCE and become cash
     * only once their wagering requirement is met (migration 076, user-service `player-bonuses`).
     * OFF: they are credited straight to cash as before, with the rollover only stated.
     */
    wagering_lock: true,
  }),
  races: Object.freeze({
    /**
     * The player site's /tournaments page (live, upcoming and finished races with their boards).
     * OFF: the page and its nav entry are hidden; the races themselves still run and pay.
     */
    tournaments_page: true,
  }),
});

/** Only known features and options, only booleans. `{}` when absent. */
function cleanOptions(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return {};
  const out = {};
  for (const [feature, defaults] of Object.entries(FEATURE_OPTIONS)) {
    const given = map[feature];
    if (!given || typeof given !== 'object') continue;
    const kept = Object.fromEntries(
      Object.keys(defaults).filter((k) => typeof given[k] === 'boolean').map((k) => [k, given[k]])
    );
    if (Object.keys(kept).length) out[feature] = kept;
  }
  return out;
}

/** A feature's options with every default filled in: what the site runs on. */
function resolveOptions(doc, feature) {
  const defaults = FEATURE_OPTIONS[feature];
  if (!defaults) return {};
  const given = cleanOptions(doc?.options)[feature] ?? {};
  return { ...defaults, ...given };
}

module.exports = { FEATURE_OPTIONS, cleanOptions, resolveOptions };
