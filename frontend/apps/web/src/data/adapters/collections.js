/**
 * The lists this site offers at `/games/:slug`, and where each one comes from.
 *
 * ## Two kinds of collection, and they are not interchangeable
 *
 * The platform curates **five**, each a row in its own table that an operator
 * edits: `hot`, `live-casino`, `popular-slots`, `crash`, `indian`. Those are
 * served whole by `GET /casino/games/collections/:collection`.
 *
 * This site's home rails link to **three more** — `new`, `exclusives` and
 * `live-rtp` — which the old static catalogue cut out of `GAMES` by badge and
 * by RTP. The platform cannot serve those, and the reason is worth writing
 * down rather than working around twice:
 *
 * > `GET /casino/games` accepts `provider`, `type`, `search`, `technology`,
 * > `has_lobby`, `has_freespins` and `is_mobile`. **There is no `label`
 * > filter**, and `label` is where `new` / `hot` / `exclusive` / `jackpot`
 * > live. There is no sort parameter either, so "highest RTP" cannot be asked
 * > for — and RTP is not even a column, it is a key inside the `parameters`
 * > JSONB that Phase 0 seeds.
 *
 * So those three are a **client-side cut over a fetched page**. That is honest
 * for a 44-game placeholder catalogue and does NOT scale: against a real
 * Slotegrator sync of several thousand titles, `new` would mean "the newest
 * among the first 100 the API happened to return", which is a different claim
 * from the one the rail makes.
 *
 * Two ways out, neither of them this phase's job:
 *
 * 1. Curate them upstream. `PUT /casino/games/collections/:collection` already
 *    exists; it just has no `new` or `exclusives` slug to write to.
 * 2. Add a `label` filter to the browse validator — a one-line addition to
 *    `games.validators.js` and a `where` clause in the service.
 *
 * (2) is the smaller change and the one that keeps an operator from having to
 * hand-curate "new releases". Flagged in `docs/10-backend-integration.md`
 * alongside the missing `GET /games/:uuid`, rather than papered over here.
 *
 * @see queries/collections.js, which is what actually fetches these.
 */

import { CATEGORY_SLUGS } from './categories.js';

/**
 * How many games a client-side cut reads before filtering.
 *
 * The platform's own ceiling on `limit` for the browse route. It is the whole
 * catalogue today and a first page tomorrow — see the note above.
 */
export const CUT_SAMPLE = 100;

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
  { slug: 'hot', label: 'Hot games', art: '/images/themes/house-exclusives.svg' },
  { slug: 'live-casino', label: 'Live casino', art: '/images/themes/live-exclusives.svg' },
  { slug: 'popular-slots', label: 'Popular slots', art: '/images/themes/megaways.svg' },
  { slug: 'crash', label: 'Crash games', art: '/images/themes/drops-and-wins.svg' },
  { slug: 'indian', label: 'Indian games', art: '/images/themes/vip-salon.svg' },
]);

const PLATFORM_SLUGS = new Set(PLATFORM_COLLECTIONS.map((c) => c.slug));

/**
 * The three this site cuts client-side, and how.
 *
 * `cut` runs over adapted `Game`s, so it reads `badge` and `rtp` rather than
 * `label` and `parameters.rtp` — the adapter has already normalised those, and
 * a filter that had to know both shapes would be a second adapter.
 *
 * Every one of these degrades rather than throwing on a catalogue that carries
 * no stats: `rtp` is `undefined` for anything a real sync writes, and
 * `live-rtp` drops those instead of sorting them to an arbitrary end.
 */
export const CUT_COLLECTIONS = Object.freeze({
  new: {
    label: 'New Releases',
    art: '/images/themes/bonus-buy-in.svg',
    cut: (games) => games.filter((game) => game.badge === 'new'),
  },
  exclusives: {
    label: 'BitCasino Exclusives',
    art: '/images/themes/house-exclusives.svg',
    cut: (games) => games.filter((game) => game.badge === 'exclusive'),
  },
  'live-rtp': {
    label: 'Live RTP',
    art: '/images/themes/megaways.svg',
    // A game with no RTP is dropped, not sorted. Sorting `undefined` puts it
    // at whichever end the engine happens to leave it, and a list titled
    // "Live RTP" must not contain rows whose RTP nobody knows.
    cut: (games) =>
      games.filter((game) => typeof game.rtp === 'number').sort((a, b) => b.rtp - a.rtp),
  },
});

/**
 * What `/games/:slug` should do for a slug.
 *
 * Returns one of:
 * - `{kind: 'collection', slug, label, art}` — read the platform's curated row
 * - `{kind: 'cut', slug, label, art, cut}` — read a page and filter it here
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
    return { kind: 'collection', slug: key, label: meta.label, art: meta.art };
  }

  if (key in CUT_COLLECTIONS) {
    const meta = CUT_COLLECTIONS[key];
    return { kind: 'cut', slug: key, label: meta.label, art: meta.art, cut: meta.cut };
  }

  if (CATEGORY_SLUGS.includes(key)) {
    return { kind: 'category', slug: key, label: null };
  }

  return null;
}
