import { useCricketScore } from '../../hooks/exchange/useCricketScore';
import { cx } from './utils';

/* Live cricket scorecard, fed by the score socket (not an iframe). Content and rules are
   TENEXCH's CricketScorecard: two scores with bat/ball on the batting side, team names, CRR/RR,
   the status message, "Day n" for Tests only, and a chip per DELIVERED ball (the feed pads the
   over with blanks). Only `ww` is a wicket; a bare `w` is a wide. */
const BAT_ICON = '/exchange/bat-icon.png';
const BALL_ICON = '/exchange/ball-icon.png';

function ballTone(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'ww') return 'bg-error text-alw_white';
  if (s === '4') return 'bg-back text-alw_dark';
  if (s === '6') return 'bg-brand text-alw_dark';
  return 'bg-layer5 text-primary';
}

export default function CricketScorecard({ gmid, started = true }) {
  const data = useCricketScore(gmid, { enabled: Boolean(gmid) && started });
  if (!data) return null;

  const {
    spnnation1, spnnation2, score1, score2,
    spnrunrate1, spnrunrate2, spnreqrate1, spnreqrate2,
    spnmessage, activenation1, balls, dayno,
  } = data;
  const team1Batting = String(activenation1) === '1';
  const crr = spnrunrate1 || spnrunrate2 || '';
  const rr = spnreqrate1 || spnreqrate2 || '';
  const day = String(dayno ?? '').trim();
  const ballList = (Array.isArray(balls) ? balls : []).filter((b) => String(b ?? '').trim() !== '');

  const side = (name, score, batting, right) => (
    <div
      className={cx(
        'flex min-w-0 flex-1 flex-col gap-1 rounded-lg border px-3 py-2.5',
        right && 'items-end text-right',
        batting ? 'border-brand/40 bg-brand/10' : 'border-transparent bg-layer4/60',
      )}
    >
      <div className={cx('flex min-w-0 items-center gap-1.5', right && 'flex-row-reverse')}>
        <img src={batting ? BAT_ICON : BALL_ICON} alt="" className="size-4 flex-none" />
        <span className="truncate text-xs font-extrabold tracking-wide text-secondary uppercase">{name}</span>
        {batting && <span className="flex-none rounded bg-brand px-1.5 py-px text-[0.625rem] font-extrabold text-alw_dark">BAT</span>}
      </div>
      <span className={cx('text-xl leading-tight font-extrabold tabular-nums', batting ? 'text-primary' : 'text-secondary')}>{score || '-'}</span>
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5 bg-gradient-to-b from-layer3 to-layer2 px-3 py-3 text-sm sm:px-4">
      <div className="flex items-stretch gap-2">
        {side(spnnation1, score1, team1Batting, false)}
        <div className="flex flex-none flex-col items-center justify-center gap-1">
          <span className="text-[0.625rem] font-extrabold text-tertiary">VS</span>
          {crr !== '' && <span className="rounded bg-layer5 px-1.5 py-0.5 text-[0.625rem] font-bold whitespace-nowrap text-secondary tabular-nums">CRR {crr}</span>}
          {rr !== '' && <span className="rounded bg-layer5 px-1.5 py-0.5 text-[0.625rem] font-bold whitespace-nowrap text-secondary tabular-nums">RR {rr}</span>}
        </div>
        {side(spnnation2, score2, !team1Batting, true)}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-layer4/60 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {spnmessage ? <span className="min-w-0 truncate text-xs font-semibold text-brand">{spnmessage}</span> : null}
          {day !== '' && day !== '0' && (
            <span className="flex-none rounded bg-layer5 px-1.5 py-0.5 text-[0.625rem] font-bold text-tertiary">Day {day}</span>
          )}
        </div>
        {ballList.length > 0 && (
          <div className="flex flex-none items-center gap-1.5">
            <span className="text-[0.625rem] font-bold text-tertiary uppercase">This over</span>
            {ballList.map((b, i) => (
              <span key={i} className={cx('flex size-6 items-center justify-center rounded-full text-xs font-extrabold shadow-sm', ballTone(b))}>
                {b}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
