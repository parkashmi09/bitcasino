import { Skeleton } from './site';
import { PAIR_W } from './MatchRow';
import { CELL_W } from './RunnerRow';
import { cx } from './utils';

/**
 * The exchange's first-load placeholders — one per real section, built from the shared
 * `components/shared/Skeleton` (which paints over a sized box, so each bone here is an empty
 * element with the real content's height and width) and laid out with the SAME classes as the
 * component it stands in for, so nothing jumps when the data lands.
 *
 * Shown only while a section has NO data for its current arguments (first load, or a filter
 * change that starts a new read) — never on a poll, where the last answer stays on screen.
 *
 *   SkeletonMatchList    lobby / in-play list (InPlayList + MatchRow)
 *   SkeletonMarketBlock  a match-odds style market (MarketCard + RunnerRow)
 *   SkeletonFancyBlock   fancy / line rows (two cells)
 *   SkeletonMatchBoard   the match page's market board (tabs + blocks)
 *   SkeletonBetRows      My Bets / Open Bets / statement rows
 *   SkeletonSportsMenu   the sidebar sports tree
 *   SkeletonSportsBets   wallet Bet History → Sports (table from sm, cards below)
 */

/** One bone: an empty, sized block (or an inline-block `<span>` with `inline`, for use inside
 *  text such as a heading). `className` carries the size and rounding. */
export function Bone({ className = '', inline = false }) {
  return (
    <Skeleton
      as={inline ? 'span' : 'div'}
      className={cx(inline ? 'inline-block align-middle' : 'block', className)}
      radius={0}
      aria-hidden="true"
    />
  );
}

const range = (n) => Array.from({ length: n }, (_, i) => i);

/** An odds box — the real OddsCell's height (`h-11 sm:h-12`, `h-9` small). */
function CellBone({ small = false, className = '' }) {
  return <Bone className={cx(small ? 'h-9' : 'h-11 sm:h-12', 'w-full rounded-md', className)} />;
}

