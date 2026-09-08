import { useEffect, useState } from 'react';

/**
 * Time left until `target`, recomputed every second.
 *
 * Returns `{ days, hours, minutes, seconds, done }` with each part already
 * clamped at zero and zero-padded to two digits, because every caller renders
 * them as `05` rather than `5` and none of them wants a negative hour.
 *
 * The interval is cleared once the clock reaches zero rather than left running
 * against a target in the past. A finished tournament card is `00/00:00:00`
 * forever, and a rail of fifty of them ticking in unison for no reason is
 * fifty timers and a re-render a second.
 *
 * `target` is read as a dependency, so a card whose end time changes — the
 * adapter re-fetching, say — restarts the clock rather than counting to the
 * old one.
 */
const pad = (n) => String(Math.max(0, Math.floor(n))).padStart(2, '0');

function partsFor(target) {
  const left = new Date(target).getTime() - Date.now();
  if (!Number.isFinite(left) || left <= 0) {
    return { days: '00', hours: '00', minutes: '00', seconds: '00', done: true };
  }

  const seconds = left / 1000;
  return {
    days: pad(seconds / 86400),
    hours: pad((seconds / 3600) % 24),
    minutes: pad((seconds / 60) % 60),
    seconds: pad(seconds % 60),
    done: false,
  };
}

export function useCountdown(target) {
  const [parts, setParts] = useState(() => partsFor(target));

  useEffect(() => {
    // Re-seed on a target change: the state initialiser only runs on mount, so
    // without this the first second after a change shows the old remainder.
    const next = partsFor(target);
    setParts(next);
    if (next.done) return undefined;

    const id = setInterval(() => {
      const tick = partsFor(target);
      setParts(tick);
      if (tick.done) clearInterval(id);
    }, 1000);

    return () => clearInterval(id);
  }, [target]);

  return parts;
}
