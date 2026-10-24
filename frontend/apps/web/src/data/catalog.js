/**
 * Seed content for the UI shell.
 *
 * Every title, studio name and image referenced here is an original
 * placeholder written for this project. None of the reference site's licensed
 * game artwork, game titles or studio marks are reproduced. Replace this
 * module with a real API response (see apps/api/src/routes/games.ts) once a
 * backend is wired up.
 *
 * The shapes of everything exported here are documented in ./types.js.
 */

/** @type {import('./types').Category[]} */
export const CATEGORIES = [
  { slug: 'originals', label: 'Originals', icon: 'sparkle' },
  { slug: 'live-casino', label: 'Live Casino', icon: 'live' },
  { slug: 'video-slots', label: 'Slots', icon: 'grid' },
  { slug: 'table-games', label: 'Table Games', icon: 'cards' },
  { slug: 'crash', label: 'Crash & Instant', icon: 'bolt' },
  { slug: 'game-shows', label: 'Game Shows', icon: 'trophy' },
  { slug: 'jackpots', label: 'Jackpots', icon: 'star' },
];

/** @type {import('./types').Provider[]} */
export const PROVIDERS = [
  { id: 'p1', name: 'Northlight Studio', slug: 'northlight', logo: '/images/providers/northlight.svg', gameCount: 184 },
  { id: 'p2', name: 'Vertex Play', slug: 'vertex-play', logo: '/images/providers/vertex-play.svg', gameCount: 142 },
  { id: 'p3', name: 'Lumen Games', slug: 'lumen-games', logo: '/images/providers/lumen-games.svg', gameCount: 97 },
  { id: 'p4', name: 'Halcyon Interactive', slug: 'halcyon', logo: '/images/providers/halcyon.svg', gameCount: 76 },
  { id: 'p5', name: 'Nine Peaks', slug: 'nine-peaks', logo: '/images/providers/nine-peaks.svg', gameCount: 64 },
  { id: 'p6', name: 'Copperline', slug: 'copperline', logo: '/images/providers/copperline.svg', gameCount: 58 },
  { id: 'p7', name: 'Tidewater Gaming', slug: 'tidewater', logo: '/images/providers/tidewater.svg', gameCount: 41 },
  { id: 'p8', name: 'Foxglove Labs', slug: 'foxglove', logo: '/images/providers/foxglove.svg', gameCount: 33 },
];

/** @type {Array<[string, import('./types').GameCategory]>} */
const TITLES = [
  ['Sunken Vault', 'originals'],
  ['Lantern Drift', 'video-slots'],
  ['Copper Canyon', 'video-slots'],
  ['Tidal Crown', 'video-slots'],
  ['Ember Trail', 'crash'],
  ['Northern Gate', 'video-slots'],
  ['Glass Harbour', 'live-casino'],
  ['Velvet Room', 'live-casino'],
  ['Cinder and Sable', 'video-slots'],
  ['Quartz Reef', 'video-slots'],
  ['Paper Lantern', 'game-shows'],
  ['Iron Orchard', 'video-slots'],
  ['Salt Flats', 'crash'],
  ['Midnight Parlour', 'table-games'],
  ['Amber Lodge', 'table-games'],
  ['Frost Hollow', 'video-slots'],
  ['Golden Thicket', 'jackpots'],
  ['Marble Court', 'live-casino'],
  ['Cobalt Sky', 'crash'],
  ['Wildwood Run', 'video-slots'],
  ['Silver Meridian', 'jackpots'],
  ['Harvest Moon Hall', 'game-shows'],
  ['Opal Springs', 'video-slots'],
  ['Redstone Gambit', 'table-games'],
];

const BADGES = ['new', 'hot', 'exclusive', 'jackpot', undefined, undefined];

/** Ranked low → high, so a sort can order on the index. */
export const VOLATILITY = ['low', 'medium', 'high'];

