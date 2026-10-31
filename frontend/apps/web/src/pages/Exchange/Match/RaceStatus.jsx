import React from 'react';
import { parseFeedIstTime } from '../../../utils/exchange/placeBetRules';
import { raceCountdownText } from './shape';

/**
 * The racecard's status strip (TENEXCH `banner scorecard-banner`, both racing sports): the first
 * market's own status word, verbatim (OPEN / SUSPENDED — no in-play override), and the countdown
 * to the off while the race is not in play.
 */
export default function RaceStatus({ status, stime, iplay }) {
  const startMs = stime ? parseFeedIstTime(stime) : null;
  const [now, setNow] = React.useState(() => Date.now());
  const counting = !iplay && startMs != null && startMs > now;
  React.useEffect(() => {
    if (!counting) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [counting]);
  const left = counting ? raceCountdownText(startMs, now) : null;
  if (!status && !left) return null;
  const open = /^(OPEN|ACTIVE)$/i.test(status || '');
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-layer3 px-3 py-2.5 sm:px-4">
      <span className={`text-sm font-extrabold uppercase ${open ? 'text-success' : 'text-error'}`}>{status}</span>
      {left && (
        <span className="text-sm font-semibold text-primary">
          {left} <span className="text-tertiary">Remaining</span>
        </span>
      )}
    </div>
  );
}
