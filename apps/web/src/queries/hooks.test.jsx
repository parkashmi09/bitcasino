import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';

import { createQueryClient } from './client';
import { useGames, useCollection, useGameSearch } from './games';
import { useSiteConfig } from './siteConfig';

/**
 * The wiring, end to end inside React: hook -> `api.js` -> envelope unwrap ->
 * adapter -> renderable `Game`.
 *
 * The unit tests either side of this cover the pure pieces, and
 * `scripts/verify-api-contract.mjs` covers the live platform. What neither
 * covers is the seam between them — that `select` really is applied, that a
 * failure really does surface as an `ApiError` with its `requestId` intact,
 * and that a hook does not fire while it is disabled. Those only exist once a
 * component renders.
 *
 * `fetch` is stubbed rather than a server being started, so this stays a unit
 * test: it asserts the plumbing, not the platform.
 */

/** Wrap a hook in a client with retries off — a test must not wait out backoff. */
function wrapper() {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, gcTime: 0 } });

  return ({ children }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** A platform success envelope. */
const envelope = (data, meta) =>
  new Response(JSON.stringify({ success: true, data, ...(meta ? { meta } : {}) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** A platform failure envelope, with the request id a bug report quotes. */
const refusal = (status, code, requestId) =>
  new Response(
    JSON.stringify({
      success: false,
      error: { code, message: 'Validation failed', details: { requestId } },
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );

const ROW = {
  uuid: 'cobalt-sky',
  name: 'Cobalt Sky',
  provider: 'Lumen Games',
  type: 'crash',
  image: '/images/games/cobalt-sky.svg',
  label: 'new',
  parameters: { rtp: 95.3, hitRatio: 44.2, volatility: 'medium' },
  images: {
    portrait: '/images/games/cobalt-sky.svg',
    landscape: '/images/games/cobalt-sky-wide.svg',
  },
  has_lobby: false,
};

/** The URL the stub was called with, so the query string can be asserted. */
const calledUrl = (stub, call = 0) => new URL(stub.mock.calls[call][0], 'http://localhost');

afterEach(cleanup);

describe('useGames', () => {
  it('carries a platform row through to a renderable Game', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        envelope([ROW], { pagination: { page: 1, limit: 24, total: 44, totalPages: 2 } }),
      );

    const { result } = renderHook(() => useGames({ category: 'crash' }), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Adapted, not raw — no component should ever see `uuid` or `name`.
    expect(result.current.data.games).toEqual([
      {
        id: 'cobalt-sky',
        slug: 'cobalt-sky',
        title: 'Cobalt Sky',
        provider: 'Lumen Games',
        category: 'crash',
        thumb: '/images/games/cobalt-sky.svg',
        thumbWide: '/images/games/cobalt-sky-wide.svg',
        badge: 'new',
        rtp: 95.3,
        volatility: 'medium',
        hitRatio: 44.2,
        hasLobby: false,
      },
    ]);

    // `meta.pagination`, never `meta.total`.
    expect(result.current.data.pagination.total).toBe(44);

    // The category became `type` on the wire, and no `offset` was sent.
    const url = calledUrl(fetchMock);
    expect(url.searchParams.get('type')).toBe('crash');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.has('offset')).toBe(false);
    expect(url.searchParams.has('category')).toBe(false);
  });

  it('surfaces a refusal as an ApiError carrying its request id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      refusal(422, 'VALIDATION_ERROR', 'req-abc-123'),
    );

    const { result } = renderHook(() => useGames(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error.code).toBe('VALIDATION_ERROR');
    expect(result.current.error.status).toBe(422);
    // What `QueryError` renders and a bug report quotes.
    expect(result.current.error.requestId).toBe('req-abc-123');
  });

  it('does not fetch while disabled', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope([]));

    renderHook(() => useGames({ enabled: false }), { wrapper: wrapper() });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useCollection', () => {
  it('sends a collection page and limit and nothing else', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope([ROW]));

    const { result } = renderHook(() => useCollection('hot', { limit: 24 }), {
      wrapper: wrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = calledUrl(fetchMock);
    expect(url.pathname).toBe('/api/v1/casino/games/collections/hot');
    // A curated list takes no filters — `type` here would be a 422.
    expect([...url.searchParams.keys()].sort()).toEqual(['limit', 'page']);
    expect(result.current.data[0].title).toBe('Cobalt Sky');
  });

  it('stays idle without a slug rather than requesting /collections/undefined', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope([]));

    renderHook(() => useCollection(undefined), { wrapper: wrapper() });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('useGameSearch', () => {
  it('does not fire on an empty box', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope([]));

    // The route defaults `q` to '' and would answer the first 30 games, which
    // is not what an empty search box means.
    renderHook(() => useGameSearch('   '), { wrapper: wrapper() });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends q and limit, trimmed, with no page', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope([ROW]));

    const { result } = renderHook(() => useGameSearch('  sky  '), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const url = calledUrl(fetchMock);
    expect(url.searchParams.get('q')).toBe('sky');
    expect(url.searchParams.has('page')).toBe(false);
  });
});

describe('useSiteConfig', () => {
  it('reads every flag ON before the response arrives', async () => {
    // Matches the backend's own answer for a missing config row. Defaulting
    // off would assemble the home page in front of the player.
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    const { result } = renderHook(() => useSiteConfig(), { wrapper: wrapper() });

    expect(result.current.isPending).toBe(true);
    expect(result.current.config.flag('home_heroSection')).toBe(true);
    expect(result.current.config.flag('casino')).toBe(true);
  });

  it('applies the operator flags once they arrive', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      envelope({ casino: true, lotto: false, usdt: true, btc: false, configured: true }),
    );

    const { result } = renderHook(() => useSiteConfig(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.config.configured).toBe(true));

    expect(result.current.config.flag('lotto')).toBe(false);
    expect(result.current.config.enabledCurrencies(['USDT', 'BTC'])).toEqual(['USDT']);
  });

  it('renders everything rather than nothing when the config cannot be read', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(refusal(500, 'SERVER_ERROR', 'req-x'));

    const { result } = renderHook(() => useSiteConfig(), { wrapper: wrapper() });

    // The whole point: the site is renderable throughout, not only at the end.
    expect(result.current.config.flag('casino')).toBe(true);

    // `useSiteConfig` sets its own `retry: 1`, which overrides the wrapper's
    // `retry: false` — so settling costs one `retryDelay` (1s) and the default
    // 1s `waitFor` window is exactly too short.
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });

    // Losing the answer must not hide the site. Anything that has to be OFF
    // when unknown does not belong in this flag set.
    expect(result.current.config.flag('casino')).toBe(true);
  });
});
