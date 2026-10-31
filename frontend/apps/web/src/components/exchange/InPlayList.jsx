import MatchRow, { PAIR_W } from './MatchRow';
import { SportIcon } from './icons';
import { cx } from './utils';

/**
 * InPlayList — lobby fixtures grouped by competition, one layer3 card per competition with a
 * 1 / X / 2 column header (desktop).
 *
 * @param {object}   props
 * @param {Array<object>} props.matches          MatchRow `match` objects; each needs `competition` (string) and optionally `sport`.
 * @param {string}   [props.title]               Optional heading above the groups ("In-Play", "Upcoming").
 * @param {React.ReactNode} [props.titleExtra]   Right side of the heading (e.g. a count or "See all" <Link>).
 * @param {React.ReactNode} [props.empty]        Rendered when `matches` is empty (default: a muted line).
 * @param {(match)=>string} [props.linkFor]      Router path per match → rows render as <Link>.
 * @param {(match)=>void} [props.onOpen]
 * @param {(sel)=>void}   [props.onSelect]       See MatchRow.
 * @param {(t)=>string}   [props.formatTime]  @param {(n)=>string} [props.formatSize]
 */
export default function InPlayList({
  matches = [],
  title,
  titleExtra,
  empty,
  linkFor,
  onOpen,
  onSelect,
  formatTime,
  formatSize,
}) {
  /* Grouped in first-seen order, so the feed's own ordering of competitions is kept. */
  const groups = [];
  const byKey = new Map();
  for (const m of matches) {
    const key = m.competition ?? 'Other';
    if (!byKey.has(key)) {
      const g = { key, sport: m.sport, matches: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    byKey.get(key).matches.push(m);
  }

  return (
    <section className="flex flex-col gap-3">
      {title && (
        <div className="flex items-center justify-between">
          <h2 className="text-base font-extrabold text-primary">{title}</h2>
          {titleExtra}
        </div>
      )}

      {groups.length === 0
        ? (empty ?? (
            <p className="rounded-xl bg-layer3 px-4 py-8 text-center text-sm text-tertiary">
              No matches right now.
            </p>
          ))
        : groups.map((g) => (
            <div key={g.key} className="overflow-hidden rounded-xl bg-layer3">
              <div className="flex items-center gap-3 bg-layer4 px-3 py-2 sm:px-4">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {g.sport && (
                    <SportIcon sport={g.sport} className="size-4 flex-none [&_svg]:size-full [&_svg]:fill-secondary" />
                  )}
                  <span className="truncate text-xs font-semibold text-secondary">{g.key}</span>
                </span>
                <span className="hidden flex-none gap-1.5 sm:flex">
                  {['1', 'X', '2'].map((l) => (
                    <span key={l} className={cx(PAIR_W, 'text-center text-xs font-extrabold text-tertiary')}>
                      {l}
                    </span>
                  ))}
                </span>
              </div>
              {g.matches.map((m) => (
                <MatchRow
                  key={m.id}
                  match={m}
                  to={linkFor ? linkFor(m) : undefined}
                  onOpen={onOpen}
                  onSelect={onSelect}
                  formatTime={formatTime}
                  formatSize={formatSize}
                />
              ))}
            </div>
          ))}
    </section>
  );
}
