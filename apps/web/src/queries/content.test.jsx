import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useBanners, useBlogPost, useBlogPosts } from './content';
import { useSpinSlices } from './promotions';
import { tokenStore } from '@/auth/tokenStore';

/**
 * The content layer's three quiet failure modes.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * 1. `description` IS THE BODY, NOT A SUMMARY
 *
 * The blog row calls the post's full text `description` and its standfirst
 * `subheading`. A component that read them the way the names suggest would
 * print the standfirst as the article and the article as a subtitle, and both
 * would look plausible enough to ship. `toPost` is the one place that mapping
 * happens, so it is the one place worth pinning.
 *
 * 2. THE INDEX SHIPS NO BODY
 *
 * `GET /admin/blogs` returns metadata only — `description` is absent on every
 * row. A detail page that filtered the list instead of fetching by slug would
 * render an empty article with no error anywhere.
 *
 * 3. AN EMPTY BANNER TABLE IS NOT A FAILURE
 *
 * No operator has uploaded a banner on this deployment, and that is the normal
 * state. Every caller renders its own art in that case, so the hook must
 * answer an empty map rather than anything a caller might treat as broken.
 * ═════════════════════════════════════════════════════════════════════════
 */

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ status: 'anonymous', user: null }),
}));

const envelope = (data, meta) =>
  new Response(JSON.stringify({ success: true, data, ...(meta ? { meta } : {}) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** A row exactly as `GET /admin/blogs/slug/:slug` returns one. */
const POST_ROW = {
  id: 3,
  slug: 'responsible-gaming',
  title: 'Responsible gaming',
  subheading: 'Limits, self-exclusion and where to get help.',
  author: 'iBitPlay',
  category: 'Policy',
  date: '2026-09-09T07:44:29.264Z',
  published: true,
  publishedAt: null,
  imageUrl: null,
  description: 'Demo content. Replace this with the policy your licence actually requires.',
};

beforeEach(() => {
  tokenStore.clear();
});

afterEach(() => {
  tokenStore.clear();
  vi.restoreAllMocks();
});

describe('a blog post', () => {
  it('maps `description` to the body and `subheading` to the standfirst', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope(POST_ROW));

    const { result } = renderHook(() => useBlogPost('responsible-gaming'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const post = result.current.data;
    expect(post.body).toBe(POST_ROW.description);
    expect(post.standfirst).toBe(POST_ROW.subheading);
    // The trap: these two must not be the other way round.
    expect(post.body).not.toBe(POST_ROW.subheading);
  });

  it('has no image when `imageUrl` is null, which is every seeded post', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope(POST_ROW));

    const { result } = renderHook(() => useBlogPost('responsible-gaming'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data.image).toBeNull();
  });

  it('builds the raw image path when a post has one', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      envelope({ ...POST_ROW, imageUrl: 'anything-truthy' }),
    );

    const { result } = renderHook(() => useBlogPost('responsible-gaming'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Addressed by id and served raw — never fetched through `api.js`.
    expect(result.current.data.image).toBe('/api/v1/admin/blogs/3/image');
  });

  it('is read without a token — admin-service mounts a public audience', async () => {
    tokenStore.set({ accessToken: 'should-not-be-sent', refreshToken: 'r' });

    let headers;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      headers = init.headers ?? {};
      return Promise.resolve(envelope(POST_ROW));
    });

    const { result } = renderHook(() => useBlogPost('responsible-gaming'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(headers.authorization).toBeUndefined();
  });
});

describe('the blog index', () => {
  it('carries no body, which is why the detail page fetches by slug', async () => {
    // The list route's real shape: no `description` on any row.
    const { description, ...listRow } = POST_ROW;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      envelope([listRow], { pagination: { page: 1, totalPages: 1, hasNext: false } }),
    );

    const { result } = renderHook(() => useBlogPosts({ page: 1, limit: 12 }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data.posts).toHaveLength(1);
    expect(result.current.data.posts[0].body).toBeNull();
    expect(result.current.data.posts[0].title).toBe('Responsible gaming');
    expect(result.current.data.pagination.totalPages).toBe(1);
  });

  it('sends page/limit, never limit/offset', async () => {
    let url;
    vi.spyOn(globalThis, 'fetch').mockImplementation((requested) => {
      url = String(requested);
      return Promise.resolve(envelope([], { pagination: { page: 2, totalPages: 3 } }));
    });

    const { result } = renderHook(() => useBlogPosts({ page: 2, limit: 12 }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Blogs are one of the three page-based validators. `offset` here is a
    // 422, and a 422 on a list renders as "no posts yet".
    expect(url).toContain('page=2');
    expect(url).toContain('limit=12');
    expect(url).not.toContain('offset=');
  });
});

describe('banners', () => {
  it('answer an empty map when nothing is uploaded — the normal state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope([]));

    const { result } = renderHook(() => useBanners(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data.size).toBe(0);
    // Not an error: no operator has uploaded a banner, and every caller draws
    // its own art in that case.
    expect(result.current.isError).toBe(false);
  });

  it('key by placement and skip inactive ones', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      envelope([
        { id: 1, type: 'banner-league', active: true, url: '/served/league.png' },
        { id: 2, type: 'banner-taken-down', active: false, url: '/served/old.png' },
      ]),
    );

    const { result } = renderHook(() => useBanners(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data.get('banner-league').url).toBe('/served/league.png');
    // `is_active: false` is an operator taking a placement down without
    // destroying it. It must not render.
    expect(result.current.data.has('banner-taken-down')).toBe(false);
  });
});

describe('the spin wheel', () => {
  it('reads `disabled` as a state rather than an error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(envelope({ slices: [], disabled: true }));

    const { result } = renderHook(() => useSpinSlices(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data.disabled).toBe(true);
    expect(result.current.data.slices).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  it('is public — the prizes are visible before signing up', async () => {
    let headers;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => {
      headers = init.headers ?? {};
      return Promise.resolve(envelope({ slices: [{ id: 1, label: '5%' }], disabled: false }));
    });

    tokenStore.set({ accessToken: 'should-not-be-sent', refreshToken: 'r' });

    const { result } = renderHook(() => useSpinSlices(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(headers.authorization).toBeUndefined();
    expect(result.current.data.slices).toHaveLength(1);
  });
});
