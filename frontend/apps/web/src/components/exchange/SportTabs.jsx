import { useEffect, useRef } from 'react';
import { SportIcon } from './icons';
import { cx } from './utils';

/**
 * SportTabs — the lobby's sport pills (Cricket / Football / Tennis …), the sports lobby's own
 * pill style (`.sports-tab` in pages/Sports/Sports.css) with BetBy's sport art.
 *
 * @param {object}   props
 * @param {Array<{id:string, label:string, icon?:string, fallback?:boolean, count?:number}>} props.sports
 *        `icon` is the sport-art key: 'cricket' | 'soccer' | 'tennis' | 'basketball' … (src/assets/sports/sport-<key>.svg).
 *        Defaults to `id`. `fallback` draws SportIcon's generic glyph when the key has no art, so a
 *        feed-driven pill is never blank (a pill without it, e.g. In-Play, stays text-only).
 *
 * One row, never wrapped: it scrolls sideways when the pills overflow (swipe on touch, the mouse
 * wheel on desktop), and the active pill is scrolled into view whenever it changes.
 * @param {string}   props.active
 * @param {(id:string)=>void} props.onChange
 * @param {string}   [props.className]
 */
export default function SportTabs({ sports = [], active, onChange, className = '' }) {
  const rowRef = useRef(null);
  const ids = sports.map((s) => s.id).join('|');

  /* Keep the active pill in view — horizontally only, by moving the row's own scrollLeft, so the
     page itself never jumps. Re-run when the pill set changes (the feed adds sports later). */
  useEffect(() => {
    const row = rowRef.current;
    const pill = row?.querySelector('[aria-selected="true"]');
    if (!row || !pill) return;
    const left = pill.offsetLeft; // the row is `relative`, so this is the pill's x inside it
    const right = left + pill.offsetWidth;
    if (left < row.scrollLeft) row.scrollLeft = Math.max(0, left - 16);
    else if (right > row.scrollLeft + row.clientWidth) row.scrollLeft = right - row.clientWidth + 16;
  }, [active, ids]);

  /* A vertical wheel scrolls the row sideways while it overflows (desktop has no swipe). */
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const onWheel = (e) => {
      if (row.scrollWidth <= row.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = row.scrollWidth - row.clientWidth;
      const next = Math.min(max, Math.max(0, row.scrollLeft + e.deltaY));
      if (next === row.scrollLeft) return;
      e.preventDefault();
      row.scrollLeft = next;
    };
    row.addEventListener('wheel', onWheel, { passive: false });
    return () => row.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <div
      ref={rowRef}
      role="tablist"
      className={cx('hide-scroll relative flex flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain sm:gap-3', className)}
    >
      {sports.map((s) => {
        const on = s.id === active;
        return (
          <button
            key={s.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange?.(s.id)}
            className={cx(
              'flex h-9 flex-none items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-semibold transition-colors',
              on ? 'bg-layer5 text-primary' : 'bg-layer3 text-secondary hover:bg-layer4',
            )}
          >
            <SportIcon sport={s.icon ?? s.id} fallback={Boolean(s.fallback)} className="size-[1.125rem] flex-none [&_svg]:size-full [&_svg]:fill-current" />
            <span>{s.label}</span>
            {s.count != null && (
              <span
                className={cx(
                  'rounded-full px-1.5 text-[0.6875rem] font-extrabold leading-4',
                  on ? 'bg-button-brand text-alw_dark' : 'bg-layer5 text-secondary',
                )}
              >
                {s.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
