/**
 * Shapes of the seed data in catalog.js, documented as JSDoc typedefs.
 *
 * This module has no runtime exports — it exists so the data contract stays
 * written down in one place, and so editors can still offer completion on a
 * `game` or `provider` object. Import it with a plain `import '@/data/types'`
 * only if you want the typedefs registered; nothing depends on it at runtime.
 */

/**
 * @typedef {'originals'
 *   | 'live-casino'
 *   | 'baccarat'
 *   | 'blackjack'
 *   | 'roulette'
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
 * @property {string} thumb Portrait tile (0.745:1) under /images/games, used by every rail.
 * @property {string} thumbWide Landscape tile (1.3:1), used by the featured rail.
 * @property {'new' | 'hot' | 'exclusive' | 'jackpot'} [badge]
 * @property {number} rtp Return to player, as a percentage.
 * @property {'low' | 'medium' | 'high'} volatility
 * @property {number} hitRatio Winning spins, as a percentage.
 * @property {number} [players] Seats taken, for live-dealer tables only.
 * @property {true} [bonusBuy] The slot sells its bonus round outright. `/themes/bonus-buy-in` cuts on it; absent means the catalogue does not record the feature.
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

/**
 * @typedef {object} Category
 * @property {GameCategory} slug
 * @property {string} label
 * @property {string} icon An icon name from components/ui/Icon.jsx.
 */

/**
 * One row of the `/promotions` list: a 700x290 picture, a title, one line
 * under it, and somewhere to go. The same shape `PROMO_PAGES` maps a campaign
 * into, so the index can concatenate the two.
 *
 * @typedef {object} Promotion
 * @property {string} id
 * @property {string} slug
 * @property {string} title
 * @property {string} blurb
 * @property {string} href
 * @property {string} art
 */

/**
 * One card of the signed-in home banner.
 *
 * @typedef {object} HomeBanner
 * @property {string} id
 * @property {string} title
 * @property {string} blurb Hidden below md, where the card is too narrow for it.
 * @property {string} href
 * @property {string} art Portrait 496x514 card art under /images/banners.
 * @property {GameCategory} emblem Motif the generated art draws.
 */

export {};
