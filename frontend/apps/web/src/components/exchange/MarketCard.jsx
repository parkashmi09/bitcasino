import React from 'react';
import MarketHeader from './MarketHeader';
import { CELL_W } from './RunnerRow';
import { cx } from './utils';

/**
 * MarketCard — the shell every market block shares: a rounded layer3 card (the site's
 * `.sports-event` / Highlights card surface), the header, an optional column-header row and
 * the collapsible body. Exported for the wiring layer's own one-off market types.
 *
 * @param {object}   props
 * @param {React.ReactNode} props.name
 * @param {number}   [props.min]
 * @param {number}   [props.max]
 * @param {React.ReactNode} [props.cashout]
 * @param {React.ReactNode} [props.badge]
 * @param {boolean}  [props.collapsed]          Controlled; omit for internal state.
 * @param {(next:boolean)=>void} [props.onToggleCollapse]
 * @param {boolean}  [props.collapsible=true]
 * @param {string[]} [props.columns]            Labels over the price columns, left→right, e.g. ['Back','Lay'] or ['No','Yes'].
 * @param {1|3}      [props.depth=1]            Column-header width: with 3, labels sit over the best (inner) columns.
 * @param {('back'|'lay')[]} [props.columnTones] Tint for each label (back = blue text, lay = pink text).
 * @param {React.ReactNode} [props.trailingHeader] Header for RunnerRow's `trailing` column (desktop).
 * @param {(n)=>string} [props.formatAmount]
 * @param {React.ReactNode} props.children      The rows.
 */
export default function MarketCard({
  name,
  min,
  max,
  cashout,
  badge,
  collapsed,
  onToggleCollapse,
  collapsible = true,
  columns,
  depth = 1,
  columnTones,
  trailingHeader,
  formatAmount,
  children,
}) {
  const [ownCollapsed, setOwnCollapsed] = React.useState(false);
  const isCollapsed = collapsed ?? ownCollapsed;
  const toggle = () => {
    if (onToggleCollapse) onToggleCollapse(!isCollapsed);
    if (collapsed === undefined) setOwnCollapsed((v) => !v);
  };

  /* With depth 3 the two labels sit over the INNER (best) columns; the outer ones are blank. */
  const headerCells = () => {
    if (!columns?.length) return null;
    const [left, right] = columns;
    const [lt, rt] = columnTones ?? [];
    const blank = (k) => <span key={k} className={cx(CELL_W, 'hidden flex-none sm:block')} />;
    const lab = (text, tone, k) => (
      <span
        key={k}
        className={cx(
          CELL_W,
          'flex-none text-center text-xs font-extrabold',
          tone === 'back' ? 'text-back' : tone === 'lay' ? 'text-lay' : 'text-secondary',
        )}
      >
        {text}
      </span>
    );
    const out = [];
    if (depth === 3) out.push(blank('l2'), blank('l1'));
    out.push(lab(left, lt, 'l'));
    if (right != null) out.push(lab(right, rt, 'r'));
    if (depth === 3 && right != null) out.push(blank('r1'), blank('r2'));
    return out;
  };

  return (
    <section className="overflow-hidden rounded-xl bg-layer3">
      <MarketHeader
        name={name}
        min={min}
        max={max}
        cashout={cashout}
        badge={badge}
        collapsed={isCollapsed}
        onToggle={collapsible ? toggle : undefined}
        formatAmount={formatAmount}
      />
      {!isCollapsed && (
        <div className="pb-1.5">
          {columns?.length ? (
            <div className="flex items-center gap-2 border-t border-third px-3 py-1.5 sm:px-4">
              <span className="min-w-0 flex-1" />
              <div className="flex flex-none gap-1">{headerCells()}</div>
              {trailingHeader !== undefined && (
                <span className="hidden w-24 flex-none text-right text-xs font-semibold text-tertiary lg:block">
                  {trailingHeader}
                </span>
              )}
            </div>
          ) : null}
          {children}
        </div>
      )}
    </section>
  );
}
