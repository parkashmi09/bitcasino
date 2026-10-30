import MarketCard from './MarketCard';
import RunnerRow from './RunnerRow';
import { statusLabel } from './utils';

/**
 * MatchOddsBlock — Match Odds / Bookmaker / Tied Match (any back-lay runner market).
 *
 * @param {object}   props
 * @param {object}   props.market
 * @param {string|number} props.market.id
 * @param {string}   props.market.name                 "Match Odds", "Bookmaker", "Tied Match"…
 * @param {number}   [props.market.min]
 * @param {number}   [props.market.max]
 * @param {string}   [props.market.status]             Non-active → every runner shows the overlay with this word.
 * @param {Array<{id, name, back:{price,size}[], lay:{price,size}[], status?, pnl?, projected?}>} props.market.runners
 * @param {1|3}      [props.depth=1]                   1 = best price only; 3 = full 3×3 ladder (phones always show best only).
 * @param {boolean}  [props.showSize=true]             Bookmaker feeds often carry no liquidity — pass false.
 * @param {{runnerId, side:'back'|'lay', level?:number}|null} [props.selected]  The cell the open slip belongs to.
 * @param {(sel:{marketId, runnerId, runnerName, side, price, size, level})=>void} [props.onSelect]
 * @param {string|number|null} [props.activeRunnerId]  Render `betSlip` under this runner.
 * @param {React.ReactNode} [props.betSlip]            Usually <BetSlipInline/>.
 * @param {React.ReactNode} [props.cashout]            MarketHeader slot.
 * @param {React.ReactNode} [props.badge]              MarketHeader slot.
 * @param {boolean}  [props.collapsed]                 Controlled collapse; omit for internal.
 * @param {(next:boolean)=>void} [props.onToggleCollapse]
 * @param {boolean}  [props.disabled]                  All cells un-clickable (e.g. a bet is in flight).
 * @param {(n)=>string} [props.formatSize]
 * @param {(n)=>string} [props.formatPrice]
 * @param {(n)=>string} [props.formatAmount]
 */
export default function MatchOddsBlock({
  market,
  depth = 1,
  showSize = true,
  selected = null,
  onSelect,
  activeRunnerId = null,
  betSlip = null,
  cashout,
  badge,
  collapsed,
  onToggleCollapse,
  disabled = false,
  formatSize,
  formatPrice,
  formatAmount,
}) {
  const marketLabel = statusLabel(market?.status);

  return (
    <MarketCard
      name={market?.name}
      min={market?.min}
      max={market?.max}
      cashout={cashout}
      badge={badge}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
      columns={['Back', 'Lay']}
      columnTones={['back', 'lay']}
      depth={depth}
      formatAmount={formatAmount}
    >
      {(market?.runners ?? []).map((runner) => (
        <RunnerRow
          key={runner.id}
          name={runner.name}
          subline={runner.subline}
          leading={runner.leading}
          back={runner.back}
          lay={runner.lay}
          depth={depth}
          pnl={runner.pnl ?? null}
          projected={runner.projected ?? null}
          status={marketLabel ?? runner.status}
          disabled={disabled}
          showSize={showSize}
          selected={selected && selected.runnerId === runner.id ? selected : null}
          onSelect={
            onSelect
              ? (sel) => onSelect({ ...sel, marketId: market.id, runnerId: runner.id, runnerName: runner.name })
              : undefined
          }
          formatSize={formatSize}
          formatPrice={formatPrice}
          formatAmount={formatAmount}
        >
          {activeRunnerId != null && activeRunnerId === runner.id ? betSlip : null}
        </RunnerRow>
      ))}
    </MarketCard>
  );
}
