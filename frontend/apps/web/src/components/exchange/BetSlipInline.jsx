import React from 'react';
import {
  cx,
  formatAmount as defaultFormatAmount,
  stepPrice as defaultStepPrice,
  calcProfitLiability,
} from './utils';
import { IconMinus, IconPlus, IconInform } from './icons';
import './exchange.css';

const SIDE_LABEL = { back: 'Back', lay: 'Lay', yes: 'Yes', no: 'No' };

/**
 * BetSlipInline — the slip that opens UNDER the clicked runner (pass it as a block's `betSlip`).
 * Fully controlled: the parent owns price/stake and does the placing.
 *
 * @param {object}   props
 * @param {'back'|'lay'|'yes'|'no'} props.side      yes = back colour, no = lay colour.
 * @param {React.ReactNode} [props.runnerName]
 * @param {React.ReactNode} [props.marketName]
 * @param {number|string} props.price               Odds (or fancy run line).
 * @param {(next:number|string)=>void} [props.onPriceChange]  Typed text (string) or a stepped number.
 * @param {boolean}  [props.priceEditable=true]     false → read-only price, no stepper (fancy / bookmaker).
 * @param {(price:number, dir:1|-1)=>number} [props.stepPrice]  Default: Betfair ladder.
 * @param {number}   [props.rate]                   Fancy rate (per 100) — shown beside the line; used for P&L when `isLine`.
 * @param {boolean}  [props.isLine]                 Fancy/line maths for the default profit/liability.
 * @param {number|string} props.stake
 * @param {(next:string)=>void} props.onStakeChange
 * @param {number[]} [props.quickStakes]            Chip values (from the user's stake buttons).
 * @param {'set'|'add'} [props.quickStakeMode='set']
 * @param {number|null} [props.profit]              Override the computed profit.
 * @param {number|null} [props.liability]           Override the computed liability.
 * @param {number}   [props.minStake] @param {number} [props.maxStake]
 * @param {string}   [props.currency]               Symbol/prefix for amounts ("₹").
 * @param {(n)=>string} [props.formatAmount]
 * @param {boolean}  [props.loading]                Server bet delay in progress: inputs lock, Place shows a spinner.
 * @param {number}   [props.delaySeconds]           Length of the delay → countdown bar + "Placing… Ns".
 * @param {string|null} [props.error]               Inline error under the inputs.
 * @param {boolean}  [props.placeDisabled]          Extra gate on Place Bet (it is already disabled with no stake / loading).
 * @param {()=>void} props.onCancel  @param {()=>void} [props.onClear]  @param {()=>void} props.onPlace
 */
