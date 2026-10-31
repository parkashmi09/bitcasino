import { Link } from 'react-router-dom';
import { SportIcon, IconArrow, IconTv } from './icons';
import { cx, formatStartTime } from './utils';

/**
 * MatchHeader — the match page's title card: breadcrumb (league › match), start time or
 * in-play, a TV toggle and a slot for the scoreboard / stream.
 *
 * @param {object}   props
 * @param {string}   props.name                    "India v Australia".
 * @param {string}   [props.competition]           League / series.
 * @param {string}   [props.competitionTo]         Router path for the league crumb (<Link>).
 * @param {string}   [props.sport]                 Sport-art key for the crumb icon.
 * @param {string|number|Date} [props.startTime]
 * @param {boolean}  [props.inPlay]
 * @param {(t)=>string} [props.formatTime]
 * @param {()=>void} [props.onBack]                Shows a back chevron (phones).
 * @param {boolean}  [props.tvAvailable]           Shows the TV toggle.
 * @param {boolean}  [props.showTv]                Toggle state.
 * @param {(next:boolean)=>void} [props.onToggleTv]
 * @param {React.ReactNode} [props.scoreSlot]      Scoreboard / stream, rendered under the title row (the wiring decides score vs TV).
 * @param {React.ReactNode} [props.actions]        Extra right-side controls.
 */
export default function MatchHeader({
  name,
  competition,
  competitionTo,
  sport,
  startTime,
  inPlay = false,
  formatTime = formatStartTime,
  onBack,
  tvAvailable = false,
  showTv = false,
  onToggleTv,
  scoreSlot,
  actions,
}) {
  return (
    <header className="overflow-hidden rounded-xl bg-layer3">
      <div className="flex items-center gap-2 px-3 py-3 sm:px-4">
        {onBack && (
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="flex size-8 flex-none items-center justify-center rounded-md bg-layer4 hover:bg-layer5"
          >
            <IconArrow className="size-4 fill-secondary" />
          </button>
        )}

        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-tertiary">
            {sport && <SportIcon sport={sport} className="size-3.5 flex-none [&_svg]:size-full [&_svg]:fill-tertiary" />}
            {competition &&
              (competitionTo ? (
                <Link to={competitionTo} className="truncate hover:text-secondary">
                  {competition}
                </Link>
              ) : (
                <span className="truncate">{competition}</span>
              ))}
            {competition && <IconArrow className="size-3 flex-none rotate-180 fill-tertiary" />}
            <span className="truncate text-secondary">{name}</span>
          </p>
          <h1 className="mt-1 truncate text-base font-extrabold text-primary sm:text-lg">{name}</h1>
        </div>

        <div className="flex flex-none items-center gap-2">
          {inPlay ? (
            <span className="flex items-center gap-1.5 rounded-full bg-layer4 px-2.5 py-1 text-xs font-extrabold text-brand">
              <span className="size-1.5 animate-pulse rounded-full bg-brand" />
              In-Play
            </span>
          ) : (
            <span className="rounded-full bg-layer4 px-2.5 py-1 text-xs font-semibold text-secondary">
              {formatTime(startTime)}
            </span>
          )}
          {tvAvailable && (
            <button
              type="button"
              aria-pressed={showTv}
              aria-label={showTv ? 'Hide live stream' : 'Show live stream'}
              onClick={() => onToggleTv?.(!showTv)}
              className={cx(
                'flex size-8 items-center justify-center rounded-md transition-colors',
                showTv ? 'bg-button-brand' : 'bg-layer4 hover:bg-layer5',
              )}
            >
              <IconTv className={cx('size-4', showTv ? 'fill-alw_dark' : 'fill-secondary')} />
            </button>
          )}
          {actions}
        </div>
      </div>
      {scoreSlot && <div className="border-t border-third">{scoreSlot}</div>}
    </header>
  );
}
