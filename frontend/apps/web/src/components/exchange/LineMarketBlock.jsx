import MarketCard from './MarketCard';
import RunnerRow from './RunnerRow';
import { statusLabel } from './utils';

/**
 * LineMarketBlock — line markets (e.g. "Total runs 20 overs"): No (lay) | Yes (back), best-only
 * or a 3-deep ladder per side, with the line printed as the price and liquidity as the size.
 *
 * @param {object}   props
 * @param {string}   [props.title='Line Market']
 * @param {Array<{id, name, no:{price,size}[], yes:{price,size}[], status?, pnl?, projected?}>} props.rows
 *        `no[0]` / `yes[0]` are the best levels.
 * @param {1|3}      [props.depth=1]
 * @param {string}   [props.status]
 * @param {{rowId, side:'no'|'yes', level?:number}|null} [props.selected]
 * @param {(sel:{rowId, rowName, side:'no'|'yes', price, size, level})=>void} [props.onSelect]
 * @param {(row)=>void} [props.onBook]     P&L line click → book / ladder.
 * @param {string|number|null} [props.activeRowId]
 * @param {React.ReactNode} [props.betSlip]
 * @param {number}   [props.min] @param {number} [props.max]
 * @param {boolean}  [props.collapsed] @param {(b)=>void} [props.onToggleCollapse]
 * @param {boolean}  [props.disabled]
 * @param {(n)=>string} [props.formatSize] @param {(n)=>string} [props.formatPrice] @param {(n)=>string} [props.formatAmount]
 */
export default function LineMarketBlock({
  title = 'Line Market',
  rows = [],
  depth = 1,
  status,
  selected = null,
  onSelect,
  onBook,
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
}) {
  const blockLabel = statusLabel(status);

  return (
    <MarketCard
      name={title}
      min={min}
      max={max}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      columns={['No', 'Yes']}
      columnTones={['lay', 'back']}
      depth={depth}
      formatAmount={formatAmount}
    >
      {rows.map((row) => {
        const sel = selected && selected.rowId === row.id ? selected : null;
        return (
          <RunnerRow
            key={row.id}
            name={row.name}
            order="lay-back"
            depth={depth}
            lay={row.no}
            back={row.yes}
            status={blockLabel ?? row.status}
            disabled={disabled}
            pnl={row.pnl ?? null}
            projected={row.projected ?? null}
            onPnlClick={onBook ? () => onBook(row) : undefined}
            selected={sel ? { side: sel.side === 'no' ? 'lay' : 'back', level: sel.level ?? 0 } : null}
            onSelect={
              onSelect
                ? ({ side, price, size, level }) =>
                    onSelect({
                      rowId: row.id,
                      rowName: row.name,
                      side: side === 'lay' ? 'no' : 'yes',
                      price,
                      size,
                      level,
                    })
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
