/**
 * Pure functions mapping platform shapes onto the typedefs in `data/types.js`.
 *
 * Nothing in here fetches, caches, or knows what a React hook is — that is
 * `queries/`. Keeping them apart is what makes the mapping testable without a
 * server and without a renderer, which is where the bugs in this layer
 * actually live: a renamed field produces `undefined`, and `undefined` renders
 * as nothing at all rather than as an error.
 *
 * @see docs/10-backend-integration.md, Phase 1.
 */

export {
  CATEGORY_SLUGS,
  categoryFromType,
  typeForCategory,
  isCategorySlug,
  queryTypesFor,
} from './categories.js';

export { toGame, toGames, toRecentGames, sortValue, VOLATILITY } from './games.js';

export {
  providerSlug,
  toProvider,
  toProviders,
  toProviderCounts,
  nameForSlug,
} from './providers.js';

export { toSiteConfig, FLAG_DEFAULTS } from './siteConfig.js';

export {
  PLATFORM_COLLECTIONS,
  CUT_COLLECTIONS,
  CUT_SAMPLE,
  resolveCollection,
} from './collections.js';

export { THEMES, THEME_SLUGS, resolveTheme, themeCut } from './themes.js';
