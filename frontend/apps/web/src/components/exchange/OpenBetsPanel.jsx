import { SkeletonBetRows } from './Skeletons';
import { cx, formatAmount as defaultFormatAmount, formatStartTime } from './utils';

const SIDE = { back: 'Back', lay: 'Lay', yes: 'Yes', no: 'No' };
const backish = (s) => s === 'back' || s === 'yes';

/**
 * OpenBetsPanel — the user's matched bets on this match. Only matched bets exist on this site
 * (no unmatched orders), so there is no Matched / Unmatched tab strip and no Cancel.
 *
 * Bet shape: `{ id, runnerName, marketName?, side:'back'|'lay'|'yes'|'no', price, stake,
 *               rate?, profit?, liability?, placedAt? }` — profit/liability optional (shown when given).
 *
 * @param {object}   props
 * @param {object[]} [props.matched]
 * @param {boolean}  [props.loading]                Skeleton rows in place of the list (first load only).
 * @param {string}   [props.currency]
 * @param {(n)=>string} [props.formatAmount]
 * @param {(t)=>string} [props.formatTime]
 * @param {number}   [props.exposure]             INR held in all open sports bets (not withdrawable).
 * @param {string}   [props.className]
 */
export default function OpenBetsPanel({
  matched = [],
  loading = false,
  currency = '',
  formatAmount = defaultFormatAmount,
  formatTime = formatStartTime,
  exposure = 0,
  className = '',
}) {
  const rows = matched;
  const money = (n) => `${currency}${formatAmount(n)}`;

  return (
    <section className={cx('rounded-xl bg-layer3 p-3', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-extrabold text-primary">Open Bets</h3>
        {exposure > 0 && (
          <span className="text-xs text-secondary">
            In bets <span className="font-semibold text-primary">{money(exposure)}</span>
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {loading ? (
          <SkeletonBetRows rows={2} compact />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-tertiary">No matched bets</p>
        ) : (
          rows.map((bet) => (
            <div key={bet.id} className="flex items-stretch gap-2 overflow-hidden rounded-lg bg-layer4">
              <span className={cx('w-1 flex-none', backish(bet.side) ? 'bg-back' : 'bg-lay')} />
              <div className="min-w-0 flex-1 py-2">
                <p className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={cx(
                      'flex-none rounded px-1 py-0.5 text-[0.625rem] font-extrabold uppercase leading-none text-alw_dark',
                      backish(bet.side) ? 'bg-back' : 'bg-lay',
                    )}
                  >
                    {SIDE[bet.side] ?? bet.side}
                  </span>
                  <span className="truncate text-sm font-semibold text-primary">{bet.runnerName}</span>
                </p>
                <p className="mt-0.5 truncate text-xs text-tertiary">
                  {bet.marketName}
                  {bet.placedAt ? ` · ${formatTime(bet.placedAt)}` : ''}
                </p>
              </div>
              <div className="flex-none py-2 text-right text-xs leading-5">
                <p className="text-secondary">
                  <span className="font-extrabold text-primary">{bet.price}</span>
                  {bet.rate != null && <span className="text-tertiary">@{bet.rate}</span>}
                  <span className="mx-1 text-tertiary">×</span>
                  <span className="font-semibold text-primary">{money(bet.stake)}</span>
                </p>
                {(bet.profit != null || bet.liability != null) && (
                  <p>
                    {bet.profit != null && <span className="text-success">+{formatAmount(bet.profit)}</span>}
                    {bet.liability != null && (
                      <span className="ml-1.5 text-error">{'−'}{formatAmount(bet.liability)}</span>
                    )}
                  </p>
                )}
              </div>
              <span className="w-1 flex-none" />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
