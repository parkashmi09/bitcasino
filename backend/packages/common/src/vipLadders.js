'use strict';

/**
 * Every VIP ladder a site can choose, and which one THIS site runs.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE LADDER IS PART OF THE `vip` FEATURE VARIANT
 *
 * `docs/FEATURE-FLAGS.md` §1 found three ladders on three front ends and said
 * the ladder belongs to the backend. It does now: a site's `site_features`
 * row for `vip` names a variant, and the variant names a ladder. `GET
 * /user/vip`, `GET /user/vip/levels`, the `USER_INFO` socket payload, the
 * bonus gates and the operator's player reports all resolve the ladder the
 * same way, so a site that picks the Addaplay ladder is ranked on it
 * everywhere at once — and a front end draws what it is sent instead of
 * keeping a table of its own.
 *
 * Variants that do not name a ladder (`shuffle`, `bcgame`, `stake`, `none`)
 * run the platform ladder, exactly as before this file existed.
 * ═════════════════════════════════════════════════════════════════════════
 */

const { makeLadder } = require('./vipLadder');
const { VIP_LEVELS: PLATFORM_BANDS, PLATFORM_LADDER } = require('./vipLevels');

/**
 * Addaplay's ladder — the 75 bands its players were ranked on, lifted from
 * the reference platform's `packages/common/src/vipLevels.js` (itself lifted
 * verbatim from `legacy/bonus/calculateVip.js`), boundaries unchanged so no
 * player moves between levels on the way here.
 *
 * Names are `VIP 01` … `VIP 75` because that is what the Addaplay VIP page
 * prints and what its `calculateLevel.js` produced. Cards keep the legacy
 * spelling `brownz`: the front end's art is keyed on it.
 *
 * Bonus gates are the legacy ones for this ladder — daily from VIP 20
 * (29,000), weekly from VIP 25 (45,000), monthly from VIP 30 (69,000). The
 * platform's 2/2/7 would pay the daily bonus from 100 XP here.
 */
const name = (n) => `VIP ${String(n).padStart(2, '0')}`;
const band = (level, minXp, maxXp, card) => ({ level, name: name(level), card, minXp, maxXp });

const ADDAPLAY_BANDS = Object.freeze([
  band(1, 1, 99, 'brownz'),
  band(2, 100, 199, 'brownz'),
  band(3, 200, 999, 'brownz'),
  band(4, 1000, 1999, 'brownz'),
  band(5, 2000, 2999, 'brownz'),
  band(6, 3000, 3999, 'brownz'),
  band(7, 4000, 4999, 'brownz'),
  band(8, 5000, 6999, 'silver'),
  band(9, 7000, 8999, 'silver'),
  band(10, 9000, 10999, 'silver'),
  band(11, 11000, 12999, 'silver'),
  band(12, 13000, 14999, 'silver'),
  band(13, 15000, 16999, 'silver'),
  band(14, 17000, 18999, 'silver'),
  band(15, 19000, 20999, 'silver'),
  band(16, 21000, 22999, 'silver'),
  band(17, 23000, 24999, 'silver'),
  band(18, 25000, 26999, 'silver'),
  band(19, 27000, 28999, 'silver'),
  band(20, 29000, 30999, 'silver'),
  band(21, 31000, 44999, 'silver'),
  band(22, 45000, 48999, 'gold'),
  band(23, 49000, 58999, 'gold'),
  band(24, 59000, 68999, 'gold'),
  band(25, 69000, 78999, 'gold'),
  band(26, 79000, 88999, 'gold'),
  band(27, 89000, 98999, 'gold'),
  band(28, 99000, 108999, 'gold'),
  band(29, 109000, 118999, 'gold'),
  band(30, 119000, 128999, 'gold'),
  band(31, 129000, 138999, 'gold'),
  band(32, 139000, 148999, 'gold'),
  band(33, 149000, 158999, 'gold'),
  band(34, 159000, 168999, 'gold'),
  band(35, 169000, 178999, 'gold'),
  band(36, 179000, 188999, 'gold'),
  band(37, 189000, 296999, 'gold'),
  band(38, 297000, 320999, 'platinum'),
  band(39, 321000, 376999, 'platinum'),
  band(40, 377000, 432999, 'platinum'),
  band(41, 433000, 488999, 'platinum'),
  band(42, 489000, 544999, 'platinum'),
  band(43, 545000, 600999, 'platinum'),
  band(44, 601000, 656999, 'platinum'),
  band(45, 657000, 712999, 'platinum'),
  band(46, 713000, 768999, 'platinum'),
  band(47, 769000, 824999, 'platinum'),
  band(48, 825000, 880999, 'platinum'),
  band(49, 881000, 936999, 'platinum'),
  band(50, 937000, 992999, 'platinum'),
  band(51, 993000, 1048999, 'platinum'),
  band(52, 1049000, 1104999, 'platinum'),
  band(53, 1105000, 1160999, 'platinum'),
  band(54, 1161000, 1216999, 'platinum'),
  band(55, 1217000, 1272999, 'platinum'),
  band(56, 1273000, 2368999, 'platinum'),
  band(57, 2369000, 2656999, 'platinum'),
  band(58, 2657000, 2944999, 'platinum'),
  band(59, 2945000, 3232999, 'platinum'),
  band(60, 3233000, 3520999, 'platinum'),
  band(61, 3521000, 3808999, 'platinum'),
  band(62, 3809000, 4096999, 'platinum'),
  band(63, 4097000, 4384999, 'platinum'),
  band(64, 4385000, 4672999, 'platinum'),
  band(65, 4673000, 4960999, 'platinum'),
  band(66, 4961000, 5249999, 'platinum'),
  band(67, 5250000, 5537999, 'platinum'),
  band(68, 5538000, 8576999, 'platinum'),
  band(69, 8577000, 9216999, 'platinum'),
  band(70, 9217000, 10872832999, 'diamond'),
  band(71, 10872833000, 12058624999, 'diamond'),
  band(72, 12058625000, 13058624999, 'diamond'),
  band(73, 13058625000, 14058624999, 'diamond'),
  band(74, 14058625000, 15058624999, 'diamond'),
  band(75, 15058625000, 99999999999, 'diamond'),
]);

