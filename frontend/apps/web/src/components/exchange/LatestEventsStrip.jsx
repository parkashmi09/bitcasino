import { Link } from 'react-router-dom';
import { SportIcon } from './icons';
import { cx, formatStartTime } from './utils';

/**
 * LatestEventsStrip — a horizontally scrolling row of event chips (the "latest events" ticker
 * above the lobby / match page).
 *
 * @param {object}   props
 * @param {Array<{id, name:string, sport?:string, inPlay?:boolean, startTime?}>} props.events
 *        `name` e.g. "India v Australia"; `sport` = sport-art key ('cricket' | 'soccer' | 'tennis').
 * @param {(event)=>string} [props.linkFor]   Router path → chips render as <Link>.
 * @param {(event)=>void}   [props.onOpen]    Used when `linkFor` is absent.
 * @param {string|number}   [props.activeId]  Highlighted chip (the match being viewed).
 * @param {(t)=>string}     [props.formatTime]
 * @param {string}          [props.className]
 */
export default function LatestEventsStrip({
  events = [],
  linkFor,
  onOpen,
  activeId,
  formatTime = formatStartTime,
  className = '',
}) {
  if (!events.length) return null;

  return (
    <div className={cx('hide-scroll flex gap-2 overflow-x-auto', className)}>
      {events.map((e) => {
        const on = activeId != null && e.id === activeId;
        const cls = cx(
          'flex h-9 max-w-[16rem] flex-none items-center gap-2 rounded-lg px-3 text-xs transition-colors',
          on ? 'bg-layer5 text-primary' : 'bg-layer3 text-secondary hover:bg-layer4',
        );
        const body = (
          <>
            {e.sport && (
              <SportIcon sport={e.sport} className="size-4 flex-none [&_svg]:size-full [&_svg]:fill-current" />
            )}
            <span className="truncate font-semibold">{e.name}</span>
            {e.inPlay ? (
              <span className="flex flex-none items-center gap-1 font-extrabold text-brand">
                <span className="size-1.5 animate-pulse rounded-full bg-brand" />
                LIVE
              </span>
            ) : (
              <span className="flex-none text-tertiary">{formatTime(e.startTime)}</span>
            )}
          </>
        );
        return linkFor ? (
          <Link key={e.id} to={linkFor(e)} className={cls}>
            {body}
          </Link>
        ) : (
          <button key={e.id} type="button" onClick={() => onOpen?.(e)} className={cls}>
            {body}
          </button>
        );
      })}
    </div>
  );
}
