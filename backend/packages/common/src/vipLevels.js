'use strict';

/**
 * The VIP ladder, keyed on lifetime wager.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE HASH.GAME LADDER (19 Oct 2026)
 *
 * 33 levels after Beginner, exactly as hash.game publishes them
 * (`GET /api/game/support/vip-v2/config/`, 1 XP = $1 wagered): Bronze I–IV,
 * Silver I–IV, Gold I–IV, Platinum I–IV, Diamond I–VII, Eternal I–X. The
 * referral unlock table (`siteconfig.referral_unlock_tiers`) names these levels,
 * so the two now agree. Names are editable in the site admin (VIP Club → Ladder,
 * `vip_level_names`), and so are the thresholds (`vip_level_names.min_xp`,
 * migration 133) — `resolveVipLadder` lays both over these defaults.
 *
 * It replaced a 41-level Wood…Diamond ladder (500 XP to 37,000,000), so every
 * existing player's level moved with it: a level is a function of lifetime
 * wager and nothing stored had to change. Level-up credits are keyed per level
 * (`vip:level_up:<user>:<level>`), so a player who passes a level number they
 * were already paid for is not paid again.
 *
 * ── LEVELS STAY NUMBERS ──────────────────────────────────────────────────
 *
 * The reference identifies levels by name (`BRONZE_1`). Here `level` is still
 * an ordinal 1…41, because every caller compares it numerically —
 * `bonus.service.js` gates on `vip.level >= spec.minVipLevel`, reports sort on
 * it — and a string would break all of them silently. `name` carries the
 * display form, so nothing downstream has to rebuild "Bronze 1" from a tier
 * and an offset.
 *
 * ── TWO THINGS THE LEGACY VERSION GOT WRONG, STILL FIXED ─────────────────
 *
 * 1. IT NAMED THE FIELDS BACKWARDS. `getVipLevelDetails` returned
 *    `vipLevel: nextVip.level` and `previousVipLevel: vip.level` — so the
 *    field called vipLevel was the level the player had NOT reached yet, and
 *    the one they actually held was called previous.
 *
 * 2. A PLAYER ABOVE THE TOP BAND FELL TO ZERO. Past the last band the function
 *    returned `{ error: ... }` with no level field, and the caller's
 *    `parseInt(undefined) || 0` made them VIP 0 — so the platform's biggest
 *    player would silently lose every bonus they qualified for. The top band
 *    is open-ended here.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * The bands. `minXp` is the "XP required" figure the VIP page prints for that
 * level; `maxXp` runs to one below the next band's floor. `maxXp` on the final
 * band is ignored — see the open-ended branch in `vipLevelFor`.
 */