/** Deterministic pseudo-random, so the seed catalog is stable across renders. */
function seeded(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export const slugify = (value) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/**
 * The twenty-four generated placeholders.
 *
 * Not the whole catalogue — `GAMES` below is these plus the seven real live
 * tables the Live Exclusives theme is made of. Split so the generated set can
 * go on being generated while the curated one is written out by hand.
 *
 * @type {import('./types').Game[]}
 */
const GENERATED = TITLES.map(([title, category], i) => {
  const slug = slugify(title);
  const provider = PROVIDERS[i % PROVIDERS.length];
  const isLive = category === 'live-casino' || category === 'game-shows';
  const isJackpot = category === 'jackpots';

  return {
    id: `g${i + 1}`,
    title,
    slug,
    provider: provider.name,
    category,
    thumb: `/images/games/${slug}.svg`,
    thumbWide: `/images/games/${slug}-wide.svg`,
    badge: BADGES[i % BADGES.length],
    // The reference's sort control offers RTP, volatility and hit ratio, so
    // the seed carries all three rather than leaving those options inert.
    // Seeded, so a given title always reports the same numbers.
    rtp: Math.round((93 + seeded(i + 11) * 5.4) * 10) / 10,
    volatility: VOLATILITY[Math.floor(seeded(i + 17) * VOLATILITY.length)],
    hitRatio: Math.round((18 + seeded(i + 23) * 28) * 10) / 10,
    ...(isLive ? { players: Math.floor(seeded(i + 1) * 900) + 40 } : {}),
    ...(isJackpot ? { jackpot: Math.floor(seeded(i + 7) * 900_000) + 100_000 } : {}),
    /**
     * Whether the slot sells its bonus round outright, which is what
     * `/themes/bonus-buy-in` lists.
     *
     * A property of the GAME, seeded like the three stats above rather than
     * written into a hand-picked list — because on the reference that page is
     * seventy-four pages long. Nobody curates two and a half thousand titles;
     * it is a filter over a feature flag, and modelling it as a named list
     * here would be modelling the wrong thing (see `THEMES` in
     * `data/adapters/themes.js`, which argues the opposite way for the lists
     * that genuinely are curated).
     *
     * Slots only, as on the reference: every one of the games it lists is a
     * `video-slots` title, because buying into a bonus round is a slots
     * mechanic and a dealer table has nothing to sell.
     */
    ...(category === 'video-slots' && seeded(i + 29) > 0.45 ? { bonusBuy: true } : {}),
  };
});

/**
 * The five own-brand slots behind `/themes/bitcasino-exclusives`.
 *
 * Same argument as `LIVE_EXCLUSIVES` and `VIP_PRIVE` below: a theme page is a
 * list of specific named titles, and a placeholder standing in for one is not
 * the same page. These are five, and the reference's page is exactly five —
 * short enough that a substitution would be the whole page.
 *
 * Their artwork was already on disk. `public/images/games/` has carried these
 * five since the original scrape (`docs/07-assets.md`), unreferenced by
 * anything, because the catalogue had no rows to hang them on. It does now.
 *
 * ## No RTP, no volatility, no hit ratio
 *
 * These are real slots with published figures, and this file does not know
 * them. `LIVE_EXCLUSIVES` carries real numbers because a baccarat table's RTP
 * is a fixed, published property anyone can check; inventing five slot RTPs
 * and seeding them through `seeded()` would put made-up numbers under a real
 * game's name and sort the page by them.
 *
 * Leaving them off is already handled: `sortValue` ranks a game with no stat
 * last whichever way the list is sorted, rather than inventing a position for
 * it — see `byStat` in `components/sections/GameList.jsx`.
 *
 * @type {import('./types').Game[]}
 */
export const BITCASINO_EXCLUSIVES = [
  ['Book of Bitcasino', 'book-of-bitcasino', 'Spinomenal'],
  ['Bitcasino Sweets', 'bitcasino-sweets', 'Gameart'],
  ['Bitcasino Billion', 'bitcasinobillion', 'Bgaming'],
  ['BitShark Megaways', 'bitshark-megaways', 'OneTouch'],
  ['Bitcasino Starburst', 'bitcasinostarburst', 'NetEnt'],
].map(([title, slug, provider], i) => ({
  id: `bx${i + 1}`,
  title,
  slug,
  provider,
  category: 'video-slots',
  /* One crop, both fields — the captured tiles are portrait only. */
  thumb: `/images/games/${slug}.jpg`,
  thumbWide: `/images/games/${slug}.jpg`,
  /* Every one of the five carries this flag on the reference, which is the
     whole point of the page. */
  badge: 'exclusive',
}));

/**
 * Which category a dealer table belongs to, from its own name.
 *
 * `/categories/baccarat` and `/categories/blackjack` are slices of the live
 * casino, so the thirty-odd real tables in this file have to be filed under
 * one of the three — and a dealer table's name always states the game it
 * deals. `Salon Prive Blackjack H` is blackjack; there is no such thing as a
 * baccarat table called blackjack.
 *
 * Derived rather than written out per row on purpose: a column would be
 * thirty-odd chances to file `Salon Prive Blackjack L` under baccarat, and
 * nothing downstream would notice.
 *
 * Anything the name does not decide stays `live-casino`. That is one table
 * today — `Salon Prive Lobby`, which is the room rather than a game — and it
 * is the right answer for it: the lobby deals nothing, so it belongs on the
 * page that covers the whole room and on none of the three slices.
 *
 * @param {string} title
 * @returns {import('./types').GameCategory}
 */
const liveCategory = (title) => {
  if (/blackjack/i.test(title)) return 'blackjack';
  if (/baccarat/i.test(title)) return 'baccarat';
  if (/roulette/i.test(title)) return 'roulette';
  return 'live-casino';
};

/**
 * The seven Evolution tables behind `/themes/live-exclusives`.
 *
 * Unlike everything above, these are **real titles with the reference site's
 * own artwork**, which `public/images/games/` already carries — the theme page
 * is a list of seven specific tables and a placeholder standing in for one is
 * not the same page. `docs/07-assets.md` records the provenance of the files.
 *
 * They are ordinary catalogue rows in every other respect: the seeder writes
 * them into `gisgamesnew` beside the generated twenty-four, they answer
 * `/casino/games?type=live-casino` like any other live table, and nothing
 * downstream knows they are special. What makes the theme is
 * `data/adapters/themes.js`, which names them in this order.
 *
 * ## The stats are the published figures, not `seeded()`
 *
 * A live baccarat table's RTP is a fixed, published property of the game — it
 * is not something to make up, which is why these do not go through the
 * pseudo-random generator the twenty-four above use. `hitRatio` is left off
 * entirely: it is a slots statistic, nobody publishes one for a dealer table,
 * and `sortValue` already ranks a game that has none last rather than
 * inventing a position for it.
 *
 * `players` is off for the same reason it is off on the reference's own tiles:
 * these seven show no live-seat count there.
 *
 * @type {import('./types').Game[]}
 */

export const LIVE_EXCLUSIVES = [
  ['Exclusive Speed Baccarat', 'exclusive-speed-baccarat-1', 'exclusive', 98.9, 'low'],
  ['Exclusive Speed Roulette', 'exclusive-speed-roulette', 'exclusive', 97.3, 'medium'],
  ['Exclusive Salon Prive Baccarat', 'exclusive-salon-prive-baccarat', 'jackpot', 98.9, 'low'],
  ['Exclusive Blackjack 2', 'exclusive-blackjack-2', 'exclusive', 99.3, 'low'],
  ['Exclusive Blackjack', 'exclusive-blackjack', 'exclusive', 99.3, 'low'],
  ['Exclusive Speed Blackjack', 'exclusive-blackjack3', 'exclusive', 99.3, 'low'],
  ['Exclusive Squeeze Baccarat', 'exclusive-squeeze-baccarat', 'exclusive', 98.9, 'low'],
].map(([title, slug, badge, rtp, volatility], i) => ({
  id: `le${i + 1}`,
  title,
  slug,
  provider: 'Evolution',
  category: liveCategory(title),
  /**
   * One crop, both fields.
   *
   * The captured tiles are portrait only — the reference serves this theme's
   * art at 152x212 and has no 1.3:1 variant of it — so `thumbWide` is the same
   * file. `GameCard` only reaches for it on the featured rail, which no theme
   * game appears in; the alternative was a stretched crop nothing renders.
   */
  thumb: `/images/games/${slug}.jpg`,
  thumbWide: `/images/games/${slug}.jpg`,
  badge,
  rtp,
  volatility,
}));

/**
 * The nineteen Salon Prive tables behind `/themes/vip-prive`, plus the one it
 * shares with Live Exclusives.
 *
 * Same argument as `LIVE_EXCLUSIVES` above, and the same treatment: a theme
 * page is a list of specific named tables, so these are the real titles with
 * the reference's own artwork, fetched by `npm run assets:vip-prive` from the
 * sources listed in `./vipPriveArt.mjs`. `docs/07-assets.md` records the
 * provenance of the files.
 *
 * ## Why the list is nineteen and the page shows twenty
 *
 * `Exclusive Salon Prive Baccarat` is on both of the reference's theme pages.
 * It is one table and one catalogue row wherever it appears, so it stays in
 * `LIVE_EXCLUSIVES` where it already was and the VIP Prive theme simply names
 * its slug too — see `THEMES` in `data/adapters/themes.js`. Seeding it twice
 * would put two rows with the same uuid into `gisgamesnew`.
 *
 * ## Every one of them is badged `jackpot`
 *
 * Which `BADGE_LABEL` in `GameCard` prints as **High Roller** — the flag the
 * reference puts on all twenty of these, and the point of the page. The badge
 * is `label` on the catalogue row; it has nothing to do with a jackpot
 * *amount*, which is `parameters.jackpot` and which none of these carries.
 *
 * ## The stats are the published figures
 *
 * As with `LIVE_EXCLUSIVES`: a dealer table's RTP is a published property of
 * the game, not something `seeded()` should invent. Salon Privé Blackjack is
 * 99.28%, the baccarat tables are 98.94% on a banker bet, and single-zero
 * roulette is 97.30%. `hitRatio` is left off — it is a slots statistic — and
 * so is `players`, because the reference shows no seat count on these tiles.
 *
 * `salon-prive-lobby` is the one that is not a table: it is the room's own
 * lobby tile, which the reference lists first-class among the twenty.
 *
 * @type {import('./types').Game[]}
 */
export const VIP_PRIVE = [
  ['Salon Prive Blackjack A', 'salon-prive-blackjack-a', 99.28, 'low'],
  ['Salon Prive Lobby', 'salon-prive-lobby', 99.28, 'low'],
  ['Salon Prive Blackjack F', 'salon-prive-blackjack-f', 99.28, 'low'],
  ['Salon Prive Baccarat D', 'salon-prive-baccarat-d', 98.94, 'low'],
  ['Salon Prive Blackjack G', 'salon-prive-blackjack-g', 99.28, 'low'],
  ['Salon Prive Blackjack H', 'salon-prive-blackjack-h', 99.28, 'low'],
  ['Salon Prive Baccarat', 'salon-prive-baccarat', 98.94, 'low'],
  ['Salon Prive Blackjack I', 'salon-prive-blackjack-i', 99.28, 'low'],
  ['Salon Privé Auto Roulette B', 'salon-prive-auto-roulette-b', 97.3, 'medium'],
  ['Salon Prive Blackjack J', 'salon-prive-blackjack-j', 99.28, 'low'],
  ['Salon Prive Blackjack K', 'salon-prive-blackjack-k', 99.28, 'low'],
  ['Salon Prive Blackjack L', 'salon-prive-blackjack-l', 99.28, 'low'],
  ['Salon Prive Blackjack M', 'salon-prive-blackjack-m', 99.28, 'low'],
  ['Salon Prive Blackjack C', 'salon-prive-blackjack-c', 99.28, 'low'],
  ['Korean Salon Prive Baccarat', 'korean-salon-prive-baccarat', 98.94, 'low'],
  ['Salon Prive Blackjack D', 'salon-prive-blackjack-d', 99.28, 'low'],
  ['Salon Prive Roulette', 'salon-prive-roulette', 97.3, 'medium'],
  ['Salon Prive Blackjack E', 'salon-prive-blackjack-e', 99.28, 'low'],
  ['Salon Prive Baccarat C', 'salon-prive-baccarat-c', 98.94, 'low'],
].map(([title, slug, rtp, volatility], i) => ({
  id: `vp${i + 1}`,
  title,
  slug,
  provider: 'Evolution',
  category: liveCategory(title),
  /* One crop, both fields — see `LIVE_EXCLUSIVES` above for why. */
  thumb: `/images/games/${slug}.avif`,
  thumbWide: `/images/games/${slug}.avif`,
  badge: 'jackpot',
  rtp,
  volatility,
}));

/**
 * The whole placeholder catalogue: the generated twenty-four, the seven
 * curated live tables, the nineteen Salon Prive ones, and the five own-brand
 * slots. This is the list
 * `backend/scripts/seed-data.js` reads to fill `gisgamesnew`, and no page
 * reads it directly any more — so a game added here reaches the app only after
 * `npm run db:seed`.
 *
 * @type {import('./types').Game[]}
 */
export const GAMES = [...GENERATED, ...LIVE_EXCLUSIVES, ...VIP_PRIVE, ...BITCASINO_EXCLUSIVES];

export const byCategory = (category) =>
  GAMES.filter((game) => game.category === category);

/**
 * The `/games/:slug` lists — collections cut from the catalogue by something
 * other than category, which is what the sidebar's "New Releases" and
 * "Live RTP" rows and the home rails' "See all" links point at. Without these
 * those routes resolve to no category and render an empty grid.
 */
export const COLLECTIONS = {
  new: {
    label: 'New Releases',
    select: (games) => games.filter((game) => game.badge === 'new'),
  },
  exclusives: {
    label: 'BitCasino Exclusives',
    select: (games) => games.filter((game) => game.badge === 'exclusive'),
  },
  'live-rtp': {
    label: 'Live RTP',
    select: (games) => [...games].sort((a, b) => b.rtp - a.rtp),
  },
};

/** Pad a short rail with filler so every row scrolls, as on the reference site. */
const rail = (category, from) => {
  const primary = byCategory(category);
  const filler = GAMES.filter((g) => g.category !== category).slice(from, from + 10);
  return [...primary, ...filler].slice(0, 12);
};

/**
 * Eight rails, run consecutively, in the same order as the reference home
 * page. Everything editorial (trust, provider, promo and guide blocks) sits
 * below them rather than interleaved.
 */
export const HOME_RAILS = [
  { title: 'BitCasino Originals', href: '/categories/originals', games: rail('originals', 0) },
  { title: 'Best Live Casino games', href: '/categories/live-casino', games: rail('live-casino', 2) },
  { title: 'Best Slot games', href: '/categories/video-slots', games: rail('video-slots', 4) },
  { title: 'New Releases', href: '/games/new', games: GAMES.filter((g) => g.badge === 'new') },
  { title: 'BitCasino Exclusives', href: '/games/exclusives', games: GAMES.filter((g) => g.badge === 'exclusive') },
  { title: 'Crash and Instant Win', href: '/categories/crash', games: rail('crash', 6) },
  { title: 'Best table games', href: '/categories/table-games', games: rail('table-games', 8) },
];

/**
 * The themes rail sits between "Exclusives" and "Crash" on the reference page.
 * Home splits HOME_RAILS at this index to slot it in.
 */
export const THEME_RAIL_INDEX = 5;

/** Curated collections. These link to collection pages, not single games. */
export const THEMES = [
  { id: 't1', label: 'Live Exclusives', href: '/themes/live-exclusives', art: '/images/themes/live-exclusives.svg' },
  { id: 't2', label: 'VIP Salon', href: '/themes/vip-salon', art: '/images/themes/vip-salon.svg' },
  { id: 't3', label: 'House Exclusives', href: '/themes/house-exclusives', art: '/images/themes/house-exclusives.svg' },
  { id: 't4', label: 'Bonus Buy-In', href: '/themes/bonus-buy-in', art: '/images/themes/bonus-buy-in.svg' },
  { id: 't5', label: 'Megaways', href: '/themes/megaways', art: '/images/themes/megaways.svg' },
  { id: 't6', label: 'Drops and Wins', href: '/themes/drops-and-wins', art: '/images/themes/drops-and-wins.svg' },
];

/**
 * Card copy for the testimonials rail — `title`, `quote` and a 1-5 `rating`,
 * matching the shape the reference site's review cards render. Written for
 * this project; these are not collected from real players.
 */
export const TESTIMONIALS = [
  {
    id: 'r1',
    title: 'Ultrafast withdrawals!',
    rating: 5,
    quote:
      'Withdrawals land before I have closed the tab. I cashed out on a Sunday night and the coins were in my wallet by the time I switched windows. After years of waiting three days elsewhere, that alone is why I stayed.',
    author: 'Mara K.',
  },
  {
    id: 'r2',
    title: 'The live tables are the best',
    rating: 5,
    quote:
      'Every live table loads instantly, the streams never stutter, and the dealers are genuinely good at their job. It feels far closer to a real floor than anything else I have played on.',
    author: 'Devin O.',
  },
  {
    id: 'r3',
    title: 'Best support I have had',
    rating: 5,
    quote:
      'Support answered in under two minutes, at three in the morning, and actually solved the problem instead of pasting a help article at me. No queue, no scripted replies, just a straight answer.',
    author: 'Priya S.',
  },
  {
    id: 'r4',
    title: 'Clean, no nonsense',
    rating: 4,
    quote:
      'Clean interface, nothing shouting at me, and the tournament leaderboard is easy to follow. I can find the game I want in two clicks, which sounds small until you have used the alternatives.',
    author: 'Tomas L.',
  },
  {
    id: 'r5',
    title: 'Huge range of games',
    rating: 5,
    quote:
      'The selection is enormous and it keeps growing every week. New releases show up here long before the other sites I use, and the provider filters make a catalogue that size genuinely browsable.',
    author: 'Aiko N.',
  },
  {
    id: 'r6',
    title: 'Deposits are effortless',
    rating: 4,
    quote:
      'Ten different coins accepted and every deposit has cleared in one confirmation. I have never had to email anyone about a stuck payment, which is more than I can say for the last two casinos I tried.',
    author: 'Rafael M.',
  },
  {
    id: 'r7',
    title: 'Worth it for the VIP perks',
    rating: 5,
    quote:
      'The loyalty tiers actually mean something. Cashback lands on time, the rewards are worth claiming, and my host checks in without ever pushing me to deposit more. That balance is rare.',
    author: 'Elena V.',
  },
];

/**
 * The promotion cards that do **not** have a promotion page behind them.
 *
 * `/promotions` renders `PROMO_PAGES` first (see `data/promotionPages.js`) and
 * then these, and the `Other promotions` rail beside a detail page draws from
 * the same two lists in the same order. So a row here is one thing: a standing
 * offer that lives on a screen this app already has, advertised on the
 * promotions index the way the reference advertises its own live-dealer lobby
 * from a promotion card.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * EVERY `href` HERE MUST BE A ROUTE THAT EXISTS.
 *
 * Two of the three cards this list used to hold pointed at
 * `/promotions/welcome` and `/promotions/cashback`, neither of which is a
 * route — `App.jsx` redirects every unclaimed `promotions/:slug` to the
 * index, so both cards bounced the player back to the page they clicked
 * them on. They are gone; what is left points at `/vip`,
 * `/profile/refer-a-friend` and `/tournaments`, which are pages.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * `art` is generated at the card's own 700x290 by `promoArt` in
 * `scripts/art.mjs` — run `npm run assets:gen` after adding a row.
 *
 * @type {import('./types').Promotion[]}
 */
export const PROMOTIONS = [
  {
    id: 'promo-vip',
    slug: 'vip-club',
    title: 'VIP club',
    blurb:
      'Daily, weekly and monthly bonuses, and a cashback rate that climbs with your level.',
    href: '/vip',
    art: '/images/promos/vip-club.svg',
  },
  {
    id: 'promo-tournament',
    slug: 'weekly-tournament',
    title: 'Weekly tournaments',
    blurb: 'Prize pools on the leaderboards every week, reset every Monday.',
    href: '/tournaments',
    art: '/images/promos/weekly-tournament.svg',
  },
  {
    id: 'promo-refer',
    slug: 'refer-a-friend',
    title: 'Refer a friend',
    blurb: 'Share your link and take a cut of what everyone you bring in wagers.',
    href: '/profile/refer-a-friend',
    art: '/images/promos/refer-a-friend.svg',
  },
];

/**
 * Promotions that have finished.
 *
 * The reference's `/promotions?showPast=true` appends ten of these to the same
 * list, drawn exactly like the live ones — no dimming, no "ended" badge, the
 * `Read more` button still there. So the toggle is reproduced, and this is
 * where a finished campaign would go.
 *
 * It is empty because nothing on this app has ended: the League runs to 13
 * September 2026, and the other five cards are standing offers with no window
 * at all. `pages/Promotions.jsx` renders a line saying so rather than showing
 * the toggle flipping to nothing.
 *
 * @type {import('./types').Promotion[]}
 */
export const PAST_PROMOTIONS = [];

/**
 * The three cards of the signed-in home banner.
 *
 * The reference swaps its whole above-the-fold block once you have an
 * account: the acquisition hero ("Join the world's first licensed Bitcoin
 * casino", benefit list, Join Us button) is replaced by this row, which sells
 * what is running *now* rather than the sign-up offer. The shapes differ too —
 * the hero is one two-column band, this is three equal cards.
 *
 * One editorial rule is worth keeping: each card points somewhere different in
 * kind, so the row never reads as three versions of the same ask. The
 * reference's own current row is a game, a weekly promotion and the League;
 * this one is the League, the weekly promotion and the deposit offer. `emblem`
 * selects the motif the generated art draws; see `bannerArt` in
 * scripts/art.mjs.
 *
 * **A card's `href` must be somewhere that exists.** Two of the three used to
 * point at `promotions/:slug`, which `App.jsx` redirects to the promotions
 * index — so the League card landed on the spin wheel, and the deposit card
 * still does. `data/promotionPages.js` lists the campaigns that have a page.
 *
 * @type {import('./types').HomeBanner[]}
 */
export const HOME_BANNERS = [
  {
    id: 'banner-league',
    title: 'League of Bitcasino',
    blurb:
      'A four week race where every qualifying spin climbs the board. 50,000 USDT a week.',
    href: '/promotions/league-of-bitcasino',
    art: '/images/banners/league.png',
    emblem: 'game-shows',
  },
  {
    /**
     * The reference's own middle card. It replaced `banner-game-of-the-week`,
     * whose blurb sold a single slot and whose destination was that game's
     * play page — which worked, but is the one card of the three with no
     * promotion behind it. This one lands on the campaign's own page at the
     * reference's slug; that page is a hero and a title, because the
     * reference's body for it is empty. See `pages/WeeklyRakeback.jsx`.
     *
     * Title and blurb are the reference's own promotion card, word for word.
     */
    id: 'banner-weekly-rakeback',
    title: 'Weekly Rakeback',
    blurb:
      'Enjoy a full week of action on selected slots from Monday to Sunday and earn up to 5% Rakeback.',
    href: '/promotions/weekly-rakeback-2026',
    art: '/images/banners/weekly-rakeback.webp',
    emblem: 'jackpots',
  },
  {
    id: 'banner-deposit-rewards',
    title: 'Get up to 5,000 USDT in deposit rewards',
    blurb: 'Three bonuses worth up to 5,000 USDT are waiting — redeem yours.',
    href: '/promotions/welcome',
    art: '/images/banners/deposit-rewards.webp',
    emblem: 'jackpots',
  },
];
