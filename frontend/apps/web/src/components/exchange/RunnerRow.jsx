import OddsCell from './OddsCell';
import { cx, formatBook, statusLabel } from './utils';
import './exchange.css';

const PnlButton = ({ className, ...rest }) => (
  <button type="button" className={`${className} cursor-pointer hover:underline`} {...rest} />
);

/** Cell column width — shared with the blocks' column headers so they line up. */
export const CELL_W = 'w-[4.25rem] sm:w-16';

/**
 * RunnerRow — one selection in a market: name + book line, then the price ladder.
 *
 * Price level shape everywhere in the kit: `{ price: number|null, size: number|null }`.
 * `back[0]` / `lay[0]` are the BEST prices; deeper levels follow. With `depth={3}` the row
 * shows back3 back2 back1 | lay1 lay2 lay3 (best prices meet in the middle); on phones
 * (< sm) only the best pair is shown whatever the depth.
 *
 * @param {object}   props
 * @param {React.ReactNode} props.name
 * @param {{price,size}[]} [props.back]       Best first.
 * @param {{price,size}[]} [props.lay]        Best first.
 * @param {1|3}      [props.depth=1]
 * @param {'back-lay'|'lay-back'} [props.order='back-lay']  `lay-back` = No|Yes (fancy / line markets).
 * @param {number|null} [props.pnl]           Current book for this runner (green +, red −). null → no line.
 * @param {number|null} [props.projected]     Book if the open slip were placed; shown after the current one.
 * @param {string|null} [props.status]        'ACTIVE' | 'SUSPENDED' | 'BALL RUNNING' | any feed word. Non-active → overlay with the word.
 * @param {boolean}  [props.suspended]        Force the overlay (e.g. whole market suspended) — label from `status` or "SUSPENDED".
 * @param {boolean}  [props.disabled]         Cells visible but not clickable.
 * @param {{side:'back'|'lay', level?:number}|null} [props.selected]  Ring on that cell (level 0 = best).
 * @param {(sel:{side, price, size, level})=>void} [props.onSelect]
 * @param {(n)=>string} [props.formatSize]
 * @param {(n)=>string} [props.formatPrice]
 * @param {(n)=>string} [props.formatAmount]  For the P&L line.
 * @param {boolean}  [props.showSize=true]    Hide sizes (bookmaker style).
 * @param {()=>void} [props.onPnlClick]       Makes the P&L line a button (open the book / run ladder).
 * @param {Array<{key, side:'back'|'lay', price, size}>} [props.cells]  Custom cell list instead of the back/lay ladder
 *        (e.g. Odd|Even, both back). Always all visible; `onSelect` gets `{ side, price, size, key }`;
 *        `selected` then matches on `{ key }`.
 * @param {React.ReactNode} [props.nameExtra] Inline after the name.
 * @param {React.ReactNode} [props.subline]   Extra small line under the name (e.g. fancy min/max on phones).
 * @param {React.ReactNode} [props.leading]   Before the name block (e.g. a racing runner's jockey silks).
 * @param {React.ReactNode} [props.trailing]  Column after the cells, desktop only (e.g. fancy min/max).
 * @param {React.ReactNode} [props.children]  Rendered full-width UNDER the row — put <BetSlipInline/> here.
 */
export default function RunnerRow({
  name,
  back = [],
  lay = [],
  depth = 1,
  order = 'back-lay',
  pnl = null,
  projected = null,
  status = null,
  suspended = false,
  disabled = false,
  selected = null,
  onSelect,
  formatSize,
  formatPrice,
  formatAmount,
  showSize = true,
  onPnlClick,
  cells: customCells,
  nameExtra,
  subline,
  leading,
  trailing,
  children,
}) {
  const label = statusLabel(status) ?? (suspended ? 'SUSPENDED' : null);
  const locked = Boolean(label);

  const levels = (arr) => Array.from({ length: depth }, (_, i) => arr[i] ?? { price: null, size: null });

  const cell = (side, lvl, i) => (
    <div key={`${side}${i}`} className={cx(CELL_W, 'flex-none', i > 0 && 'hidden sm:block')}>
      <OddsCell
        side={side}
        price={lvl.price}
        size={showSize ? lvl.size : null}
        best={i === 0}
        suspended={locked}
        disabled={disabled}
        selected={selected?.side === side && (selected.level ?? 0) === i}
        formatSize={formatSize}
        formatPrice={formatPrice}
        onSelect={onSelect ? (sel) => onSelect({ ...sel, level: i }) : undefined}
        className="w-full"
      />
    </div>
  );

  const backCells = levels(back).map((l, i) => cell('back', l, i));
  const layCells = levels(lay).map((l, i) => cell('lay', l, i));
  /* Best prices meet in the middle: the outer side is reversed. */
  const custom = customCells?.map((c) => (
    <div key={c.key} className={cx(CELL_W, 'flex-none')}>
      <OddsCell
        side={c.side}
        price={c.price}
        size={showSize ? c.size : null}
        suspended={locked}
        disabled={disabled}
        selected={selected?.key === c.key}
        formatSize={formatSize}
        formatPrice={formatPrice}
        onSelect={onSelect ? (sel) => onSelect({ ...sel, key: c.key }) : undefined}
        className="w-full"
      />
    </div>
  ));
  const cells = custom
    ? custom
    : order === 'back-lay'
      ? [...backCells.reverse(), ...layCells]
      : [...layCells.reverse(), ...backCells];

  const hasPnl = pnl != null;
  const hasProjected = projected != null;
  const PnlTag = onPnlClick ? PnlButton : 'p';
  const tone = (n) => (Number(n) < 0 ? 'text-error' : Number(n) > 0 ? 'text-success' : 'text-tertiary');
  /* TENEXCH book text: no "+", "-" on a loss; a caller's formatter (the player's coin) prints the size. */
  const book = (n) => (formatAmount ? `${Number(n) < 0 ? '-' : ''}${formatAmount(Math.abs(Number(n)))}` : formatBook(n));

  return (
    <div className="border-t border-third first:border-t-0">
      <div className="flex items-center gap-2 px-3 py-1.5 sm:px-4">
        {leading}
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-primary">{name}</span>
            {nameExtra}
          </p>
          {(hasPnl || hasProjected) && (
            <PnlTag
              onClick={onPnlClick}
              className="mt-0.5 flex items-center gap-1 text-xs font-semibold leading-4"
            >
              {hasPnl && <span className={tone(pnl)}>{book(pnl)}</span>}
              {hasProjected && (
                <>
                  {hasPnl && <span className="text-tertiary">»</span>}
                  <span className={tone(projected)}>{book(projected)}</span>
                </>
              )}
            </PnlTag>
          )}
          {subline}
        </div>

        <div className="relative flex flex-none gap-1">
          {cells}
          {locked && (
            <div className="exch-suspended absolute inset-0 z-[1] flex items-center justify-center rounded-md bg-layer3/85">
              <span className="text-xs font-extrabold uppercase tracking-wide text-error">{label}</span>
            </div>
          )}
        </div>

        {trailing && <div className="hidden w-24 flex-none text-right lg:block">{trailing}</div>}
      </div>
      {children}
    </div>
  );
}
