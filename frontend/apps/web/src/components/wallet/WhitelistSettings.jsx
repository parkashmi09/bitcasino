import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { CURRENCY_ORDER, currencyNetworks } from '@/data/currencies';
import { useWhitelist, useWhitelistChange } from '@/queries/wallet';
import { isAddressShape } from './withdrawRules';
import { cn } from '@/lib/cn';

const INPUT =
  'h-10 w-full rounded-i-sm border-[0.8px] border-beerus bg-goku px-3 text-sm text-bulma outline-none focus:border-piccolo';

/**
 * Withdrawal address whitelist (hash Settings → Whitelist Management, behaviour only):
 * save payout addresses, remove them, and switch "withdraw only to saved addresses".
 * The backend refuses switching it on with no address, and removing the last address
 * switches it off, so the player can never lock their own money.
 */
export function WhitelistSettings() {
  const list = useWhitelist();
  const change = useWhitelistChange();
  const coins = CURRENCY_ORDER.filter((code) => currencyNetworks(code).length > 0);
  const [adding, setAdding] = useState(false);
  const [entry, setEntry] = useState({ label: '', currency: coins[0] ?? 'USDT', network: '', address: '' });

  const networks = currencyNetworks(entry.currency);
  const addresses = list.data?.addresses ?? [];
  const on = list.data?.whitelistOnly === true;
  const valid = entry.label.trim() && isAddressShape(entry.address);

  const add = async (event) => {
    event.preventDefault();
    if (!valid) return;
    const network = entry.network || networks[0]?.short;
    try {
      await change.mutateAsync({
        action: 'add',
        entry: { label: entry.label.trim(), currency: entry.currency, address: entry.address.trim(), ...(network ? { network } : {}) },
      });
      setEntry((value) => ({ ...value, label: '', address: '' }));
      setAdding(false);
    } catch {
      // shown from `change.error`
    }
  };

  return (
    <div className="grid gap-3">
      <p className="mt-3 text-base font-medium text-trunks">Withdrawal whitelist</p>

      <label className="flex items-center justify-between gap-3 py-2">
        <span className="text-base leading-6 text-bulma">Withdraw only to saved addresses</span>
        <input
          type="checkbox"
          checked={on}
          disabled={change.isPending || (!on && addresses.length === 0)}
          onChange={(e) => change.mutate({ action: 'enforce', enabled: e.target.checked })}
          className="size-5 accent-piccolo"
        />
      </label>

      {addresses.map((row) => (
        <div key={row.id} className="flex items-center gap-2 rounded-i-sm bg-goku px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-bulma">{`${row.label} · ${row.currency}${row.network ? ` (${row.network})` : ''}`}</span>
            <span className="block break-all font-mono text-[11px] text-trunks">{row.address}</span>
          </span>
          <button
            type="button"
            aria-label={`Remove ${row.label}`}
            disabled={change.isPending}
            onClick={() => change.mutate({ action: 'remove', id: row.id })}
            className="grid size-8 place-items-center rounded-i-xs text-trunks hover:text-dodoria disabled:opacity-50"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}

      {adding ? (
        <form onSubmit={add} className="grid gap-2 rounded-i-md border-[0.8px] border-beerus p-3">
          <input
            value={entry.label}
            maxLength={60}
            placeholder="Label (e.g. My Binance)"
            onChange={(e) => setEntry({ ...entry, label: e.target.value })}
            className={INPUT}
          />
          <div className="grid grid-cols-2 gap-2">
            <select value={entry.currency} onChange={(e) => setEntry({ ...entry, currency: e.target.value, network: '' })} className={INPUT}>
              {coins.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <select value={entry.network} onChange={(e) => setEntry({ ...entry, network: e.target.value })} className={INPUT}>
              {networks.map((net) => (
                <option key={net.id} value={net.short}>
                  {net.short}
                </option>
              ))}
            </select>
          </div>
          <input
            value={entry.address}
            spellCheck={false}
            autoComplete="off"
            placeholder="Address"
            onChange={(e) => setEntry({ ...entry, address: e.target.value })}
            className={cn(INPUT, 'font-mono text-xs')}
          />
          {entry.address && !isAddressShape(entry.address) && (
            <p className="text-[11px] text-dodoria">4-190 characters: letters, digits and : _ - only.</p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setAdding(false)} className="h-10 flex-1 rounded-i-sm bg-beerus text-sm text-bulma">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!valid || change.isPending}
              className="h-10 flex-1 rounded-i-sm bg-piccolo text-sm font-medium text-on-piccolo disabled:opacity-50"
            >
              Save address
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="h-10 rounded-i-sm bg-beerus text-sm font-medium text-bulma">
          Add address
        </button>
      )}

      {change.isError && (
        <p role="alert" className="rounded-i-sm bg-dodoria/10 px-3 py-2 text-xs text-bulma">
          {change.error?.message || 'That change was refused.'}
        </p>
      )}
    </div>
  );
}
