/**
 * Every query key in the app, built in one place.
 *
 * Keys are what invalidation targets, and an invalidation that misses is a
 * screen showing a value the player has already changed. Two rules make that
 * unlikely, and both need the keys to live together:
 *
 * 1. **Hierarchical.** `['games']` is a prefix of `['games', 'list', {...}]`,
 *    so invalidating the former clears every list, every collection and every
 *    search without naming them. React Query matches keys by prefix.
 * 2. **Serialisable and stable.** A key holding an object is hashed by
 *    `JSON.stringify` with its keys sorted, so `{type, page}` and
 *    `{page, type}` are the same entry. Anything non-serialisable in a key —
 *    a function, a `Date` — silently produces a new entry on every render and
 *    turns the cache into a memory leak.
 *
 * The filter objects below are passed through `compact()` so that
 * `{type: 'crash'}` and `{type: 'crash', provider: undefined}` hash to the
 * same key. Without it the same list fetches twice, because one call site
 * spread a state variable that happened to be undefined.
 */

/** Drop undefined, null and '' so equivalent filters hash equally. */
export function compact(filters = {}) {
  const out = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue;
    out[key] = value;
  }
  return out;
}

export const queryKeys = {
  /** Everything catalogue. `invalidateQueries({queryKey: queryKeys.games.all})`. */
  games: {
    all: ['games'],
    list: (filters) => ['games', 'list', compact(filters)],
    collection: (slug, filters) => ['games', 'collection', slug, compact(filters)],
    search: (q, limit) => ['games', 'search', q, limit],
    stats: () => ['games', 'stats'],
    byProvider: (provider, filters) => ['games', 'provider', provider, compact(filters)],
    /** Player-scoped; cleared on logout with the `games` prefix. */
    recent: (limit) => ['games', 'recent', limit],
  },

  providers: {
    all: ['providers'],
    list: () => ['providers', 'list'],
  },

  site: {
    all: ['site'],
    config: () => ['site', 'config'],
  },
};
