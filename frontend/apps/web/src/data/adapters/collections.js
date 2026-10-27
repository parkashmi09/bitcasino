/**
 * The lists this site offers at `/games/:slug`: the curated rows below, each read from the site
 * admin's Lobby categories, or a category reached through `/games`. The old client-side badge
 * cuts (`new`, `exclusives`) are gone: the JSGames catalogue carries no badge labels, so they
 * were always empty.
 *
 * @see queries/collections.js, which is what actually fetches these.
 */

import { CATEGORY_SLUGS } from './categories.js';

/**
 * The five the platform curates, with the art and copy this site shows them
 * under.
 *
 * `label` is the platform's own from `games.constants.js` — kept in step
 * deliberately, so a collection renamed upstream reads renamed here.
 *
 * `art` is placeholder, and the pairing is by theme rather than by name: the
 * six SVGs under `/images/themes/` were drawn for the static `THEMES` list,
 * which had different members. A real deployment replaces these with the
 * operator's own collection art; until then, five of the six existing tiles
 * are matched to the nearest collection and the sixth goes unused.
 */
export const PLATFORM_COLLECTIONS = Object.freeze([
  // `lobby` = the admin's Lobby curation category it reads (picks first, else the `auto` category's
  // list). The old platform collections are empty with the JSGames catalogue, and `indian` was
  // never a backend collection (422), so curation lives in Lobby categories now.
  { slug: 'new', label: 'New Releases', art: '/images/themes/house-exclusives.svg', lobby: 'new', auto: null },
  { slug: 'live-casino', label: 'Live casino', art: '/images/themes/live-exclusives.svg', lobby: 'live', auto: 'live-casino' },
  { slug: 'popular-slots', label: 'Popular slots', art: '/images/themes/megaways.svg', lobby: 'slots', auto: 'video-slots' },
  { slug: 'crash', label: 'Crash games', art: '/images/themes/drops-and-wins.svg', lobby: 'crash-games', auto: 'crash' },
]);

const PLATFORM_SLUGS = new Set(PLATFORM_COLLECTIONS.map((c) => c.slug));

/**
 * What `/games/:slug` should do for a slug.
 *
 * Returns one of:
 * - `{kind: 'collection', slug, label, art}` — read the platform's curated row
 * - `{kind: 'category', slug, label}` — it is really a category
 * - `null` — not a list this site serves
 *
 * **`live-casino` and `crash` are both a collection slug and a category slug**,
 * and they mean different things: the collection is a row an operator curated,
 * the category is every game of that type. So the ROUTE disambiguates, not the
 * slug — `/games/live-casino` is the curated row and
 * `/categories/live-casino` is the type. `Category.jsx` takes a `mode` prop
 * from `App.jsx` and only calls this on the `/games` route; resolving by slug
 * alone would silently make one of the two routes unreachable.
 *
 * The collection check therefore comes first here, because this function
 * answers for `/games/:slug` only.
 *
 * @param {string} slug
 */
export function resolveCollection(slug) {
  const key = String(slug ?? '').trim().toLowerCase();
  if (!key) return null;

  if (PLATFORM_SLUGS.has(key)) {
    const meta = PLATFORM_COLLECTIONS.find((c) => c.slug === key);
    return { kind: 'collection', slug: key, label: meta.label, art: meta.art, lobby: meta.lobby, auto: meta.auto };
  }

  if (CATEGORY_SLUGS.includes(key)) {
    return { kind: 'category', slug: key, label: null };
  }

  return null;
}