export default function BetSlipInline({
  side = 'back',
  runnerName,
  marketName,
  price,
  onPriceChange,
  priceEditable = true,
  stepPrice = defaultStepPrice,
  rate,
  isLine = false,
  stake,
  onStakeChange,
  quickStakes = [100, 500, 1000, 5000, 10000, 25000],
  quickStakeMode = 'set',
  profit,
  liability,
  minStake,
  maxStake,
  currency = '',
  formatAmount = defaultFormatAmount,
  loading = false,
  delaySeconds,
  error = null,
  placeDisabled = false,
  onCancel,
  onClear,
  onPlace,
}) {
  const isBackish = side === 'back' || side === 'yes';
  const stakeNum = Number(stake) || 0;

  const computed = calcProfitLiability({ side, price, stake: stakeNum, rate, isLine });
  const shownProfit = profit ?? computed.profit;
  const shownLiability = liability ?? computed.liability;

  /* Countdown for the bet-delay readout. Started off the `loading` edge, ticking once a second;
     a DOM-free interval that only ever writes the seconds left. */
  const [left, setLeft] = React.useState(null);
  React.useEffect(() => {
    if (!loading || !delaySeconds) return undefined;
    const started = Date.now();
    const tick = () => setLeft(Math.max(0, Math.ceil(delaySeconds - (Date.now() - started) / 1000)));
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(id);
      setLeft(null);
    };
  }, [loading, delaySeconds]);

  const step = (dir) => {
    if (!onPriceChange || loading) return;
    onPriceChange(stepPrice(Number(price) || 1.01, dir));
  };

  const pickStake = (v) => {
    if (loading) return;
    onStakeChange?.(String(quickStakeMode === 'add' ? stakeNum + v : v));
  };

  const money = (n) => `${currency}${formatAmount(n)}`;
  const chip = (v) => (v >= 1000 && v % 1000 === 0 ? `${v / 1000}K` : String(v));

  return (
    <div className="px-3 pb-2 sm:px-4">
      <div className="overflow-hidden rounded-lg bg-layer4">
        <div className={cx('h-1', isBackish ? 'bg-back' : 'bg-lay')} />
        <div className="p-3">
          {/* Who / what, and the money readout. */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2">
                <span
                  className={cx(
                    'flex-none rounded px-1.5 py-0.5 text-[0.625rem] font-extrabold uppercase leading-none text-alw_dark',
                    isBackish ? 'bg-back' : 'bg-lay',
                  )}
                >
                  {SIDE_LABEL[side] ?? side}
                </span>
                <span className="truncate text-sm font-semibold text-primary">{runnerName}</span>
              </p>
              {marketName && <p className="mt-1 truncate text-xs text-tertiary">{marketName}</p>}
            </div>
            <div className="flex-none text-right text-xs leading-5">
              <p className="text-tertiary">
                Profit <span className="font-extrabold text-success">{money(shownProfit)}</span>
              </p>
              <p className="text-tertiary">
                Liability <span className="font-extrabold text-error">{money(shownLiability)}</span>
              </p>
            </div>
          </div>

          {/* Odds + stake. The site's `.input` box; the stepper buttons sit inside it. */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <p className="mb-1 px-1 text-xs text-secondary">{isLine ? 'Runs' : 'Odds'}</p>
              <div className={cx('input !h-10 !px-1', loading && 'opacity-60')} data-disabled={loading || undefined}>
                {priceEditable && (
                  <button
                    type="button"
                    aria-label="Lower odds"
                    onClick={() => step(-1)}
                    disabled={loading}
                    className="flex size-8 flex-none items-center justify-center rounded-md bg-layer5 hover:bg-layer6"
                  >
                    <IconMinus className="size-4 fill-secondary" />
                  </button>
                )}
                <input
                  className="exch-num min-w-0 text-center text-sm font-extrabold"
                  inputMode="decimal"
                  value={price ?? ''}
                  readOnly={!priceEditable || loading}
                  onChange={(e) => onPriceChange?.(e.target.value.replace(/[^\d.]/g, ''))}
                  aria-label="Odds"
                />
                {isLine && rate != null && (
                  <span className="flex-none pr-1 text-xs text-tertiary">@{rate}</span>
                )}
                {priceEditable && (
                  <button
                    type="button"
                    aria-label="Raise odds"
                    onClick={() => step(1)}
                    disabled={loading}
                    className="flex size-8 flex-none items-center justify-center rounded-md bg-layer5 hover:bg-layer6"
                  >
                    <IconPlus className="size-4 fill-secondary" />
                  </button>
                )}
              </div>
            </div>
            <div>
              <p className="mb-1 flex justify-between px-1 text-xs text-secondary">
                <span>Stake</span>
                {(minStake != null || maxStake != null) && (
                  <span className="truncate text-tertiary">
                    {Number(minStake ?? 0).toLocaleString('en-US')}–{Number(maxStake ?? 0).toLocaleString('en-US')}
                  </span>
                )}
              </p>
              <div className={cx('input !h-10', loading && 'opacity-60')} data-disabled={loading || undefined}>
                {currency && <span className="flex-none text-sm text-tertiary">{currency}</span>}
                <input
                  className="exch-num min-w-0 text-sm font-extrabold"
                  inputMode="decimal"
                  placeholder="0"
                  value={stake ?? ''}
                  readOnly={loading}
                  onChange={(e) => onStakeChange?.(e.target.value.replace(/[^\d.]/g, ''))}
                  aria-label="Stake"
                />
              </div>
            </div>
          </div>

          {/* Quick stakes. */}
          {quickStakes?.length > 0 && (
            <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
              {quickStakes.map((v) => (
                <button
                  key={v}
                  type="button"
                  disabled={loading}
                  onClick={() => pickStake(v)}
                  className={cx(
                    'button button-xs h-8 rounded-md bg-layer5 text-xs font-semibold text-secondary transition-colors hover:bg-layer6 hover:text-primary disabled:opacity-50',
                    stakeNum === v && 'text-primary ring-1 ring-brand ring-inset',
                  )}
                >
                  {quickStakeMode === 'add' ? `+${chip(v)}` : chip(v)}
                </button>
              ))}
            </div>
          )}

          {error && (
            <p role="alert" className="mt-2 flex items-start gap-1.5 rounded-md bg-error/10 px-2 py-1.5 text-xs leading-4 text-error">
              <IconInform className="mt-px size-3.5 flex-none fill-error" />
              <span>{error}</span>
            </p>
          )}

          {/* Actions. Place Bet is the site's brand button. */}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="button button-second h-10 flex-1 rounded-lg text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            {onClear && (
              <button
                type="button"
                onClick={onClear}
                disabled={loading}
                className="button button-second h-10 flex-1 rounded-lg text-sm disabled:opacity-50"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={onPlace}
              disabled={loading || placeDisabled || !(stakeNum > 0)}
              className="button button-brand relative h-10 flex-[1.6] gap-2 overflow-hidden rounded-lg text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading && (
                <span className="exch-spin size-4 flex-none rounded-full border-2 border-black/25 border-t-black" />
              )}
              <span>
                {loading ? `Placing…${left != null ? ` ${left}s` : ''}` : 'Place Bet'}
              </span>
              {loading && delaySeconds ? (
                <span
                  className="exch-delay-bar absolute bottom-0 left-0 h-0.5 w-full bg-black/40"
                  style={{ animationDuration: `${delaySeconds}s` }}
                />
              ) : null}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
