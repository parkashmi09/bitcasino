import { cx, compactAmount, formatAmount as defaultFormatAmount } from './utils';
import { IconArrow } from './icons';

/**
 * MarketHeader — the title bar of a market block.
 *
 * @param {object}   props
 * @param {React.ReactNode} props.name        Market name ("Match Odds", "Bookmaker", "Fancy").
 * @param {number}   [props.min]              Min stake; omitted → no min/max line.
 * @param {number}   [props.max]              Max stake.
 * @param {(n)=>string} [props.formatAmount]  Formatter for min/max (default: Indian compact, 100 · 25K · 1L — as TENEXCH).
 * @param {React.ReactNode} [props.cashout]   Slot on the right, before the chevron — pass a <button> (e.g. the wiring layer's Cashout).
 * @param {React.ReactNode} [props.badge]     Slot right after the name (e.g. "In-play", "0% commission").
 * @param {boolean}  [props.collapsed]        Chevron points right when true.
 * @param {()=>void} [props.onToggle]         Omit to hide the chevron (block cannot collapse).
 */
export default function MarketHeader({
  name,
  min,
  max,
  formatAmount = compactAmount,
  cashout,
  badge,
  collapsed = false,
  onToggle,
}) {
  const fmt = (n) => formatAmount(n);
  // TENEXCH prints a Min only when the market quotes one ("Max: 50K" on Match Odds, "Min:100 Max:1L" on Bookmaker).
  const showMin = Number(min) > 0;
  const hasLimits = showMin || max != null;

  return (
    <div className="flex min-h-12 items-center gap-2 px-3 sm:px-4">
      <button
        type="button"
        onClick={onToggle}
        disabled={!onToggle}
        aria-expanded={onToggle ? !collapsed : undefined}
        className="flex min-w-0 flex-1 flex-col items-start py-2 text-left disabled:cursor-default"
      >
        <span className="flex min-w-0 max-w-full items-center gap-2">
          <span className="truncate text-sm font-extrabold text-primary sm:text-base">{name}</span>
          {badge}
        </span>
        {hasLimits && (
          <span className="mt-0.5 text-xs text-tertiary">
            {/* TENEXCH's own spacing: "Min:100 Max:1L" with a min, "Max: 10K" alone. */}
            {showMin ? (
              <>
                Min:<span className="text-secondary">{fmt(min)}</span>
                {max != null && (
                  <>
                    {' '}Max:<span className="text-secondary">{fmt(max)}</span>
                  </>
                )}
              </>
            ) : (
              <>
                Max: <span className="text-secondary">{fmt(max)}</span>
              </>
            )}
          </span>
        )}
      </button>

      {cashout}

      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand market' : 'Collapse market'}
          className="flex size-8 flex-none items-center justify-center rounded-md transition-colors hover:bg-layer4"
        >
          <IconArrow
            className={cx(
              'size-4 fill-secondary transition-transform',
              collapsed ? 'rotate-180' : '-rotate-90',
            )}
          />
        </button>
      )}
    </div>
  );
}

/**
 * CashoutButton — the slot filler for MarketHeader's `cashout`. A small `button-second`.
 *
 * @param {object} props
 * @param {number|null} [props.value]   Cashout amount; shown after the label, green/red by sign.
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.loading]
 * @param {(n)=>string} [props.formatAmount]
 * @param {()=>void} [props.onClick]
 */
export function CashoutButton({ value, disabled, loading, formatAmount = defaultFormatAmount, onClick }) {
  const n = Number(value);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className="button button-s button-brand h-8 flex-none gap-1 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span>Cashout</span>
      {/* On the brand fill a positive figure keeps the button's own ink; green on green is unreadable. */}
      {value != null && Number.isFinite(n) && (
        <span className={n < 0 ? 'text-error' : ''}>{formatAmount(n)}</span>
      )}
    </button>
  );
}
