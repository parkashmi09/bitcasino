/**
 * Relative, not `@/`. `scripts/verify-api-contract.mjs` imports this module in
 * plain Node, where the Vite alias does not exist — and the whole point of
 * that script is that it sends these exact objects, so this module has to stay
 * loadable outside the bundler.
 */
import { queryTypesFor, typeForCategory } from '../data/adapters/categories.js';

/**
 * The query objects sent to the catalogue routes, as pure functions.
 *
 * ## Why these are not inline in the hooks
 *
 * Every catalogue validator is `.strict()`, and the accepted pairs DIFFER
 * between routes that look interchangeable:
 *
 * | Route | Accepts | Rejects |
 * | --- | --- | --- |
 * | `GET /games` | `page`, `limit`, `provider`, `type`, `search`, `technology`, `has_lobby`, `has_freespins`, `is_mobile` | anything else |
 * | `GET /games/collections/:c` | `page`, `limit` | **`type`, `provider`, `search`** |
 * | `GET /games/search` | `q`, `limit` | **`page`** |
 * | `GET /games/recently-played` | `limit` | `page`, `q` |
 * | `GET /games/provider/:p` | as `/games`, minus `provider` | `provider` |
 *
 * Sending the wrong key is a **422 before the handler runs** — not an ignored
 * field, not a default. That failure looks like "the collection is empty" to
 * anyone reading the UI, which is the worst possible presentation of a
 * mistake this easy to make.
 *
 * Extracting them here buys two things a comment could not. They are unit
 * testable without a renderer, and `scripts/verify-api-contract.mjs` sends
 * **these exact objects** to a live gateway — so the contract check cannot
 * drift from what the app actually sends, which it would the moment the script
 * hand-rolled its own params.
 *
 * @see docs/10-backend-integration.md, Phase 1.
 */

/** The platform's ceiling on `limit` for the browse and search routes. */
export const MAX_LIMIT = 100;

/** A curated collection may be read whole; `MAX_COLLECTION_SIZE` upstream. */
export const MAX_COLLECTION_LIMIT = 5000;

/** The route's own cap on `recently-played`. */
export const MAX_RECENT_LIMIT = 50;

/** `:collection` is a `z.enum`. An unknown slug is a 422, not an empty list. */
export const COLLECTION_SLUGS = Object.freeze([
  'hot',
  'live-casino',
  'popular-slots',
  'crash',
  'indian',
]);

const clamp = (value, fallback, max) =>
  Math.min(Math.max(Number(value) || fallback, 1), max);

const page = (value) => Math.max(Number(value) || 1, 1);

/**
 * `GET /casino/games`.
 *
 * `category` is one of OUR slugs and is translated to the platform's `type`
 * here, so no page has to know the mapping exists. Absent filters are omitted
 * entirely rather than sent as `undefined` — `.strict()` rejects a declared
 * key with an undefined value the same way it rejects an unknown one.
 */
export function gamesQuery({ category, provider, search, page: p = 1, limit = 24 } = {}) {
  return {
    page: page(p),
    limit: clamp(limit, 24, MAX_LIMIT),
    /**
     * `queryTypesFor`, not `typeForCategory`: a category page may cover more
     * than one upstream type. `live-casino` covers `baccarat` and `blackjack`
     * as well as its own, because the sidebar calls it **All Live Casino
     * Games** and the reference means that literally.
     *
     * Joined with a comma, which `GET /casino/games` reads as a set — see
     * `#typeWhere` in `backend/services/casino/.../games.service.js`. A single
     * type still sends as a bare string, so every existing request is byte for
     * byte what it was.
     */
    ...(category ? { type: queryTypesFor(category).join(',') } : {}),
    ...(provider ? { provider } : {}),
    ...(search ? { search } : {}),
  };
}

/**
 * `GET /casino/games/collections/:collection`.
 *
 * Page and limit and nothing else. A curated list takes no filters at all.
 */
export function collectionQuery({ limit = 24 } = {}) {
  return { page: 1, limit: clamp(limit, 24, MAX_COLLECTION_LIMIT) };
}

/**
 * `GET /casino/games/search`.
 *
 * No `page` — the route has none, and sending one is a 422.
 */
export function searchQuery({ q, limit = 30 } = {}) {
  return { q: String(q ?? '').trim(), limit: clamp(limit, 30, MAX_LIMIT) };
}

/** `GET /casino/games/recently-played`. Limit only. */
export function recentQuery({ limit = 15 } = {}) {
  return { limit: clamp(limit, 15, MAX_RECENT_LIMIT) };
}

/**
 * `GET /casino/games/provider/:provider`.
 *
 * The same shape as `gamesQuery` with `provider` **omitted** — it is in the
 * path on this route, and the validator is `browse.query.omit({provider})`,
 * so sending it in the query as well is a 422.
 */
export function providerGamesQuery({ category, page: p = 1, limit = 48 } = {}) {
  return {
    page: page(p),
    limit: clamp(limit, 48, MAX_LIMIT),
    ...(category ? { type: typeForCategory(category) } : {}),
  };
}
