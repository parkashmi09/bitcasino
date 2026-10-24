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

  /**
   * Play surfaces. Player-scoped, so the whole prefix is cleared on sign-out.
   *
   * `bets` is under it rather than under `games` because a round settling
   * invalidates the history and nothing else — invalidating `['games']` after
   * every Limbo round would refetch every rail on the page.
   */
  play: {
    all: ['play'],
    bets: (filters) => ['play', 'bets', compact(filters)],
  },

  /**
   * The account area. Player-scoped, so the whole prefix clears on sign-out.
   *
   * `twoFactor` and `kyc` are single unparameterised reads and still get a
   * function rather than a bare array, so every call site spells them the
   * same way — a key written as `['account','2fa']` at one site and
   * `queryKeys.account.twoFactor()` at another is an invalidation that
   * silently misses half the time.
   */
  /**
   * Editorial content. **Not** player-scoped — every one of these is public,
   * so it survives a sign-out and does not need clearing with the session.
   */
  content: {
    all: ['content'],
    posts: (filters) => ['content', 'posts', compact(filters)],
    post: (slug) => ['content', 'post', slug],
    banners: () => ['content', 'banners'],
  },

  /**
   * Promotions. Mixed audience: `spinSlices` is public, the rest are
   * player-scoped, and they share a prefix so a claim can invalidate the
   * standing it changed without naming each one.
   */
  promotions: {
    all: ['promotions'],
    spinSlices: () => ['promotions', 'spin', 'slices'],
    spinEligibility: () => ['promotions', 'spin', 'eligibility'],
    bonus: () => ['promotions', 'bonus'],
    events: (filters) => ['promotions', 'events', compact(filters)],
  },

  account: {
    all: ['account'],
    twoFactor: () => ['account', '2fa'],
    sessions: () => ['account', 'sessions'],
    kyc: () => ['account', 'kyc'],
    history: (limit, offset) => ['account', 'history', limit, offset],
    transfers: (limit, offset) => ['account', 'transfers', limit, offset],
  },

  /**
   * The live surfaces. Public, like `content`, so they survive a sign-out —
   * the feed is everyone's, not the caller's, and clearing it with the
   * session would blank a ticker that never depended on one.
   *
   * They share the `live` prefix so a future push event can invalidate every
   * feed at once without naming the three of them.
   */
  live: {
    all: ['live'],
    bets: () => ['live', 'bets'],
    betsByGame: (game) => ['live', 'bets', 'game', game],
    topWinners: () => ['live', 'top-winners'],
    notifications: () => ['live', 'notifications'],
  },

  site: {
    all: ['site'],
    config: () => ['site', 'config'],
  },
};
