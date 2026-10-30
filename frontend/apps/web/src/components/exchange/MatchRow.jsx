import { Link } from 'react-router-dom';
import OddsCell from './OddsCell';
import { BetbyIcon, IconTv, MarketBadge } from './icons';
import { cx, formatStartTime } from './utils';

const OUTCOMES = [
  ['home', '1'],
  ['draw', 'X'],
  ['away', '2'],
];

/** Width of one 1/X/2 back-lay pair — shared with InPlayList's column header. */
export const PAIR_W = 'sm:w-[6.5rem]';

/**
 * MatchRow — one fixture in the lobby list: teams, start time / in-play, TV/BM/F marks, and the
 * 1 / X / 2 back-lay pairs (best price only).
 *
 * @param {object}   props
 * @param {object}   props.match
 * @param {string|number} props.match.id
 * @param {string}   props.match.home
 * @param {string}   props.match.away
 * @param {string|number|Date} [props.match.startTime]  ISO / epoch / Date / ready label.
 * @param {boolean}  [props.match.inPlay]
 * @param {string}   [props.match.score]                 Short live score ("142/3 (17.2)") shown instead of the time.
 * @param {boolean}  [props.match.hasTv] @param {boolean} [props.match.hasBookmaker] @param {boolean} [props.match.hasFancy]
 * @param {{home?:{back,lay}, draw?:{back,lay}|null, away?:{back,lay}}} [props.match.odds]
 *        Each side `{price,size}`. `draw: null` (tennis) → the X pair renders as locked "—".
 * @param {string}   [props.match.status]                Non-active → all pairs locked.
 * @param {string}   [props.to]                          Router path for the match page (rendered as <Link>).
 * @param {(match)=>void} [props.onOpen]                 Used when `to` is not given.
 * @param {(sel:{matchId, outcome:'home'|'draw'|'away', side:'back'|'lay', price, size})=>void} [props.onSelect]
 * @param {(t)=>string} [props.formatTime]
 * @param {(n)=>string} [props.formatSize]
 */
export default function MatchRow({ match, to, onOpen, onSelect, formatTime = formatStartTime, formatSize }) {
  const locked = match.status && !['ACTIVE', 'OPEN'].includes(String(match.status).toUpperCase());

  const head = (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-sm font-semibold text-primary">{match.home}</span>
      <span className="truncate text-sm font-semibold text-primary">{match.away}</span>
    </span>
  );

  const openCls = 'min-w-0 flex-1 text-left';
  const opener = to ? (
    <Link to={to} className={openCls}>
      {head}
    </Link>
  ) : (
    <button type="button" onClick={() => onOpen?.(match)} className={openCls}>
      {head}
    </button>
  );

  const meta = (
    <span className="flex flex-none items-center gap-1.5">
      {match.inPlay ? (
        <BetbyIcon name="ic-live" className="h-5 w-7 [&_svg]:size-full [&_svg]:fill-error" title="In-play" />
      ) : null}
      <span className={cx('text-xs', match.inPlay ? 'font-semibold text-brand' : 'text-tertiary')}>
        {match.inPlay ? (match.score ?? 'In-play') : formatTime(match.startTime)}
      </span>
      {match.hasTv && <IconTv className="size-4 fill-secondary" />}
      {match.hasBookmaker && <MarketBadge title="Bookmaker">BM</MarketBadge>}
      {match.hasFancy && <MarketBadge title="Fancy">F</MarketBadge>}
    </span>
  );

  const pairs = OUTCOMES.map(([key, label]) => {
    const o = match.odds?.[key];
    const pick = (side) =>
      onSelect ? (sel) => onSelect({ ...sel, side, matchId: match.id, outcome: key }) : undefined;
    return (
      <div key={key} className={cx('flex flex-col', PAIR_W)}>
        <span className="mb-1 text-center text-[0.6875rem] font-semibold text-tertiary sm:hidden">{label}</span>
        <div className="flex gap-0.5">
          <OddsCell
            cellSize="sm"
            side="back"
            price={o?.back?.price}
            size={o?.back?.size}
            suspended={locked || !o}
            formatSize={formatSize}
            onSelect={pick('back')}
            className="flex-1"
          />
          <OddsCell
            cellSize="sm"
            side="lay"
            price={o?.lay?.price}
            size={o?.lay?.size}
            suspended={locked || !o}
            formatSize={formatSize}
            onSelect={pick('lay')}
            className="flex-1"
          />
        </div>
      </div>
    );
  });

  return (
    <div className="flex flex-col gap-2 border-t border-third px-3 py-2.5 first:border-t-0 sm:flex-row sm:items-center sm:gap-3 sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {opener}
        {meta}
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-none sm:gap-1.5">{pairs}</div>
    </div>
  );
}
