import { useQuery } from '@tanstack/react-query';
import { api, apiWithMeta } from '@/lib/api';
import { ENDPOINTS, path } from '@/lib/endpoints';
import { queryKeys } from '@/queries/keys';

/**
 * The content reads: blog posts and banner placements.
 *
 * Both are on **admin-service**, both are `public`. The `public` and `staff`
 * audiences mount at the same path and only the guard differs, so an
 * `/api/v1/admin/…` path called without a token is not a mistake — it is the
 * platform's own shape. `auth: false` on every call here says so at the call
 * site rather than leaving the next reader to wonder.
 *
 * @see docs/10-backend-integration.md, Phase 7.
 */

/**
 * A blog post as this app renders one.
 *
 * The platform's row is close enough that this is a rename rather than a
 * projection, but it is still done in one place: `description` is the BODY —
 * not a summary, despite the name — and `subheading` is the standfirst. A
 * component reading `description` directly would be reasonable to assume the
 * opposite.
 *
 * `imageUrl` is null for every seeded post and for any post uploaded without
 * one, so the card and the detail page both have to render without art.
 */
function toPost(row) {
  if (!row || typeof row !== 'object' || !row.slug) return null;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title ?? row.slug,
    /** The standfirst, one line under the title. */
    standfirst: row.subheading ?? null,
    /** The body. `description` on the wire; it is the whole post. */
    body: row.description ?? null,
    author: row.author ?? null,
    category: row.category ?? null,
    /**
     * `date` is the editorial date the operator set; `publishedAt` is when it
     * actually went live and is null on every seeded row. The editorial one
     * is what a reader wants, with the other as a fallback.
     */
    date: row.date ?? row.publishedAt ?? row.createdAt ?? null,
    /**
     * Absolute path, served raw from the row's `BYTEA` with the content type
     * detected from the bytes. Null when nothing was uploaded — which is
     * every seeded post, so the art is optional everywhere it appears.
     */
    image: row.imageUrl ? path(ENDPOINTS.blogImage, { id: row.id }) : null,
  };
}

/**
 * The blog index, newest first.
 *
 * **Page-based** (`page`/`limit`) — the blogs validator is one of the three
 * the platform uses, and it is not the wallet's `limit`/`offset`. Sending the
 * wrong pair is a 422, and a 422 on a list renders as "no posts yet".
 *
 * A list row carries metadata only; `body` is null on every one of them,
 * because the index route does not ship each post's full text. That is why
 * `useBlogPost` exists rather than the detail page filtering the list.
 */
export function useBlogPosts({ page = 1, limit = 12, category } = {}) {
  return useQuery({
    queryKey: queryKeys.content.posts({ page, limit, category }),
    queryFn: ({ signal }) =>
      apiWithMeta(
        category
          ? path(ENDPOINTS.blogsByCategory, { category })
          : ENDPOINTS.blogs,
        { query: { page, limit }, auth: false, signal },
      ),
    select: ({ data, meta }) => ({
      posts: (Array.isArray(data) ? data : []).map(toPost).filter(Boolean),
      pagination: meta?.pagination ?? null,
    }),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * One post, by slug.
 *
 * The slug rather than the id, because it is the URL and it survives a
 * re-import that renumbers the table.
 */
export function useBlogPost(slug) {
  const term = String(slug ?? '').trim();

  return useQuery({
    queryKey: queryKeys.content.post(term),
    queryFn: ({ signal }) =>
      api(path(ENDPOINTS.blogBySlug, { slug: term }), { auth: false, signal }),
    select: toPost,
    enabled: term.length > 0,
    staleTime: 5 * 60 * 1000,
    /**
     * One retry. A missing slug is a 404 and retrying it twice more just
     * delays the "not found" the reader is going to see anyway.
     */
    retry: 1,
  });
}

/**
 * The active banner placements, keyed by `type`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS ANSWERS ART, NOT CONTENT.
 *
 * The row is `(id, type, image, content_type, byte_size, is_active, …)`.
 * There is no title, no blurb and no destination anywhere in it. So this can
 * tell a placement which PICTURE to draw and nothing else — the copy and the
 * link stay in `data/catalog.js`, because the platform has nowhere to put
 * them. `HomeBanner.jsx` carries the full reasoning.
 *
 * Returns a `Map` of `type -> {id, url, contentType}` rather than a list,
 * because every caller looks a placement up by name and none of them iterates.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * An empty table is the normal state on a deployment where no operator has
 * uploaded anything — which is this one — so every caller must render without
 * it. This is deliberately NOT an error state: nothing is wrong.
 */
export function useBanners() {
  return useQuery({
    queryKey: queryKeys.content.banners(),
    queryFn: ({ signal }) => api(ENDPOINTS.banners, { auth: false, signal }),
    select: (rows) => {
      const found = new Map();
      for (const row of Array.isArray(rows) ? rows : []) {
        if (!row?.type || row.active === false) continue;
        found.set(String(row.type), {
          id: row.id,
          /**
           * The server's own URL when it gives one, otherwise built from the
           * placement. Either way it is an `<img src>` and never goes through
           * `api.js` — the route answers raw bytes, not the envelope.
           */
          url: row.url ?? path(ENDPOINTS.bannerImage, { filename: row.type }),
          contentType: row.contentType ?? null,
        });
      }
      return found;
    },
    staleTime: 10 * 60 * 1000,
  });
}
