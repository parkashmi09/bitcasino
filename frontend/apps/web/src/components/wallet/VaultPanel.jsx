import { useState } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { currencyMeta } from '@/data/currencies';
import { compareDecimal, formatBalance } from '@/lib/format';
import { useVault, useVaultTerms, useVaultTransfer } from '@/queries/wallet';
import { BackBar, CoinSelect } from './SwapPanel';

/**
 * The vault: a FIXED-TERM deposit, not an instant pocket.
 *
 * In: pick a term off `GET /user/vault/lock-options` (`rate` is an annual
 * percentage) and `POST /user/vault/transfer-in {coin, amount, lockPeriod}`.
 * Out: each open deposit from `GET /user/vault` returns to the wallet once its
 * term ends (`POST /user/vault/transfer-out {coin, depositId}`); a locked one
 * shows when it unlocks. Early exit is not offered here.
 */
export function VaultPanel({ currency, coins, balances, onBack }) {
  const vault = useVault();
  const terms = useVaultTerms();
  const transfer = useVaultTransfer();
  const [coin, setCoin] = useState(currency);
  const [term, setTerm] = useState('');
  const [amount, setAmount] = useState('');

  const options = terms.data ?? [];
  const lockPeriod = term || options[0]?.value || '';
  const balance = balances[coin] ?? '0';
  const overBalance = compareDecimal(amount || '0', balance) > 0;
  const ready = lockPeriod && /[1-9]/.test(amount) && !overBalance && !transfer.isPending;
  const deposits = vault.data?.deposits ?? [];
  const totals = Object.entries(vault.data?.totals ?? {});

  const send = (body) => transfer.mutate(body, { onSuccess: () => setAmount('') });

  return (
    <div className="grid gap-6">
      <BackBar onBack={onBack} title="Vault" />

      {vault.isPending ? (
        <Skeleton className="h-16 rounded-i-md" />
      ) : (
        <div className="rounded-i-md border-[0.8px] border-beerus bg-goku px-4 py-3">
          <p className="text-xs text-trunks">In the vault</p>
          {totals.length ? (
            totals.map(([code, value]) => (
              <p key={code} className="text-base font-semibold tabular-nums text-bulma">
                {formatBalance(value, currencyMeta(code).decimals)} {code}
              </p>
            ))
          ) : (
            <p className="text-base font-semibold text-bulma">Nothing yet</p>
          )}
        </div>
      )}

      {terms.isSuccess && options.length === 0 ? (
        <p className="rounded-i-md border-[0.8px] border-beerus bg-goku px-4 py-3 text-sm text-trunks">
          No vault terms are on offer right now.
        </p>
      ) : (
        <div className="grid gap-3">
          <CoinSelect label="Coin" value={coin} coins={coins} onChange={setCoin} />

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-bulma">Term</span>
            <select
              value={lockPeriod}
              onChange={(event) => setTerm(event.target.value)}
              className="h-11 w-full cursor-pointer rounded-i-sm bg-goku px-3 text-sm text-bulma shadow-[inset_0_0_0_1px_var(--color-beerus)] outline-none"
            >
              {options.map((row) => (
                <option key={row.value} value={row.value}>
                  {row.label} · {row.rate}% a year
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="flex justify-between text-xs font-medium text-bulma">
              Amount
              <span className="text-trunks">
                {formatBalance(balance, currencyMeta(coin).decimals)} {coin} available
              </span>
            </span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              className="h-11 w-full rounded-i-sm border-[0.8px] border-beerus bg-goku px-3 text-sm tabular-nums text-bulma outline-none focus:border-piccolo"
            />
          </label>

          <button
            type="button"
            disabled={!ready}
            onClick={() => send({ direction: 'in', coin, amount, lockPeriod })}
            className="h-11 cursor-pointer rounded-i-sm bg-piccolo text-sm font-medium text-goten transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Move to vault
          </button>
        </div>
      )}

      {transfer.isError && (
        <p role="alert" className="rounded-i-sm bg-dodoria/10 px-3 py-2 text-xs text-bulma">
          {transfer.error?.message || 'The vault transfer did not go through.'}
        </p>
      )}

      {deposits.length > 0 && (
        <ul className="grid gap-2">
          {deposits.map((row) => (
            <li
              key={row.depositId}
              className="flex items-center gap-3 rounded-i-md border-[0.8px] border-beerus bg-goku px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold tabular-nums text-bulma">
                  {formatBalance(row.balance, currencyMeta(row.coin).decimals)} {row.coin}
                </span>
                <span className="block text-xs text-trunks">
                  {row.locked && row.endTime
                    ? `Unlocks ${new Date(row.endTime).toLocaleDateString()}`
                    : 'Unlocked'}
                </span>
              </span>
              <button
                type="button"
                disabled={row.locked || transfer.isPending}
                onClick={() => send({ direction: 'out', coin: row.coin, depositId: row.depositId })}
                className="h-9 cursor-pointer rounded-i-sm bg-beerus px-3 text-xs font-medium text-bulma transition-colors hover:bg-trunks/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Withdraw
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
