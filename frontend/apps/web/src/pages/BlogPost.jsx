import { Link, useParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryError } from '@/components/ui/QueryState';
import { useBlogPost } from '@/queries';
import { formatDate } from '@/pages/Blog';
import { sanitizeHtml } from '@/lib/sanitizeHtml';

/**
 * `/blog/:slug` — one post.
 *
 * ## The body is staff-written HTML, sanitised before it is drawn
 *
 * `blogs.description` is written in the admin panel, as HTML or plain text
 * (hash-game-exchange draws it the same way). It reaches this page over a
 * public route, so it goes through `lib/sanitizeHtml` — an allowlist that
 * drops scripts, frames, `on*` handlers and `javascript:` URLs — and only
 * then into `dangerouslySetInnerHTML`. Plain text becomes paragraphs.
 *
 * ## Fetched by slug rather than filtered out of the index
 *
 * The list route ships metadata only — `description` is null on every row it
 * returns — so the body genuinely is a second request. Arriving from a card
 * does not warm it, which is why this has a real skeleton rather than
 * borrowing the list's cached row.
 */
export function BlogPost() {
  const { slug } = useParams();
  const { data: post, isPending, isError, error, refetch } = useBlogPost(slug);

  if (isPending) return <PostSkeleton />;

  if (isError) {
    /**
     * A 404 is the expected failure here — somebody followed a stale link —
     * and it is not the same event as the service being down. `QueryError`
     * offers a retry, which is the wrong offer for a post that does not
     * exist.
     */
    if (error?.status === 404 || error?.code === 'BLOG_NOT_FOUND') return <NotFound />;

    return (
      <div className="py-6">
        <QueryError error={error} onRetry={refetch} title="Could not load this post" />
      </div>
    );
  }

  if (!post) return <NotFound />;

  const html = sanitizeHtml(post.body);

  return (
    <article className="py-4">
      <Link
        to="/blog"
        className="inline-flex items-center gap-1 text-xs text-trunks transition-colors hover:text-piccolo"
      >
        <Icon name="chevron-left" size={14} />
        All posts
      </Link>

      <header className="mt-3 max-w-[720px]">
        <div className="flex flex-wrap items-center gap-2 text-xs text-trunks">
          {post.category && (
            <Link
              to={`/blog?category=${encodeURIComponent(post.category)}`}
              className="rounded-i-xs bg-gohan px-2 py-0.5 font-medium text-bulma transition-colors hover:bg-beerus"
            >
              {post.category}
            </Link>
          )}
          <time dateTime={post.date ?? undefined}>{formatDate(post.date)}</time>
          {post.author && <span>· by {post.author}</span>}
        </div>

        <h1 className="mt-2 font-secondary text-3xl leading-tight font-normal text-bulma">
          {post.title}
        </h1>

        {post.standfirst && (
          <p className="mt-2 text-base leading-relaxed text-trunks">{post.standfirst}</p>
        )}
      </header>

      {post.image && (
        <img
          src={post.image}
          alt=""
          className="mt-5 max-w-[720px] rounded-s-md"
          /* Decorative: the post has no alt text field, and inventing one
             from the title would repeat the `h1` a screen reader just read. */
        />
      )}

      {html ? (
        <div
          className={
            'mt-5 grid max-w-[720px] gap-4 text-base leading-relaxed text-bulma ' +
            '[&_a]:text-piccolo [&_a]:underline [&_h2]:text-xl [&_h3]:text-lg [&_img]:rounded-s-md ' +
            '[&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:list-disc [&_ul]:ps-5'
          }
          // Sanitised above — see the note at the top.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className="mt-5 text-sm text-trunks">This post has no content yet.</p>
      )}
    </article>
  );
}

function NotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="font-secondary text-2xl font-normal text-bulma">Post not found</h1>
      <p className="mt-2 text-sm text-trunks">
        It may have been unpublished, or the link may be out of date.
      </p>
      <Link to="/blog" className="mt-3 inline-block text-sm text-piccolo hover:underline">
        Back to the blog
      </Link>
    </div>
  );
}

function PostSkeleton() {
  return (
    <div className="py-4" aria-hidden="true">
      <Skeleton className="h-4 w-24" />
      <div className="mt-3 grid max-w-[720px] gap-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="mt-2 h-5 w-full" />
      </div>
      <div className="mt-5 grid max-w-[720px] gap-3">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-4 w-full" />
        ))}
      </div>
    </div>
  );
}
