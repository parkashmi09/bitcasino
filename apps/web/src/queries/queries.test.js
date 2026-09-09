import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api';
import { shouldRetry } from './client';
import { compact, queryKeys } from './keys';
import {
  gamesQuery,
  collectionQuery,
  searchQuery,
  recentQuery,
  providerGamesQuery,
  COLLECTION_SLUGS,
} from './params';

/**
 * The query layer's own logic, which is the retry rule and the key factory.
 *
 * Both are the kind of thing that is obviously correct when written and
 * silently wrong six months later: a retry rule that starts hammering a 422,
 * or a key that stops matching its own prefix so an invalidation quietly does
 * nothing. Neither failure produces an error — the first produces log noise
 * and a slow error state, the second produces stale data on screen.
 */

const apiError = (code, status) => new ApiError({ code, status });

describe('retry policy', () => {
  it('does not retry a request the server was right to refuse', () => {
    // None of these fix themselves. A 422 means we sent the wrong pagination
    // pair; a 404 means the collection slug is not one the platform serves.
    for (const status of [400, 401, 403, 404, 422]) {
      expect(shouldRetry(0, apiError('VALIDATION_ERROR', status))).toBe(false);
    }
  });

  it('retries when the request was fine and the server was not', () => {
    expect(shouldRetry(0, apiError('SERVER_ERROR', 500))).toBe(true);
    expect(shouldRetry(0, apiError('GATEWAY_UNAVAILABLE', 502))).toBe(true);
    expect(shouldRetry(0, apiError('NETWORK_UNAVAILABLE', 0))).toBe(true);
  });

  it('retries a rate limit — with backoff, which is the retryDelay', () => {
    expect(shouldRetry(0, apiError('RATE_LIMITED', 429))).toBe(true);
  });

  it('gives up after two retries however retryable the failure', () => {
    expect(shouldRetry(1, apiError('SERVER_ERROR', 500))).toBe(true);
    expect(shouldRetry(2, apiError('SERVER_ERROR', 500))).toBe(false);
  });

  it('retries a failure that is not an ApiError at all', () => {
    // A thrown TypeError from a bad `select` is a bug, but the network is the
    // likelier cause of something unrecognised reaching here.
    expect(shouldRetry(0, new Error('boom'))).toBe(true);
  });
});

describe('query keys', () => {
  it('drops nullish filters so equivalent calls share one cache entry', () => {
    // Without this the same list fetches twice, because one call site spread a
    // state variable that happened to be undefined.
    expect(compact({ type: 'crash', provider: undefined, search: '', page: null }))
      .toEqual({ type: 'crash' });
  });

  it('keeps a legitimate falsy value', () => {
    expect(compact({ page: 0, has_lobby: false })).toEqual({ page: 0, has_lobby: false });
  });

  it('nests every catalogue key under the games prefix', () => {
    // React Query matches by prefix, so `invalidateQueries({queryKey: ['games']})`
    // has to clear lists, collections, searches and stats in one call.
    const prefix = queryKeys.games.all;

    for (const key of [
      queryKeys.games.list({ page: 1 }),
      queryKeys.games.collection('hot', { page: 1 }),
      queryKeys.games.search('sky', 30),
      queryKeys.games.stats(),
      queryKeys.games.byProvider('In-House', {}),
      queryKeys.games.recent(15),
    ]) {
      expect(key.slice(0, prefix.length)).toEqual(prefix);
    }
  });

  it('separates the three catalogue namespaces', () => {
    expect(queryKeys.providers.list()[0]).toBe('providers');
    expect(queryKeys.site.config()[0]).toBe('site');
    expect(queryKeys.games.stats()[0]).toBe('games');
  });

  it('gives filter objects that differ only in key order the same key', () => {
    // React Query hashes with sorted keys, so these must be deep-equal.
    expect(queryKeys.games.list({ page: 1, type: 'crash' }))
      .toEqual(queryKeys.games.list({ type: 'crash', page: 1 }));
  });

  it('separates lists that genuinely differ', () => {
    expect(queryKeys.games.list({ page: 1 }))
      .not.toEqual(queryKeys.games.list({ page: 2 }));
    expect(queryKeys.games.collection('hot', {}))
      .not.toEqual(queryKeys.games.collection('crash', {}));
  });
});

/**
 * The query parameter builders.
 *
 * Every catalogue validator is `.strict()` and they do not accept the same
 * keys, so the failure these guard against is a 422 that the UI renders as an
 * empty list. `scripts/verify-api-contract.mjs` proves the same objects are
 * accepted by a live gateway; these prove the SHAPE without needing one, which
 * is what makes them runnable in CI.
 */
describe('query params', () => {
  it('sends page/limit to /games, never offset', () => {
    const query = gamesQuery({ page: 2, limit: 12 });

    expect(query).toEqual({ page: 2, limit: 12 });
    expect(query).not.toHaveProperty('offset');
  });

  it('translates our category slug into the platform type', () => {
    // The page passes `category`; the wire carries `type`. No page should know
    // the mapping exists.
    expect(gamesQuery({ category: 'live-casino' }).type).toBe('live-casino');
    expect(gamesQuery({ category: 'live-casino' })).not.toHaveProperty('category');
  });

  it('omits absent filters rather than sending them undefined', () => {
    // `.strict()` refuses a declared key holding undefined the same way it
    // refuses an unknown one.
    const query = gamesQuery({ category: undefined, provider: '', search: null });

    expect(Object.keys(query).sort()).toEqual(['limit', 'page']);
  });

  it('clamps limit to the platform ceiling and the floor', () => {
    expect(gamesQuery({ limit: 5000 }).limit).toBe(100);
    expect(gamesQuery({ limit: 0 }).limit).toBe(24);
    expect(gamesQuery({ limit: -3 }).limit).toBe(1);
    expect(gamesQuery({ page: 0 }).page).toBe(1);
  });

  it('sends a collection nothing but page and limit', () => {
    // A curated list takes no filters at all — `type` here is a 422.
    expect(Object.keys(collectionQuery({ limit: 24 })).sort()).toEqual(['limit', 'page']);
  });

  it('lets a collection be read whole, past the /games ceiling', () => {
    expect(collectionQuery({ limit: 5000 }).limit).toBe(5000);
  });

  it('sends search q and limit, and no page — the route has none', () => {
    const query = searchQuery({ q: '  sky  ', limit: 30 });

    expect(query).toEqual({ q: 'sky', limit: 30 });
    expect(query).not.toHaveProperty('page');
  });

  it('sends recently-played nothing but limit, capped at the route ceiling', () => {
    expect(recentQuery({ limit: 15 })).toEqual({ limit: 15 });
    expect(recentQuery({ limit: 500 }).limit).toBe(50);
  });

  it('omits provider from the per-provider query — it is in the path', () => {
    // The validator is `browse.query.omit({provider})`; sending it too is a 422.
    const query = providerGamesQuery({ category: 'crash', page: 1 });

    expect(query).not.toHaveProperty('provider');
    expect(query.type).toBe('crash');
  });

  it('lists exactly the five collections the backend enum serves', () => {
    // `:collection` is a z.enum. An unknown slug is a 422, not an empty list,
    // so a page taking one from the URL must check it against this.
    expect([...COLLECTION_SLUGS].sort()).toEqual([
      'crash',
      'hot',
      'indian',
      'live-casino',
      'popular-slots',
    ]);
  });
});
