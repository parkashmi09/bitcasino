import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { CURRENCY_ORDER, currencyNetworks } from '@/data/currencies';
import { useWhitelist, useWhitelistChange } from '@/queries/wallet';
import { useTwoFactorStatus } from '@/queries/account';
import { isAddressShape } from './withdrawRules';
import { cn } from '@/lib/cn';

const INPUT =
  'h-10 w-full rounded-i-sm border-[0.8px] border-beerus bg-goku px-3 text-sm text-bulma outline-none focus:border-piccolo';

/**
 * Withdrawal address whitelist (hash Settings → Whitelist Management, behaviour only):
 * save payout addresses, remove them, and switch "withdraw only to saved addresses".
 * The backend refuses switching it on with no address, and removing the last address
 * switches it off, so the player can never lock their own money.
 *
 * Adding, removing and switching off ask for the account password (and the 2FA code when
 * it is on). A new address is usable 24 hours after it is saved (`activeAt`), and switching
 * off lands 24 hours later (`offAt`); switching back on before then cancels it.
 */
const when = (value) => new Date(value).toLocaleString();
const later = (value) => Boolean(value) && new Date(value).getTime() > Date.now();

export function WhitelistSettings() {
  const list = useWhitelist();
  const change = useWhitelistChange();
  const coins = CURRENCY_ORDER.filter((code) => currencyNetworks(code).length > 0);
  const [adding, setAdding] = useState(false);
  const [entry, setEntry] = useState({ label: '', currency: coins[0] ?? 'USDT', network: '', address: '' });
  // The change waiting on the password (and code): `{action, id?, entry?, enabled?, what}`.
  const [pending, setPending] = useState(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const twoFactor = useTwoFactorStatus().data?.isEnabled === true;

  const networks = currencyNetworks(entry.currency);
  const addresses = list.data?.addresses ?? [];
  const on = list.data?.whitelistOnly === true;
  const offAt = on ? list.data?.offAt : null;
  const valid = entry.label.trim() && isAddressShape(entry.address);

  const ask = (next) => {
    change.reset();
    setPassword('');
    setCode('');
    setPending(next);
  };

  const add = (event) => {
    event.preventDefault();
    if (!valid) return;
    const network = entry.network || networks[0]?.short;
    ask({
      action: 'add',
      what: `Save ${entry.label.trim()}`,
      entry: { label: entry.label.trim(), currency: entry.currency, address: entry.address.trim(), ...(network ? { network } : {}) },
    });
  };

  const confirm = async (event) => {
    event.preventDefault();
    try {
      await change.mutateAsync({ ...pending, auth: { password, ...(twoFactor ? { code: code.trim() } : {}) } });
      if (pending.action === 'add') {
        setEntry((value) => ({ ...value, label: '', address: '' }));
        setAdding(false);
      }
      setPending(null);
    } catch {
      // shown from `change.error`
    } finally {
      setPassword('');
    }
  };

  // Switching on (or cancelling a scheduled off) needs no password; switching off does.
  const toggle = (checked) =>
    checked ? change.mutate({ action: 'enforce', enabled: true }) : ask({ action: 'enforce', enabled: false, what: 'Switch off' });

  return (
    <div className="grid gap-3">
      <p className="mt-3 text-base font-medium text-trunks">Withdrawal whitelist</p>

      <label className="flex items-center justify-between gap-3 py-2">
        <span className="text-base leading-6 text-bulma">Withdraw only to saved addresses</span>
        <input
          type="checkbox"
          checked={on && !offAt}
          disabled={change.isPending || (!on && addresses.length === 0)}
          onChange={(e) => toggle(e.target.checked)}
          className="size-5 accent-piccolo"
        />
      </label>
      {offAt && (
        <p className="-mt-2 text-xs text-krillin">{`Turns off at ${when(offAt)}. Switch it back on to cancel.`}</p>
      )}

      {addresses.map((row) => (
        <div key={row.id} className="flex items-center gap-2 rounded-i-sm bg-goku px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-bulma">{`${row.label} · ${row.currency}${row.network ? ` (${row.network})` : ''}`}</span>
            <span className="block break-all font-mono text-[11px] text-trunks">{row.address}</span>
            {later(row.activeAt) && <span className="block text-[11px] text-krillin">{`Usable from ${when(row.activeAt)}`}</span>}
          </span>
          <button
            type="button"
            aria-label={`Remove ${row.label}`}
            disabled={change.isPending}
            onClick={() => ask({ action: 'remove', id: row.id, what: `Remove ${row.label}` })}
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

      {pending && (
        <form onSubmit={confirm} className="grid gap-2 rounded-i-md border-[0.8px] border-beerus p-3">
          <p className="text-sm text-bulma">{`${pending.what}: confirm with your password${twoFactor ? ' and 2FA code' : ''}.`}</p>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            placeholder="Password"
            aria-label="Password"
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
          />
          {twoFactor && (
            <input
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="2FA code"
              aria-label="2FA code"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className={cn(INPUT, 'tabular-nums')}
            />
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setPending(null)} className="h-10 flex-1 rounded-i-sm bg-beerus text-sm text-bulma">
              Cancel
            </button>
            <button
              type="submit"
              disabled={!password || (twoFactor && code.length < 6) || change.isPending}
              className="h-10 flex-1 rounded-i-sm bg-piccolo text-sm font-medium text-on-piccolo disabled:opacity-50"
            >
              Confirm
            </button>
          </div>
        </form>
      )}

      {change.isError && (
        <p role="alert" className="rounded-i-sm bg-dodoria/10 px-3 py-2 text-xs text-bulma">
          {change.error?.message || 'That change was refused.'}
        </p>
      )}
    </div>
  );
}
