import { Link, useSearchParams } from 'react-router-dom';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryEmpty, QueryError } from '@/components/ui/QueryState';
import { useBlogPosts } from '@/queries';
import { cn } from '@/lib/cn';

/**
 * `/blog` — the post index, over `GET /api/v1/admin/blogs`.
 *
 * Public: admin-service mounts the `public` and `staff` audiences at the same
 * path and only the guard differs, so an `/admin/` URL read without a token
 * is the platform's own shape rather than a leak.
 *
 * ## The category filter is free text, not an enum
 *
 * `blogs.category` is a plain column an operator types into. There is no
 * canonical list, so the filter chips are built from the categories the
 * fetched page actually contains rather than from a hard-coded set — a chip
 * for a category nobody has used would return an empty page, and a category
 * somebody just added would have no chip at all.
 *
 * That does mean the chips describe the page in front of you rather than the
 * whole archive. With three seeded posts on one page they are the same thing;
 * they diverge once there are more posts than a page holds, which is the
 * point at which the platform needs a "list the categories" route it does not
 * currently have.
 *
 * ## No post has an image
 *
 * `imageUrl` is null on every seeded row and on any post uploaded without
 * one, so the card is designed around not having art rather than reserving a
 * hole for it.
 */

const PAGE = 12;

export function Blog() {
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? undefined;
  const page = Math.max(1, Number(params.get('page') ?? 1) || 1);

  const { data, isPending, isError, error, refetch } = useBlogPosts({
    page,
    limit: PAGE,
    category,
  });

  const posts = data?.posts ?? [];
  const pagination = data?.pagination ?? null;

  /** The categories present on this page. See the note above. */
  const categories = [...new Set(posts.map((post) => post.category).filter(Boolean))];

  const select = (next) => {
    const updated = new URLSearchParams(params);
    if (next) updated.set('category', next);
    else updated.delete('category');
    // A category change is a different list; page 4 of it probably does not
    // exist, and an empty page reads as a broken filter.
    updated.delete('page');
    setParams(updated, { replace: true });
  };

  const goTo = (next) => {
    const updated = new URLSearchParams(params);
    if (next > 1) updated.set('page', String(next));
    else updated.delete('page');
    setParams(updated);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="py-4">
      <h1 className="font-secondary text-2xl font-normal text-bulma">Blog</h1>
      <p className="mt-1 text-sm text-trunks">
        Announcements, guides and policy from the team.
      </p>

      {/* Only drawn when there is more than one category to choose between —
          a single chip beside "All" is a control with nothing to do. */}
      {categories.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          <CategoryChip active={!category} onClick={() => select(null)}>
            All
          </CategoryChip>
          {categories.map((name) => (
            <CategoryChip
              key={name}
              active={category === name}
              onClick={() => select(name)}
            >
              {name}
            </CategoryChip>
          ))}
        </div>
      )}

      <div className="mt-5">
        {isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-44 rounded-s-md" />
            ))}
          </div>
        ) : isError ? (
          <QueryError error={error} onRetry={refetch} title="Could not load the blog" />
        ) : posts.length === 0 ? (
          <QueryEmpty
            title={category ? `Nothing in ${category}` : 'No posts yet'}
            message={
              category
                ? 'Try another category.'
                : 'Posts published from the admin panel appear here.'
            }
          />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <PostCard key={post.slug} post={post} />
              ))}
            </div>

            {pagination && pagination.totalPages > 1 && (
              <Pager page={page} pagination={pagination} onChange={goTo} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PostCard({ post }) {
  return (
    <Link
      to={`/blog/${post.slug}`}
      className="group flex h-full flex-col gap-2 rounded-s-md bg-gohan p-4 transition-colors hover:bg-beerus"
    >
      <div className="flex items-center gap-2 text-xs text-trunks">
        {post.category && (
          <span className="rounded-i-xs bg-goku px-2 py-0.5 font-medium text-bulma">
            {post.category}
          </span>
        )}
        <time dateTime={post.date ?? undefined}>{formatDate(post.date)}</time>
      </div>

      <h2 className="font-secondary text-lg leading-6 font-medium text-bulma group-hover:text-piccolo">
        {post.title}
      </h2>

      {post.standfirst && (
        <p className="text-sm leading-relaxed text-trunks">{post.standfirst}</p>
      )}

      {/* Pushed to the foot so every card's byline sits on one line however
          long the standfirst above it runs. */}
      {post.author && (
        <span className="mt-auto pt-2 text-xs text-trunks">By {post.author}</span>
      )}
    </Link>
  );
}

function CategoryChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'cursor-pointer rounded-i-sm px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-piccolo text-goten' : 'bg-gohan text-bulma hover:bg-beerus',
      )}
    >
      {children}
    </button>
  );
}

/**
 * Numbered here, unlike the transactions table's Previous/Next.
 *
 * The difference is that `meta.pagination` on this route carries a real
 * `totalPages` for the one list being read. The transactions screen has two
 * separately-counted sides and no single total, which is why it cannot.
 */
function Pager({ page, pagination, onChange }) {
  return (
    <div className="mt-5 flex items-center justify-between gap-3 border-t border-beerus pt-4">
      <span className="text-xs text-trunks tabular-nums">
        Page {page} of {pagination.totalPages}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!pagination.hasPrev}
          onClick={() => onChange(page - 1)}
          className="cursor-pointer rounded-i-sm bg-beerus px-3 py-1.5 text-xs font-medium text-bulma transition-colors hover:bg-trunks/20 disabled:cursor-default disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={!pagination.hasNext}
          onClick={() => onChange(page + 1)}
          className="cursor-pointer rounded-i-sm bg-beerus px-3 py-1.5 text-xs font-medium text-bulma transition-colors hover:bg-trunks/20 disabled:cursor-default disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
