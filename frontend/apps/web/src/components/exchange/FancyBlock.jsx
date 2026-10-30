import MarketCard from './MarketCard';
import RunnerRow from './RunnerRow';
import { limitsText as limits, statusLabel } from './utils';

const asIs = (v) => (v == null ? '' : String(v));

/**
 * FancyBlock — session/fancy markets: No (lay colour) | Yes (back colour), each cell a run LINE
 * (large) over a RATE (small, per 100).
 *
 * @param {object}   props
 * @param {string}   [props.title='Fancy']
 * @param {Array<{
 *   id, name,
 *   no:{line:number|null, rate:number|null},
 *   yes:{line:number|null, rate:number|null},
 *   min?:number, max?:number,
 *   status?:string,            // 'ACTIVE' | 'SUSPENDED' | 'BALL RUNNING' …
 *   pnl?:number|null, projected?:number|null
 * }>} props.rows
 * @param {string}   [props.status]              Whole-block status (overrides each row's).
 * @param {{rowId, side:'no'|'yes'}|null} [props.selected]
 * @param {(sel:{rowId, rowName, side:'no'|'yes', line:number, rate:number})=>void} [props.onSelect]
 * @param {(row)=>void} [props.onBook]           Click on the P&L line → run ladder ("book") for that row.
 * @param {string|number|null} [props.activeRowId]
 * @param {React.ReactNode} [props.betSlip]
 * @param {number}   [props.min] / [props.max]   Header min/max (block level).
 * @param {boolean}  [props.collapsed] @param {(b)=>void} [props.onToggleCollapse]
 * @param {boolean}  [props.disabled]
 * @param {(n)=>string} [props.formatAmount]
 * @param {(n)=>string} [props.formatLimit]   Each row's Min/Max (default: compact INR, 25K · 1L).
 */
export default function FancyBlock({
  title = 'Fancy',
  rows = [],
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
      columns={['No', 'Yes']}
      columnTones={['lay', 'back']}
      trailingHeader="Min / Max"
      formatAmount={formatAmount}
    >
      {rows.map((row) => {
        const sel = selected && selected.rowId === row.id ? selected : null;
        return (
          <RunnerRow
            key={row.id}
            name={row.name}
            order="lay-back"
            lay={[{ price: row.no?.line, size: row.no?.rate }]}
            back={[{ price: row.yes?.line, size: row.yes?.rate }]}
            status={blockLabel ?? row.status}
            disabled={disabled}
            pnl={row.pnl ?? null}
            projected={row.projected ?? null}
            formatSize={asIs}
            formatPrice={asIs}
            formatAmount={formatAmount}
            onPnlClick={onBook ? () => onBook(row) : undefined}
            selected={sel ? { side: sel.side === 'no' ? 'lay' : 'back' } : null}
            onSelect={
              onSelect
                ? ({ side, price, size }) =>
                    onSelect({
                      rowId: row.id,
                      rowName: row.name,
                      side: side === 'lay' ? 'no' : 'yes',
                      line: price,
                      rate: size,
                    })
                : undefined
            }
            subline={
              row.min != null || row.max != null ? (
                <p className="mt-0.5 text-[0.6875rem] leading-4 text-tertiary lg:hidden">
                  {limits(row.min, row.max, formatLimit)}
                </p>
              ) : null
            }
            trailing={
              <span className="text-xs leading-4 text-secondary">{limits(row.min, row.max, formatLimit)}</span>
            }
          >
            {activeRowId != null && activeRowId === row.id ? betSlip : null}
          </RunnerRow>
        );
      })}
    </MarketCard>
  );
}
