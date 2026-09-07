/**
 * Server-side seed catalog.
 *
 * Mirrors the shape the web app expects so the front end can be pointed at
 * this API instead of its local module. All names are original placeholders.
 * Swap this for a real datastore when you have one.
 */

/**
 * @typedef {'originals'
 *   | 'live-casino'
 *   | 'video-slots'
 *   | 'table-games'
 *   | 'crash'
 *   | 'game-shows'
 *   | 'jackpots'} GameCategory
 */

/**
 * @typedef {object} Game
 * @property {string} id
 * @property {string} title
 * @property {string} slug
 * @property {string} provider
 * @property {GameCategory} category
 * @property {string} thumb
 * @property {'new' | 'hot' | 'exclusive' | 'jackpot'} [badge]
 * @property {number} [players]
 * @property {number} [jackpot]
 */

/**
 * @typedef {object} Provider
 * @property {string} id
 * @property {string} name
 * @property {string} slug
 * @property {string} logo
 * @property {number} gameCount
 */

/** @type {Array<{ slug: GameCategory, label: string }>} */
export const CATEGORIES = [
  { slug: 'originals', label: 'Originals' },
  { slug: 'live-casino', label: 'Live Casino' },
  { slug: 'video-slots', label: 'Slots' },
  { slug: 'table-games', label: 'Table Games' },
  { slug: 'crash', label: 'Crash & Instant' },
  { slug: 'game-shows', label: 'Game Shows' },
  { slug: 'jackpots', label: 'Jackpots' },
];

/** @type {Provider[]} */
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

/** @type {Array<[string, GameCategory]>} */
const TITLES = [
  ['Sunken Vault', 'originals'], ['Lantern Drift', 'video-slots'],
  ['Copper Canyon', 'video-slots'], ['Tidal Crown', 'video-slots'],
  ['Ember Trail', 'crash'], ['Northern Gate', 'video-slots'],
  ['Glass Harbour', 'live-casino'], ['Velvet Room', 'live-casino'],
  ['Cinder and Sable', 'video-slots'], ['Quartz Reef', 'video-slots'],
  ['Paper Lantern', 'game-shows'], ['Iron Orchard', 'video-slots'],
  ['Salt Flats', 'crash'], ['Midnight Parlour', 'table-games'],
  ['Amber Lodge', 'table-games'], ['Frost Hollow', 'video-slots'],
  ['Golden Thicket', 'jackpots'], ['Marble Court', 'live-casino'],
  ['Cobalt Sky', 'crash'], ['Wildwood Run', 'video-slots'],
  ['Silver Meridian', 'jackpots'], ['Harvest Moon Hall', 'game-shows'],
  ['Opal Springs', 'video-slots'], ['Redstone Gambit', 'table-games'],
];

const BADGES = ['new', 'hot', 'exclusive', 'jackpot', undefined, undefined];

function seeded(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const slugify = (value) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** @type {Game[]} */
export const GAMES = TITLES.map(([title, category], i) => {
  const slug = slugify(title);
  const isLive = category === 'live-casino' || category === 'game-shows';
  const isJackpot = category === 'jackpots';

  return {
    id: `g${i + 1}`,
    title,
    slug,
    provider: PROVIDERS[i % PROVIDERS.length].name,
    category,
    thumb: `/images/games/${slug}.svg`,
    badge: BADGES[i % BADGES.length],
    ...(isLive ? { players: Math.floor(seeded(i + 1) * 900) + 40 } : {}),
    ...(isJackpot ? { jackpot: Math.floor(seeded(i + 7) * 900_000) + 100_000 } : {}),
  };
});
