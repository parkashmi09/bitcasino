import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

/**
 * The window of page numbers to draw, with `null` standing for an ellipsis.
 *
 * Read off the reference's own pager on `/categories/video-slots`, which runs
 * to 203 pages — the only list long enough to show every branch:
 *
 * ```
 * page 1    1 2 3 4 … 203 ›
 * page 3  ‹ 1 2 3 4 … 203 ›
 * page 4  ‹ 1 … 3 4 5 … 203 ›
 * page 5  ‹ 1 … 4 5 6 … 203 ›
 * page 202 ‹ 1 … 200 201 202 203 ›
 * page 203 ‹ 1 … 200 201 202 203
 * ```
 *
 * So: the first and last page are always present, the current page sits in a
 * one-either-side window, and each end expands to a run of four rather than
 * showing an ellipsis that would hide a single number. That last part is the
 * detail worth keeping — `1 … 3` costs the same width as `1 2 3` and tells you
 * less.
 *
 * Everything is clamped and de-duplicated at the end, so a two-page list draws
 * `1 2` rather than `1 2 … 2`.
 *
 * @param {number} page The current page, 1-based.
 * @param {number} total Total pages, at least 1.
 * @returns {(number | null)[]}
 */
export function pageWindow(page, total) {
  if (total <= 1) return [1];

  // The numbers that must be shown: both ends, and a one-either-side window
  // around the current page. At either end that window is widened to a run of
  // four, which is what produces `1 2 3 4 … 203` rather than `1 2 3 … 203`.
  const shown = new Set([1, total]);
  const from = page <= 3 ? 1 : page >= total - 2 ? total - 3 : page - 1;
  const to = page <= 3 ? 4 : page >= total - 2 ? total : page + 1;
  for (let n = Math.max(from, 1); n <= Math.min(to, total); n += 1) shown.add(n);

  // Walk the shown numbers in order and close every gap with one ellipsis,
  // however small. A gap of exactly one is still an ellipsis: the reference
  // draws `1 … 3 4 5 … 203` on page 4 rather than `1 2 3 4 5 … 203`, and
  // collapsing it would make the row's width jump about as you page through.
  const out = [];
  let previous = 0;
  for (const n of [...shown].sort((a, b) => a - b)) {
    if (n - previous > 1) out.push(null);
    out.push(n);
    previous = n;
  }
  return out;
}

/** One 32px cell. The arrows are 34 wide on the reference; numbers are square. */
const CELL =
  'inline-grid h-8 place-items-center rounded-i-md text-sm font-medium transition-colors';

/**
 * Numbered pagination, as the reference draws it under a category grid.
 *
 * Measured: a `flex items-center gap-0.5` row, 32x32 cells at 8px radius,
 * 14px/500 type, the current page filled `piccolo` with white on it and every
 * other cell transparent. The two arrows are 34x32 and are simply **absent**
 * at the ends rather than rendered disabled.
 *
 * `onChange` rather than hrefs: the reference is a server-rendered app and
 * pages through `?page=` links, but here the page number is query state that
 * `Category` already owns and a full navigation would refetch the shell. The
 * caller is what writes `?page=` into the URL, so the address bar still says
 * the same thing.
 *
 * Renders nothing for a single page — there is no pager on a list that fits.
 *
 * @param {{page: number, totalPages: number, onChange: (page: number) => void, label?: string}} props
 */
export function Pager({ page, totalPages, onChange, label = 'Pagination' }) {
  if (!totalPages || totalPages <= 1) return null;

  const current = Math.min(Math.max(page, 1), totalPages);

  return (
    <nav aria-label={label} className="flex items-center justify-center gap-0.5">
      {current > 1 && (
        <button
          type="button"
          aria-label="Previous page"
          onClick={() => onChange(current - 1)}
          className={cn(CELL, 'w-[34px] text-bulma hover:bg-gohan')}
        >
          <Icon name="chevron-left" size={16} />
        </button>
      )}

      {pageWindow(current, totalPages).map((n, i) =>
        n === null ? (
          // An ellipsis has no identity of its own — its position IS what it
          // is, and there are at most two of them, so the index is a fine key.
          <span key={`gap-${i}`} className={cn(CELL, 'w-8 text-trunks')}>
            <span aria-hidden="true">…</span>
            <span className="sr-only">More pages</span>
          </span>
        ) : (
          <button
            key={n}
            type="button"
            aria-label={`Page ${n}`}
            aria-current={n === current ? 'page' : undefined}
            onClick={() => onChange(n)}
            className={cn(
              CELL,
              'w-8',
              n === current ? 'bg-piccolo text-goten' : 'text-bulma hover:bg-gohan',
            )}
          >
            {n}
          </button>
        ),
      )}

      {current < totalPages && (
        <button
          type="button"
          aria-label="Next page"
          onClick={() => onChange(current + 1)}
          className={cn(CELL, 'w-[34px] text-bulma hover:bg-gohan')}
        >
          <Icon name="chevron-right" size={16} />
        </button>
      )}
    </nav>
  );
}
