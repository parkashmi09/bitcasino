'use strict';

/**
 * Player settings — the shape of `userconfig`.
 *
 * ── WHY DEFAULTS ARE NAMED ───────────────────────────────────────────────
 *
 * `legacy/siteconfig/model/userconfigmodel.js`:
 *
 *     return rows[0] || {
 *       uid: uid,
 *       // Add default user config values here
 *     };
 *
 * The comment is the implementation. A player who had never saved a setting
 * got an object containing only their id, so every client reading `cfg.theme`
 * or `cfg.language` got `undefined` and had to invent its own fallback — which
 * means two clients could disagree about what "default" means.
 */

/** What a player who has saved nothing has. */
const DEFAULTS = Object.freeze({
  theme: 'dark',
  language: 'en',
  emailNotifications: true,
  pushNotifications: true,
  hideBalance: false,
});

/** An enum, not free text — the column is what a client renders from. */
const THEMES = Object.freeze(['dark', 'light']);

/**
 * Languages the platform ships strings for.
 *
 * Legacy stored whatever string arrived, so `userconfig.language` holds values
 * no client has a translation for and silently falls back for.
 */
const LANGUAGES = Object.freeze(['en', 'hi', 'pt', 'es', 'bn', 'ne', 'ur']);

module.exports = { DEFAULTS, THEMES, LANGUAGES };