const ADDAPLAY_LADDER = makeLadder({
  /* Keyed on the VIP VARIANT that selects it, which is `club_ladder` since the
     variants stopped being named after the clone they came from. */
  key: 'club_ladder',
  label: '75-level ladder — VIP 01 to VIP 75',
  bands: ADDAPLAY_BANDS,
  unranked: { level: 0, name: name(0), card: 'brownz' },
  bonusGates: { daily: 20, weekly: 25, monthly: 30 },
});

/**
 * The Loyalty Club ladder (bitcasino.io/loyalty): seven levels on loyalty points,
 * Beginner 0–4, Fan 5, Expert 3,750, Master 30,000, Guru 250,000, Legend 750,000,
 * Hero 3,750,000 and up. One point = $1 wagered, the same XP every ladder counts.
 * `multiplier` and `milestones` are what the reference prints per level; they are
 * published for the page and change no payout.
 * bitcasino + smartbet only (not in hash-game-exchange): keep when porting hash's copy.
 */
const LOYALTY_BANDS = Object.freeze([
  { level: 1, name: 'Fan', card: 'fan', minXp: 5, maxXp: 3749, multiplier: '1', milestones: '1' },
  { level: 2, name: 'Expert', card: 'expert', minXp: 3750, maxXp: 29999, multiplier: '1', milestones: '6' },
  { level: 3, name: 'Master', card: 'master', minXp: 30000, maxXp: 249999, multiplier: '1.25', milestones: '12' },
  { level: 4, name: 'Guru', card: 'guru', minXp: 250000, maxXp: 749999, multiplier: '1.5', milestones: '11' },
  { level: 5, name: 'Legend', card: 'legend', minXp: 750000, maxXp: 3749999, multiplier: '2', milestones: '12' },
  { level: 6, name: 'Hero', card: 'hero', minXp: 3750000, maxXp: 99999999999999, multiplier: '3', milestones: 'unlimited' },
]);

const LOYALTY_LADDER = makeLadder({
  key: 'loyalty_club',
  label: 'Loyalty Club — 7 levels, Beginner to Hero (points)',
  bands: LOYALTY_BANDS,
  unranked: { level: 0, name: 'Beginner', card: 'beginner', multiplier: '1' },
  bonusGates: { daily: 1, weekly: 1, monthly: 1 },
});

/** Every ladder, by key. */
const VIP_LADDERS = Object.freeze({
  platform: PLATFORM_LADDER,
  club_ladder: ADDAPLAY_LADDER,
  loyalty_club: LOYALTY_LADDER,
  /** Pre-048 rows and any client still sending the old name. */
  addaplay: ADDAPLAY_LADDER,
});

/**
 * Which ladder a `vip` feature variant runs. The variant key IS the ladder key
 * where one exists; every other variant — and no variant at all — is the
 * platform ladder.
 */
const vipLadderFor = (variant) => VIP_LADDERS[variant] ?? PLATFORM_LADDER;

