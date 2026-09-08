import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { useCountdown } from '@/hooks/useCountdown';
import { cn } from '@/lib/cn';

/**
 * One tournament, as the reference draws it on `/tournaments`.
 *
 * Geometry is read off the reference's own DOM at a 1536px viewport rather
 * than measured off a screenshot, so these are its literal values:
 *
 * | | |
 * | --- | --- |
 * | Card | `h-[24.625rem]`, `max-w-[36.125rem]`, `p-4`, 12px radius, `gohan` |
 * | Rows | `grid-rows-[1fr_1fr]`, 4px apart — art on top, body underneath |
 * | Art | `h-[11.375rem]`, `object-cover`, 12px radius |
 * | Body | two equal columns, 8px apart, `pt-2` |
 * | Prize panel | `goku`, 8px radius, `px-4 py-5`, `h-44` |
 *
 * Three details are load-bearing:
 *
 * 1. The card is a fixed height, not a content height. A rail of these has to
 *    stay on one baseline whatever the titles do, which is also why the title
 *    is `line-clamp-2` — two lines is the space the layout budgets for it.
 * 2. The finished state is `grayscale(1)` on the SAME artwork, not a second
 *    file. The reference ships one image per tournament and desaturates it in
 *    CSS; generating a grey twin would double the asset count for a state that
 *    is one filter.
 * 3. The action row is `grid-cols-[1fr_0.75fr]` with the arrow at the START of
 *    its column. That is the reference's own ratio — 269px of column splits to
 *    a 149px button — and it is what leaves the arrow sitting mid-column with
 *    air after it, rather than pinned to the card edge the way `justify-between`
 *    would put it.
 *
 * ## Neither control works yet, and they are inert in different ways
 *
 * `Opt in` does not opt anybody in. There is no tournaments service (`docs/10`
 * puts them in `bonus`, with Promotions and VIP), so entry has nowhere to
 * post; the button keeps the reference's shape and is `disabled`, which is a
 * state a button genuinely has.
 *
 * The arrow opens `/tournaments/<slug>` on the reference — a detail page with
 * a leaderboard, a prize breakdown and the rules, which this project has not
 * built. So it is a `span` with no role and no tab stop rather than a link to
 * a 404: the same rule the account tab bar uses for `Tournaments` and the
 * sidebar uses for its favourites star. `docs/11` carries it.
 *
 * Both are drawn at full strength apart from the button's `disabled` fade.
 * Greying the card out would say the tournament is unavailable, which is not
 * what is missing — the tournament is real, the page behind it is not.
 */
export function TournamentCard({ tournament }) {
  const { title, slug, art, status, prizePool, leader, endsAt } = tournament;
  const finished = status === 'finished';
  const time = useCountdown(endsAt);

  return (
    <article
      className={cn(
        'grid h-[24.625rem] w-full max-w-[36.125rem] grid-rows-[1fr_1fr] gap-1',
        'rounded-s-md bg-gohan p-4',
      )}
    >
      <img
        src={art}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn(
          'block h-[11.375rem] w-full rounded-s-md bg-goku-80 object-cover',
          finished && 'grayscale',
        )}
      />

      <div className="grid grid-cols-2 gap-2 pt-2">
        <div className="grid gap-2">
          {/* 9px rather than the 10px `Badge` primitive uses, with the
              reference's own letter-spacing. `Badge` is the overlay label on
              game tiles and is a size larger; matching it here would make the
              status read as a promo flag on artwork instead of a state. */}
          <div className="flex h-8 items-center justify-between">
            <span
              className={cn(
                'inline-flex h-4 items-center rounded-i-xs px-2',
                'text-[9px] font-medium uppercase tracking-[0.0625rem] text-goten',
                finished ? 'bg-popo' : 'bg-roshi',
              )}
            >
              {finished ? 'Finished' : 'Active'}
            </span>

            {/* The reference hangs the tournament's game icon here on a 32px
                disc with a soft shadow. Ours is the tournaments nav icon —
                every tournament in this catalogue spans the whole lobby rather
                than one title, so a single game's thumbnail would be a lie. */}
            <span className="grid size-8 place-items-center rounded-full bg-goku text-trunks shadow-[0_0_0.75rem_rgba(15,22,31,0.1)]">
              <Icon name="trophy" size={18} />
            </span>
          </div>

          <span className="truncate text-base leading-6 text-bulma">#1st {leader}</span>

          <p className="line-clamp-2 font-secondary text-[18px] font-light leading-6 text-bulma">
            {title}
          </p>

          <div className="grid grid-cols-[1fr_0.75fr] gap-2">
            <Button variant={finished ? 'outline' : 'primary'} disabled={finished} fullWidth>
              {finished ? 'Finished' : 'Opt in'}
            </Button>

            <span
              data-slug={slug}
              className="grid size-10 place-items-center justify-self-start rounded-full bg-goku text-bulma"
            >
              <Icon name="arrow-right" size={24} />
            </span>
          </div>
        </div>

        <div className="grid h-44 gap-1 rounded-s-sm bg-goku px-4 py-5">
          <div className="grid gap-2">
            <p className="text-xs leading-4 text-trunks">Prize pool</p>
            <div className="grid h-8 rounded-i-xs bg-gohan px-2 py-1.5">
              <span className="line-clamp-1 text-sm leading-6 text-bulma">{prizePool}</span>
            </div>
          </div>

          <Countdown time={time} />
        </div>
      </div>
    </article>
  );
}

/**
 * `05 / 10 : 44 : 53` under `DAY HOUR MIN SEC`.
 *
 * The separator between days and hours is a slash and the rest are colons —
 * the reference's own punctuation, and the reason this is a list of pairs
 * rather than a `join(':')`. Each unit is a 40px `gohan` tile with an 8px
 * caption beneath it; the separator is its own column so the tiles stay on an
 * even pitch whatever the punctuation is.
 */
function Countdown({ time }) {
  const units = [
    { value: time.days, label: 'Day', after: '/' },
    { value: time.hours, label: 'Hour', after: ':' },
    { value: time.minutes, label: 'Min', after: ':' },
    { value: time.seconds, label: 'Sec', after: null },
  ];

  return (
    <div className="grid grid-flow-col rounded-s-sm p-1">
      {units.map((unit) => (
        <div key={unit.label} className="grid grid-flow-col grid-cols-[1fr_0.1fr]">
          <div className="grid items-center">
            <div className="mb-[2px] flex h-10 min-w-9 items-center justify-center rounded-s-sm bg-gohan text-base leading-7 text-bulma">
              {unit.value}
            </div>
            <span className="text-center text-[8px] font-semibold uppercase leading-3 tracking-[0.5px] text-bulma">
              {unit.label}
            </span>
          </div>

          {unit.after && (
            <p aria-hidden="true" className="grid h-10 place-items-center px-0.5 font-medium text-bulma">
              {unit.after}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
