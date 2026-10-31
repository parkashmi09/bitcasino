import { cx, formatAmount as defaultFormatAmount } from './utils';

/**
 * ExposureBadge — balance + exposure, compact enough for the header (two stacked lines in a
 * layer4 pill, the header's own surface). Exposure is shown as a negative number in red; 0 is muted.
 *
 * @param {object}   props
 * @param {number}   props.balance               Available balance.
 * @param {number}   [props.exposure=0]          Open liability (pass it positive or negative — it is shown as −|x|).
 * @param {string}   [props.currency]            Prefix, e.g. "₹".
 * @param {(n)=>string} [props.formatAmount]
 * @param {()=>void} [props.onClick]            Makes it a button (e.g. open the exposure list).
 * @param {boolean}  [props.loading]             Dashes instead of figures.
 * @param {string}   [props.className]
 * @param {string}   [props.balanceLabel='Bal']  Label before the balance figure.
 * @param {string}   [props.exposureLabel='Exp'] Label before the exposure figure.
 * @param {string}   [props.title]               Tooltip for the whole badge.
 * @param {boolean}  [props.hideBalance]         Exposure only (the sports pages show just the player's open exposure).
 */
export default function ExposureBadge({
  balance,
  exposure = 0,
  currency = '',
  formatAmount = defaultFormatAmount,
  onClick,
  loading = false,
  className = '',
  balanceLabel = 'Bal',
  exposureLabel = 'Exp',
  title,
  hideBalance = false,
}) {
  const exp = Math.abs(Number(exposure) || 0);
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      className={cx(
        'flex h-10 flex-col items-end justify-center rounded-lg bg-layer4 px-3 text-right leading-4',
        onClick && 'transition-colors hover:bg-layer5',
        className,
      )}
    >
      {!hideBalance && (
      <span className="whitespace-nowrap text-xs text-tertiary">
        {balanceLabel}{' '}
        <span className="font-extrabold text-primary">
          {loading ? '—' : `${currency}${formatAmount(balance)}`}
        </span>
      </span>
      )}
      <span className="whitespace-nowrap text-xs text-tertiary">
        {exposureLabel}{' '}
        <span className={cx('font-extrabold', exp > 0 ? 'text-error' : 'text-secondary')}>
          {loading ? '—' : `${exp > 0 ? '−' : ''}${currency}${formatAmount(exp)}`}
        </span>
      </span>
    </Tag>
  );
}