export function SkeletonMatchList({ title = true, groups = 1, rows = 5 }) {
  return (
    <section className="flex flex-col gap-3" aria-busy="true" aria-label="Loading matches">
      {title && <Bone className="h-6 w-24 rounded" />}
      {range(groups).map((g) => (
        <div key={g} className="overflow-hidden rounded-xl bg-layer3">
          <div className="flex items-center gap-3 bg-layer4 px-3 py-2 sm:px-4">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Bone className="size-4 rounded" />
              <Bone className="h-3.5 w-40 rounded" />
            </span>
          </div>
          {range(rows).map((r) => (
            <div
              key={r}
              className="flex flex-col gap-2 border-t border-third px-3 py-2.5 first:border-t-0 sm:flex-row sm:items-center sm:gap-3 sm:px-4"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Bone className="h-4 w-3/5 max-w-48 rounded" />
                  <Bone className="h-4 w-1/2 max-w-40 rounded" />
                </span>
                <Bone className="h-3.5 w-14 flex-none rounded" />
              </div>
              <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-none sm:gap-1.5">
                {range(3).map((p) => (
                  <div key={p} className={cx('flex gap-0.5', PAIR_W)}>
                    <CellBone className="flex-1" />
                    <CellBone className="flex-1" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

export function SkeletonMarketBlock({ runners = 3 }) {
  return (
    <section className="overflow-hidden rounded-xl bg-layer3" aria-hidden="true">
      <div className="flex min-h-12 items-center gap-2 px-3 sm:px-4">
        <span className="flex flex-1 flex-col gap-1.5 py-2">
          <Bone className="h-4 w-28 rounded" />
          <Bone className="h-3 w-36 rounded" />
        </span>
        <Bone className="size-8 rounded-md" />
      </div>
      <div className="pb-1.5">
        {range(runners).map((r) => (
          <div key={r} className="border-t border-third">
            <div className="flex items-center gap-2 px-3 py-1.5 sm:px-4">
              <div className="min-w-0 flex-1">
                <Bone className="h-4 w-2/5 max-w-40 rounded" />
              </div>
              {range(6).map((c) => (
                /* Back ×3 then Lay ×3; below sm only the best of each side shows, as on RunnerRow. */
                <div key={c} className={cx(CELL_W, 'flex-none', c !== 2 && c !== 3 && 'hidden sm:block')}>
                  <CellBone />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export function SkeletonFancyBlock({ rows = 4 }) {
  return (
    <section className="overflow-hidden rounded-xl bg-layer3" aria-hidden="true">
      <div className="flex min-h-12 items-center px-3 sm:px-4">
        <Bone className="h-4 w-20 rounded" />
      </div>
      {range(rows).map((r) => (
        <div key={r} className="flex items-center gap-2 border-t border-third px-3 py-1.5 sm:px-4">
          <div className="min-w-0 flex-1">
            <Bone className="h-4 w-3/5 max-w-56 rounded" />
          </div>
          <div className={cx(CELL_W, 'flex-none')}>
            <CellBone />
          </div>
          <div className={cx(CELL_W, 'flex-none')}>
            <CellBone />
          </div>
        </div>
      ))}
    </section>
  );
}

export function SkeletonMatchBoard() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading markets">
      <div className="flex gap-2">
        {range(4).map((t) => (
          <Bone key={t} className="h-9 w-24 rounded-lg" />
        ))}
      </div>
      <SkeletonMarketBlock runners={3} />
      <SkeletonMarketBlock runners={2} />
      <SkeletonFancyBlock rows={4} />
    </div>
  );
}

/** Bet / statement rows: accent bar, two lines on the left, two short lines on the right. */
export function SkeletonBetRows({ rows = 4, accent = true, compact = false }) {
  return (
    <div className={cx('flex flex-col', compact && 'gap-1.5')} aria-busy="true" aria-label="Loading">
      {range(rows).map((r) =>
        compact ? (
          <div key={r} className="flex items-stretch gap-2 overflow-hidden rounded-lg bg-layer4">
            <span className="w-1 flex-none bg-layer5" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-2">
              <Bone className="h-4 w-2/3 rounded" />
              <Bone className="h-3 w-1/2 rounded" />
            </div>
            <div className="flex flex-none flex-col items-end gap-1.5 py-2 pr-2">
              <Bone className="h-3.5 w-20 rounded" />
              <Bone className="h-3.5 w-12 rounded" />
            </div>
          </div>
        ) : (
          <div key={r} className="flex items-stretch gap-3 border-b border-third py-3">
            {accent && <span className="w-1 flex-none rounded-full bg-layer5" />}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Bone className="h-4 w-1/2 max-w-56 rounded" />
              <Bone className="h-3 w-3/4 max-w-80 rounded" />
              <Bone className="h-3 w-1/3 max-w-32 rounded" />
            </div>
            <div className="flex flex-none flex-col items-end gap-1.5">
              <Bone className="h-4 w-24 rounded" />
              <Bone className="h-4 w-16 rounded" />
            </div>
          </div>
        ),
      )}
    </div>
  );
}

export function SkeletonSportsMenu({ rows = 8 }) {
  return (
    <div aria-busy="true" aria-label="Loading sports">
      {range(rows).map((r) => (
        <div key={r} className="mt-1 flex h-10 items-center gap-2 px-3 lg:pl-2.5">
          <Bone className="size-5 flex-none rounded" />
          <Bone className="sidebar-collapse-hide h-3.5 w-28 rounded" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonSportsBets({ rows = 5 }) {
  return (
    <div className="pb-4" aria-busy="true" aria-label="Loading sports bets">
      <Bone className="mt-1 h-5 w-64 max-w-full rounded" />
      <div className="mt-3 hidden h-11 rounded-xl bg-layer2 sm:block" />
      <div className="hidden sm:block">
        {range(rows).map((r) => (
          <div key={r} className="flex items-center gap-3 border-b border-third px-4 py-3">
            <div className="flex min-w-0 flex-[3] flex-col gap-1.5">
              <Bone className="h-3 w-40 rounded" />
              <Bone className="h-3.5 w-4/5 rounded" />
              <Bone className="h-5 w-32 rounded" />
            </div>
            {range(5).map((c) => (
              <div key={c} className={cx('flex flex-1', c === 3 ? 'justify-center' : 'justify-end')}>
                <Bone className={cx('h-5 rounded', c === 3 ? 'w-12' : 'w-16')} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-col gap-2 sm:hidden">
        {range(rows).map((r) => (
          <div key={r} className="rounded-xl bg-layer5 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Bone className="h-3 w-32 rounded" />
                <Bone className="h-3.5 w-4/5 rounded" />
                <Bone className="h-5 w-28 rounded" />
              </div>
              <Bone className="h-5 w-12 rounded" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {range(3).map((c) => (
                <div key={c} className="flex flex-col gap-1">
                  <Bone className="h-3 w-10 rounded" />
                  <Bone className="h-4 w-14 rounded" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