/**
 * The ladder THIS site runs, from its `site_features` row.
 *
 * One primary-key read, no cache — the same choice the features service
 * makes, so an operator who changes the variant sees the next request ranked
 * on the new ladder. A service whose models do not include `SiteFeature`
 * (its module manifest lists no `extended` domain), a missing row and a
 * database error all resolve to the platform ladder: a ranking read must
 * never take a profile or a bonus down with it.
 *
 * The variant is honoured whether or not the feature is switched ON. The
 * switch decides whether a VIP PAGE is drawn; the ladder still decides bonus
 * gates and report levels for a site that has chosen it.
 */
async function resolveVipLadder(models, { logger } = {}) {
  const SiteFeature = models?.SiteFeature;
  if (!SiteFeature) return PLATFORM_LADDER;
  let ladder = PLATFORM_LADDER;
  try {
    const row = await SiteFeature.findByPk('vip', { raw: true, attributes: ['variant'] });
    ladder = vipLadderFor(row?.variant);
  } catch (error) {
    logger?.warn({ err: error }, 'vip: could not read the site ladder, using the platform ladder');
    return PLATFORM_LADDER;
  }
  return rebrand(ladder, await vipBranding(SiteFeature.sequelize, { logger }));
}

/* ── Admin branding: per-level display names and per-card badges (migration 120) ──────────────
 * Names and pictures only. Bands, thresholds, cards and every reward key are untouched, so a
 * rename can never move a player or re-pay a reward. Read at most every BRANDING_TTL_MS. */
const BRANDING_TTL_MS = 10_000;
let branding = { at: 0, value: null };

/** For the admin routes: drop the cache after a rename or a badge upload. */
function clearVipBranding() {
  branding = { at: 0, value: null };
}

async function vipBranding(sequelize, { logger } = {}) {
  if (!sequelize?.query) return { names: new Map(), badges: new Map(), thresholds: new Map() };
  if (branding.value && Date.now() - branding.at < BRANDING_TTL_MS) return branding.value;
  try {
    const [names, badges] = await Promise.all([
      sequelize.query('SELECT level, name, min_xp FROM vip_level_names', { type: 'SELECT' }).catch(() =>
        // Before migration 133 there is no min_xp: names only.
        sequelize.query('SELECT level, name FROM vip_level_names', { type: 'SELECT' })
      ),
      sequelize.query('SELECT card, version FROM vip_badges', { type: 'SELECT' }),
    ]);
    branding = {
      at: Date.now(),
      value: {
        names: new Map(names.map((r) => [Number(r.level), String(r.name)])),
        thresholds: new Map(names.filter((r) => r.min_xp != null).map((r) => [Number(r.level), String(Number(r.min_xp))])),
        badges: new Map(badges.map((r) => [String(r.card), String(r.version)])),
      },
    };
  } catch (error) {
    // Tables not migrated yet (or unreadable): the built-in names, no badges.
    logger?.warn({ err: error.message }, 'vip: branding unreadable, using the built-in names');
    branding = { at: Date.now(), value: { names: new Map(), badges: new Map(), thresholds: new Map() } };
  }
  return branding.value;
}

const badgeUrlOf = (card, badges) =>
  badges.has(card) ? `/api/v1/admin/vip-branding/badges/${encodeURIComponent(card)}/image?v=${badges.get(card)}` : null;

/** The ladder with admin names and badge URLs laid over it; the same ladder when there are none. */
function rebrand(ladder, { names, badges, thresholds = new Map() }) {
  if (!names.size && !badges.size && !thresholds.size) return ladder;
  const floors = ladder.levels.map((b) => thresholds.get(b.level) ?? String(b.minXp));
  /* Thresholds the admin set must still climb; a set that does not (a half-finished edit) is
     ignored whole rather than ranking players on a broken ladder. */
  const climbs = floors.every((xp, i) => i === 0 || Number(xp) > Number(floors[i - 1]));
  return makeLadder({
    key: ladder.key,
    label: ladder.label,
    bonusGates: ladder.bonusGates,
    unranked: { ...ladder.unranked, name: names.get(0) ?? ladder.unranked.name, badgeUrl: badgeUrlOf(ladder.unranked.card, badges) },
    bands: ladder.levels.map((b, i) => ({
      ...b,
      name: names.get(b.level) ?? b.name,
      badgeUrl: badgeUrlOf(b.card, badges),
      ...(climbs && thresholds.size
        ? { minXp: Number(floors[i]), maxXp: i + 1 < floors.length ? Number(floors[i + 1]) - 1 : b.maxXp }
        : {}),
    })),
  });
}

module.exports = { VIP_LADDERS, ADDAPLAY_LADDER, ADDAPLAY_BANDS, LOYALTY_LADDER, PLATFORM_BANDS, vipLadderFor, resolveVipLadder, rebrand, clearVipBranding };
