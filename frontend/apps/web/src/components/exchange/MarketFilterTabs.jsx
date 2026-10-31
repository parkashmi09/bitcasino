import { cx } from './utils';

/**
 * MarketFilterTabs — the match page's market filter ("All / Match Odds / Bookmaker / Fancy /
 * Line / Odd-Even"). The site's own tab strip — `.tabs-title` + `.tabs-btn` with
 * `aria-selected`, exactly as Home › Latest Bets draws it — scrolling sideways on phones.
 *
 * @param {object}   props
 * @param {Array<{id:string, label:string, count?:number}>} props.tabs
 * @param {string}   props.active
 * @param {(id:string)=>void} props.onChange
 * @param {string}   [props.className]
 */
export default function MarketFilterTabs({ tabs = [], active, onChange, className = '' }) {
  return (
    <div className={cx('tabs-title hide-scroll overflow-x-auto', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          className="tabs-btn flex-none px-3 sm:px-4"
          aria-selected={t.id === active ? 'true' : undefined}
          onClick={() => onChange?.(t.id)}
        >
          <span className="font-semibold">{t.label}</span>
          {t.count != null && <span className="ml-1 text-xs text-tertiary">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
