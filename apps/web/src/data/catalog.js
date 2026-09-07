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

/** Deterministic pseudo-random, so the seed catalog is stable across renders. */
function seeded(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export const slugify = (value) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** @type {import('./types').Game[]} */
export const GAMES = TITLES.map(([title, category], i) => {
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
    ...(isLive ? { players: Math.floor(seeded(i + 1) * 900) + 40 } : {}),
    ...(isJackpot ? { jackpot: Math.floor(seeded(i + 7) * 900_000) + 100_000 } : {}),
  };
});

export const byCategory = (category) =>
  GAMES.filter((game) => game.category === category);

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

/** @type {import('./types').Promotion[]} */
export const PROMOTIONS = [
  {
    id: 'promo-welcome',
    title: 'Welcome package',
    blurb: 'Get up to 5,000 USDT across your first three deposits.',
    cta: 'Claim offer',
    href: '/promotions/welcome',
    art: '/images/promos/welcome.svg',
    tone: 'brand',
  },
  {
    id: 'promo-tournament',
    title: 'Weekly tournament',
    blurb: 'A 25,000 USDT prize pool, reset every Monday.',
    cta: 'View leaderboard',
    href: '/tournaments',
    art: '/images/promos/tournament.svg',
    tone: 'jackpot',
  },
  {
    id: 'promo-cashback',
    title: 'Loyalty cashback',
    blurb: 'Earn back a share of your play, credited every week.',
    cta: 'How it works',
    href: '/promotions/cashback',
    art: '/images/promos/cashback.svg',
    tone: 'positive',
  },
];
