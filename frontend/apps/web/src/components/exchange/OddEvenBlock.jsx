import MarketCard from './MarketCard';
import RunnerRow from './RunnerRow';
import { limitsText, statusLabel } from './utils';

/**
 * OddEvenBlock — Odd | Even markets (both columns are BACK prices).
 *
 * @param {object}   props
 * @param {string}   [props.title='Odd / Even']
 * @param {Array<{id, name, odd:{price,size}, even:{price,size}, min?, max?, status?, pnl?, projected?}>} props.rows
 * @param {(n)=>string} [props.formatLimit]  Each row's Min/Max (default: compact INR, 10 · 1L).
 * @param {string}   [props.status]                     Block-wide status (overrides rows).
 * @param {{rowId, pick:'odd'|'even'}|null} [props.selected]
 * @param {(sel:{rowId, rowName, pick:'odd'|'even', side:'back', price, size})=>void} [props.onSelect]
 * @param {string|number|null} [props.activeRowId]
 * @param {React.ReactNode} [props.betSlip]
 * @param {number}   [props.min] @param {number} [props.max]
 * @param {boolean}  [props.collapsed] @param {(b)=>void} [props.onToggleCollapse]
 * @param {boolean}  [props.disabled]
 * @param {(n)=>string} [props.formatSize] @param {(n)=>string} [props.formatPrice] @param {(n)=>string} [props.formatAmount]
 */
export default function OddEvenBlock({
  title = 'Odd / Even',
  rows = [],
  status,
  selected = null,
  onSelect,
  activeRowId = null,
  betSlip = null,
  min,
  max,
  collapsed,
  onToggleCollapse,
  disabled = false,
  formatSize,
  formatPrice,
  formatAmount,
  formatLimit,
}) {
  const blockLabel = statusLabel(status);

  return (
    <MarketCard
      name={title}
      min={min}
      max={max}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      columns={['Odd', 'Even']}
      columnTones={['back', 'back']}
      trailingHeader={rows.some((r) => r.min != null || r.max != null) ? 'Min / Max' : undefined}
      formatAmount={formatAmount}
    >
      {rows.map((row) => {
        const lim = row.min != null || row.max != null ? limitsText(row.min, row.max, formatLimit) : null;
        return (
        <RunnerRow
          key={row.id}
          name={row.name}
          subline={lim ? <p className="mt-0.5 text-[0.6875rem] leading-4 text-tertiary lg:hidden">{lim}</p> : undefined}
          trailing={lim ? <span className="text-xs leading-4 text-secondary">{lim}</span> : undefined}
          status={blockLabel ?? row.status}
          disabled={disabled}
          pnl={row.pnl ?? null}
          projected={row.projected ?? null}
          cells={[
            { key: 'odd', side: 'back', price: row.odd?.price, size: row.odd?.size },
            { key: 'even', side: 'back', price: row.even?.price, size: row.even?.size },
          ]}
          selected={selected && selected.rowId === row.id ? { key: selected.pick } : null}
          onSelect={
            onSelect
              ? ({ key, price, size }) =>
                  onSelect({ rowId: row.id, rowName: row.name, pick: key, side: 'back', price, size })
              : undefined
          }
          formatSize={formatSize}
          formatPrice={formatPrice}
          formatAmount={formatAmount}
        >
          {activeRowId != null && activeRowId === row.id ? betSlip : null}
        </RunnerRow>
        );
      })}
    </MarketCard>
  );
}
