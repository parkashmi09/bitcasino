import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { useDebounced } from '@/hooks/useDebounced';
import { currencyMeta } from '@/data/currencies';
import { compareDecimal, formatBalance } from '@/lib/format';
import { useSwap, useSwapQuote } from '@/queries/wallet';
import { cn } from '@/lib/cn';

/**
 * Swap one wallet coin into another: quote, then confirm.
 *
 * `GET /user/swap/estimate` prices the typed amount (debounced, so it is not
 * a read per keystroke) and `POST /user/swap` places it. The amount is a
 * decimal STRING to the wire, and the over-balance check is `compareDecimal`,
 * never `Number()`. The server re-checks both and refuses with a code
 * (`SWAP_INSUFFICIENT_BALANCE`, `SWAP_CURRENCY_DISABLED`, …) whose message is
 * shown as sent.
 */
export function SwapPanel({ currency, coins, balances, onBack }) {
  const [from, setFrom] = useState(currency);
  const [to, setTo] = useState(() => coins.find((code) => code !== currency) ?? '');
  const [amount, setAmount] = useState('');
  const [done, setDone] = useState(null);
  const swap = useSwap();

  const typed = useDebounced(amount, 400);
  const quote = useSwapQuote(from, to, typed);
  const balance = balances[from] ?? '0';
  const overBalance = compareDecimal(amount || '0', balance) > 0;
  const fresh = typed === amount && quote.data;
  const ready = fresh && !overBalance && !swap.isPending;

  const confirm = async () => {
    try {
      setDone(await swap.mutateAsync({ from, to, amount }));
      setAmount('');
    } catch {
      // `swap.error` carries it; rendered below.
    }
  };

  return (
    <div className="grid gap-6">
      <BackBar onBack={onBack} title="Swap" />

      {done ? (
        <div className="grid justify-items-center gap-2 rounded-i-md border-[0.8px] border-beerus bg-goku px-6 py-10 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-roshi/15 text-roshi">
            <Icon name="check" size={28} />
          </span>
          <p className="text-sm font-medium text-bulma">Swap completed</p>
          <p className="text-xs leading-relaxed text-trunks">
            {done.fromAmount} {done.fromCurrency} → {done.toAmount} {done.toCurrency}
          </p>
          <button
            type="button"
            onClick={() => setDone(null)}
            className="mt-1 cursor-pointer rounded-i-sm bg-beerus px-3 py-1.5 text-xs font-medium text-bulma transition-colors hover:bg-trunks/20"
          >
            Swap again
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          <CoinSelect
            label="From"
            value={from}
            coins={coins}
            onChange={(code) => {
              setFrom(code);
              if (code === to) setTo(coins.find((other) => other !== code) ?? '');
            }}
          />

          <label className="grid gap-1.5">
            <span className="flex justify-between text-xs font-medium text-bulma">
              Amount
              <button
                type="button"
                onClick={() => setAmount(balance)}
                className="cursor-pointer text-trunks hover:text-bulma"
              >
                {formatBalance(balance, currencyMeta(from).decimals)} {from} available
              </button>
            </span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              className="h-11 w-full rounded-i-sm border-[0.8px] border-beerus bg-goku px-3 text-sm tabular-nums text-bulma outline-none focus:border-piccolo"
            />
            {overBalance && (
              <span role="alert" className="text-[11px] text-dodoria">
                That is more than your {from} balance.
              </span>
            )}
          </label>

          <CoinSelect
            label="To"
            value={to}
            coins={coins.filter((code) => code !== from)}
            onChange={setTo}
          />

          {quote.isError && (
            <p role="alert" className="rounded-i-sm bg-dodoria/10 px-3 py-2 text-xs text-bulma">
              {quote.error?.message || 'No quote for this pair.'}
            </p>
          )}

          {fresh && (
            <div className="grid gap-1 rounded-i-md border-[0.8px] border-beerus bg-goku px-4 py-3 text-sm">
              <span className="flex justify-between">
                <span className="text-trunks">You receive</span>
                <span className="font-semibold tabular-nums text-bulma">
                  {quote.data.converted} {to}
                </span>
              </span>
              <span className="flex justify-between text-xs">
                <span className="text-trunks">Fee</span>
                <span className="tabular-nums text-trunks">
                  {quote.data.feeAmount} {from}
                </span>
              </span>
            </div>
          )}

          {swap.isError && (
            <p role="alert" className="rounded-i-sm bg-dodoria/10 px-3 py-2 text-xs text-bulma">
              {swap.error?.message || 'The swap did not go through.'}
            </p>
          )}

          <button
            type="button"
            onClick={confirm}
            disabled={!ready}
            className="flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-i-sm bg-piccolo text-sm font-medium text-on-piccolo transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {swap.isPending ? 'Swapping…' : quote.isFetching ? 'Getting quote…' : 'Confirm swap'}
          </button>
        </div>
      )}
    </div>
  );
}

/** The back action and heading, in `WalletSettings`' shape. */
export function BackBar({ onBack, title }) {
  return (
    <div className="grid gap-6">
      <div>
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          data-testid="back_action"
          className="grid size-8 cursor-pointer place-items-center rounded-i-sm border-[0.8px] border-beerus bg-gohan text-bulma transition-colors hover:bg-heles"
        >
          <Icon name="chevron-left" size={18} className="rtl:-scale-x-100" />
        </button>
      </div>
      <p className="font-primary text-xl font-medium">{title}</p>
    </div>
  );
}

/** A coin `<select>`, styled as `WalletSettings`' fiat picker. */
export function CoinSelect({ label, value, coins, onChange }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-xs font-medium text-bulma">{label}</span>
      <span className="relative block w-full">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            'block h-11 w-full cursor-pointer appearance-none rounded-i-sm bg-goku px-3 text-sm text-bulma',
            'shadow-[inset_0_0_0_1px_var(--color-beerus)] outline-none focus:shadow-[inset_0_0_0_1px_var(--color-piccolo)]',
          )}
        >
          {coins.map((code) => (
            <option key={code} value={code}>
              {currencyMeta(code).name} ({code})
            </option>
          ))}
        </select>
        <Icon
          name="chevron-down"
          size={20}
          className="pointer-events-none absolute top-1/2 end-3 -translate-y-1/2 text-bulma"
        />
      </span>
    </label>
  );
}
