import React from 'react';
import { cx, formatSize as defaultFormatSize, formatPrice as defaultFormatPrice } from './utils';
import { IconLock } from './icons';
import './exchange.css';

/**
 * OddsCell — one back or lay price button.
 *
 * @param {object}   props
 * @param {'back'|'lay'} props.side          Colour family. Fancy "Yes" = back, "No" = lay.
 * @param {number|string|null} props.price   Price (or fancy run line). Empty/0/null renders "—".
 * @param {number|string|null} [props.size]  Liquidity (or fancy rate). Printed small under the price.
 * @param {boolean}  [props.best=true]       Best level → full colour, dark ink; deeper levels → `*-muted` tint (a back/lay wash over layer4), light ink.
 * @param {boolean}  [props.suspended]       Locks the cell and prints "—" (no colour, no click).
 * @param {boolean}  [props.disabled]        Keeps the price visible but un-clickable (e.g. slip open elsewhere).
 * @param {boolean}  [props.selected]        Ring around the cell — the one the open slip is for.
 * @param {(n)=>string} [props.formatSize]   Size formatter, default K/L (1.5K, 2.5L).
 * @param {(n)=>string} [props.formatPrice]  Price formatter, default up to 2dp.
 * @param {boolean}  [props.flash=true]      Brief overlay wash when `price` changes (up = light, down = dark). No layout shift.
 * @param {(sel:{side:string, price:number, size:number})=>void} [props.onSelect]
 * @param {'sm'|'md'} [props.cellSize='md']  `md` = market rows, `sm` = lobby rows.
 * @param {string}   [props.className]       Extra classes for the width (e.g. `w-full`).
 * @param {string}   [props.ariaLabel]
 */
export default function OddsCell({
  side = 'back',
  price,
  size,
  best = true,
  suspended = false,
  disabled = false,
  selected = false,
  formatSize = defaultFormatSize,
  formatPrice = defaultFormatPrice,
  flash = true,
  onSelect,
  cellSize = 'md',
  className = '',
  ariaLabel,
}) {
  const ref = React.useRef(null);
  const prev = React.useRef(price);

  const priceNum = Number(price);
  const empty = price === null || price === undefined || price === '' || !(priceNum > 0);
  const locked = suspended || empty;
  const clickable = !locked && !disabled && Boolean(onSelect);

  /* The flash is a DOM class toggle, not state: a price tick must not re-render the row twice,
     and the animation restarts on every change even when two ticks land inside 600ms. */
  React.useEffect(() => {
    const before = Number(prev.current);
    prev.current = price;
    const el = ref.current;
    if (!flash || !el || !(before > 0) || !(priceNum > 0) || before === priceNum) return undefined;
    el.classList.remove('is-flash-up', 'is-flash-down');
    void el.offsetWidth;
    el.classList.add(priceNum > before ? 'is-flash-up' : 'is-flash-down');
    const t = setTimeout(() => el.classList.remove('is-flash-up', 'is-flash-down'), 650);
    return () => clearTimeout(t);
  }, [price, priceNum, flash]);

  const tone = locked
    ? 'bg-layer5 text-tertiary'
    : side === 'back'
      ? cx(best ? 'bg-back text-alw_dark' : 'bg-back-muted text-primary', clickable && 'hover:bg-back-hover hover:text-alw_dark')
      : cx(best ? 'bg-lay text-alw_dark' : 'bg-lay-muted text-primary', clickable && 'hover:bg-lay-hover hover:text-alw_dark');

  const sizeText = !locked && size != null && size !== '' ? formatSize(size) : '';

  return (
    <button
      ref={ref}
      type="button"
      disabled={locked || disabled}
      aria-disabled={!clickable || undefined}
      aria-label={ariaLabel ?? (locked ? `${side} unavailable` : `${side} ${formatPrice(price)}`)}
      aria-pressed={selected || undefined}
      onClick={clickable ? () => onSelect({ side, price: priceNum, size: Number(size) || 0 }) : undefined}
      className={cx(
        'exch-odds flex flex-col items-center justify-center rounded-md leading-none transition-colors',
        cellSize === 'sm' ? 'h-9 min-w-0' : 'h-11 min-w-0 sm:h-12',
        tone,
        clickable ? 'cursor-pointer' : 'cursor-default',
        disabled && !locked && 'is-disabled',
        selected && 'ring-2 ring-primary ring-inset',
        className,
      )}
    >
      {/* A side with no price is a dark box with a lock (TENEXCH `suspended no-val`); the rest of
          the row stays live. A whole suspended row keeps "—" under its own overlay; lobby cells
          (`sm`) keep "—" for an absent price (the draw of a two-way match). */}
      {empty && !suspended && cellSize !== 'sm' ? (
        <IconLock className="size-4 fill-tertiary" aria-hidden="true" />
      ) : (
        <span className={cx('font-extrabold', cellSize === 'sm' ? 'text-[0.8125rem]' : 'text-sm sm:text-base')}>
          {locked ? '—' : formatPrice(price)}
        </span>
      )}
      {/* Rendered (invisibly) whenever the market carries sizes, so a cell whose size blinks
          out keeps its text position; `size={null}` (bookmaker style) drops the line. A locked
          cell drops it too, so its "—" sits in the vertical centre. */}
      {size !== null && !locked && (
      <span
        className={cx(
          'mt-0.5 font-semibold opacity-80',
          cellSize === 'sm' ? 'text-[0.625rem]' : 'text-[0.6875rem]',
          !sizeText && 'invisible',
        )}
      >
        {sizeText || '0'}
      </span>
      )}
    </button>
  );
}