const VIP_LEVELS = Object.freeze([
  { level:  1, name: 'Bronze I',     card: 'bronze',   minXp:        1000, maxXp:           2999 },
  { level:  2, name: 'Bronze II',    card: 'bronze',   minXp:        3000, maxXp:           6999 },
  { level:  3, name: 'Bronze III',   card: 'bronze',   minXp:        7000, maxXp:          14999 },
  { level:  4, name: 'Bronze IV',    card: 'bronze',   minXp:       15000, maxXp:          29999 },

  { level:  5, name: 'Silver I',     card: 'silver',   minXp:       30000, maxXp:          59999 },
  { level:  6, name: 'Silver II',    card: 'silver',   minXp:       60000, maxXp:         119999 },
  { level:  7, name: 'Silver III',   card: 'silver',   minXp:      120000, maxXp:         239999 },
  { level:  8, name: 'Silver IV',    card: 'silver',   minXp:      240000, maxXp:         499999 },

  { level:  9, name: 'Gold I',       card: 'gold',     minXp:      500000, maxXp:         999999 },
  { level: 10, name: 'Gold II',      card: 'gold',     minXp:     1000000, maxXp:        1999999 },
  { level: 11, name: 'Gold III',     card: 'gold',     minXp:     2000000, maxXp:        3499999 },
  { level: 12, name: 'Gold IV',      card: 'gold',     minXp:     3500000, maxXp:        5999999 },

  { level: 13, name: 'Platinum I',   card: 'platinum', minXp:     6000000, maxXp:        8499999 },
  { level: 14, name: 'Platinum II',  card: 'platinum', minXp:     8500000, maxXp:       10999999 },
  { level: 15, name: 'Platinum III', card: 'platinum', minXp:    11000000, maxXp:       14999999 },
  { level: 16, name: 'Platinum IV',  card: 'platinum', minXp:    15000000, maxXp:       24999999 },

  { level: 17, name: 'Diamond I',    card: 'diamond',  minXp:    25000000, maxXp:       39999999 },
  { level: 18, name: 'Diamond II',   card: 'diamond',  minXp:    40000000, maxXp:       64999999 },
  { level: 19, name: 'Diamond III',  card: 'diamond',  minXp:    65000000, maxXp:      109999999 },
  { level: 20, name: 'Diamond IV',   card: 'diamond',  minXp:   110000000, maxXp:      199999999 },
  { level: 21, name: 'Diamond V',    card: 'diamond',  minXp:   200000000, maxXp:      399999999 },
  { level: 22, name: 'Diamond VI',   card: 'diamond',  minXp:   400000000, maxXp:      999999999 },
  { level: 23, name: 'Diamond VII',  card: 'diamond',  minXp:  1000000000, maxXp:     1499999999 },

  { level: 24, name: 'Eternal I',    card: 'eternal',  minXp:  1500000000, maxXp:     2199999999 },
  { level: 25, name: 'Eternal II',   card: 'eternal',  minXp:  2200000000, maxXp:     3199999999 },
  { level: 26, name: 'Eternal III',  card: 'eternal',  minXp:  3200000000, maxXp:     4499999999 },
  { level: 27, name: 'Eternal IV',   card: 'eternal',  minXp:  4500000000, maxXp:     5999999999 },
  { level: 28, name: 'Eternal V',    card: 'eternal',  minXp:  6000000000, maxXp:     7199999999 },
  { level: 29, name: 'Eternal VI',   card: 'eternal',  minXp:  7200000000, maxXp:     8299999999 },
  { level: 30, name: 'Eternal VII',  card: 'eternal',  minXp:  8300000000, maxXp:     8999999999 },
  { level: 31, name: 'Eternal VIII', card: 'eternal',  minXp:  9000000000, maxXp:     9499999999 },
  { level: 32, name: 'Eternal IX',   card: 'eternal',  minXp:  9500000000, maxXp:     9999999999 },
  { level: 33, name: 'Eternal X',    card: 'eternal',  minXp: 10000000000, maxXp: 99999999999999 },
]);

const { makeLadder } = require('./vipLadder');

/**
 * The platform ladder as a value. The arithmetic — open-ended top, string
 * comparison, distance to the first band — lives in `vipLadder.js`, shared
 * with every other ladder a site may choose (see `vipLadders.js`), so two
 * ladders can never disagree about HOW a wager becomes a level, only about
 * WHERE the bands sit.
 *
 * `bonusGates` are the reference platform's own: daily and weekly from
 * Bronze 1 (1,000 lifetime wager), monthly from Silver 1 (10,000). See the
 * note in `services/user/src/modules/bonus/bonus.constants.js`.
 */
const PLATFORM_LADDER = makeLadder({
  key: 'platform',
  label: '33-level ladder — Bronze I to Eternal X',
  bands: VIP_LEVELS,
  unranked: { level: 0, name: 'Beginner', card: 'unranked' },
  // hash.game: "Users must have a VIP Level of 1 or higher to receive bonus" (Bronze I).
  bonusGates: { daily: 1, weekly: 1, monthly: 1 },
});

/** Level 0 — signed up, has not wagered enough to reach the first band. */
const UNRANKED = PLATFORM_LADDER.unranked;

/** `2` → `Bronze 1`. `0` and anything off the ladder → `Unranked`. */
const vipLevelName = PLATFORM_LADDER.levelName;

/**
 * Which VIP level a lifetime wager buys, on the PLATFORM ladder.
 *
 * Callers that serve a site should prefer `resolveVipLadder(models)` from
 * `vipLadders.js`, which honours the site's `vip` variant; this stays the
 * default for anything that has no site context.
 */
const vipLevelFor = PLATFORM_LADDER.levelFor;

module.exports = { VIP_LEVELS, UNRANKED, vipLevelName, vipLevelFor, PLATFORM_LADDER };
