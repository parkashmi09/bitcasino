/**
 * The data-fetching layer: React Query hooks over `lib/api.js`, projecting
 * through `data/adapters/`.
 *
 * Pages import from here, never from `lib/api.js` directly. That is what keeps
 * the retry policy, the cache keys and the platform's response shapes in one
 * place rather than spread across twenty components.
 *
 * @see docs/10-backend-integration.md, Phase 1.
 */

export { createQueryClient } from './client';
export { queryKeys, compact } from './keys';

export {
  gamesQuery,
  collectionQuery,
  searchQuery,
  recentQuery,
  providerGamesQuery,
  COLLECTION_SLUGS,
  MAX_LIMIT,
} from './params';

export {
  useGames,
  useCollection,
  useGameSearch,
  useGameStats,
  useRecentlyPlayed,
  useGame,
} from './games';

export { useProviders, useProviderGames } from './providers';

export { useSiteConfig } from './siteConfig';
