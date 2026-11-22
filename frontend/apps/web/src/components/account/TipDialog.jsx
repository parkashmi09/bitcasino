import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { useBalances, useDisplayCurrency, useWalletCoins } from '@/hooks/useWallet';
import { useDebounced } from '@/hooks/useDebounced';
import { useSendTip, useTipSettings, useTipUserSearch } from '@/queries/account';
import { compareDecimal, formatBalance } from '@/lib/format';
import { currencyMeta } from '@/data/currencies';
import { cn } from '@/lib/cn';

/**
 * Send a tip (`POST /user/tip/send`) to another player by username: search, coin, amount, note.
 * The backend applies the operator's USD limits, the withdrawal rules and the recipient's
 * opt-out; its refusal is printed as it comes. One `requestId` per opening, so a retry after a
 * dropped response returns the first tip rather than paying twice.
 */

const INPUT =
  'h-10 w-full rounded-i-sm border-[1.6px] border-hit bg-transparent px-2.5 text-base text-bulma outline-none transition-colors focus:border-piccolo placeholder:text-trunks';

export function TipDialog({ open, onClose }) {
  const send = useSendTip();
  const settings = useTipSettings({ enabled: open });
  const { balances, status } = useBalances();
  const coins = useWalletCoins(balances, status).filter((code) => code !== 'NC');
  const [display] = useDisplayCurrency();

  const [query, setQuery] = useState('');
  const [recipient, setRecipient] = useState(null);
  const [currency, setCurrency] = useState(display);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [requestId, setRequestId] = useState('');
  const [done, setDone] = useState(null);
  const searchRef = useRef(null);
  const ids = { q: useId(), coin: useId(), amount: useId(), note: useId() };

  const term = useDebounced(query, 250);
  const search = useTipUserSearch(recipient ? '' : term);
  const matches = Array.isArray(search.data) ? search.data : [];

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setRecipient(null);
    setAmount('');
    setNote('');
    setDone(null);
    setRequestId(globalThis.crypto?.randomUUID?.() ?? '');
    send.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const coin = coins.includes(currency) ? currency : coins[0];
  const balance = balances?.[coin] ?? '0';
  const decimals = currencyMeta(coin ?? 'USDT').decimals;
  const over = compareDecimal(amount || '0', balance) > 0;
  const ready = Boolean(recipient && coin && /[1-9]/.test(amount) && !over && !send.isPending);
  const limits = settings.data?.limits;

  async function submit(event) {
    event.preventDefault();
    if (!ready) return;
    try {
      const tip = await send.mutateAsync({
        toUsername: recipient.name,
        currency: coin,
        amount,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(requestId ? { requestId } : {}),
      });
      setDone(tip);
    } catch {
      // `send.error` carries it.
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Send a tip" initialFocus={searchRef}>
      {done ? (
        <div className="grid justify-items-center gap-2 py-4 text-center">
          <span className="grid size-14 place-items-center rounded-full bg-roshi/15 text-roshi">
            <Icon name="check" size={28} />
          </span>
          <p className="text-base font-medium text-bulma">
            {formatBalance(done.amount, decimals)} {done.currency} sent to {done.toUsername}
          </p>
          <Button className="mt-2" onClick={onClose}>
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <label htmlFor={ids.q} className="text-base leading-6 text-trunks">
              Player
            </label>
            {recipient ? (
              <div className="flex h-10 items-center justify-between gap-2 rounded-i-sm bg-goku px-2.5">
                <span className="truncate text-base text-bulma">{recipient.name}</span>
                <button
                  type="button"
                  onClick={() => setRecipient(null)}
                  className="cursor-pointer text-sm text-piccolo hover:underline"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  ref={searchRef}
                  id={ids.q}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Username"
                  autoComplete="off"
                  spellCheck={false}
                  className={INPUT}
                />
                {term.trim().length >= 2 && (
                  <ul className="grid max-h-40 overflow-y-auto rounded-i-sm bg-goku p-1" aria-label="Matching players">
                    {search.isPending ? (
                      <li className="px-2 py-1.5 text-sm text-trunks">Searching…</li>
                    ) : search.isError ? (
                      <li className="px-2 py-1.5 text-sm text-chichi">{search.error?.message || 'Player search failed.'}</li>
                    ) : matches.length === 0 ? (
                      <li className="px-2 py-1.5 text-sm text-trunks">No player by that name accepts tips.</li>
                    ) : (
                      matches.map((user) => (
                        <li key={user.id}>
                          <button
                            type="button"
                            onClick={() => setRecipient(user)}
                            className="w-full cursor-pointer rounded-i-xs px-2 py-1.5 text-start text-sm text-bulma hover:bg-heles"
                          >
                            {user.name}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </>
            )}
          </div>

          <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
            <div className="grid gap-2">
              <label htmlFor={ids.coin} className="text-base leading-6 text-trunks">
                Coin
              </label>
              <select id={ids.coin} value={coin ?? ''} onChange={(e) => setCurrency(e.target.value)} className={cn(INPUT, 'cursor-pointer bg-gohan')}>
                {coins.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <label htmlFor={ids.amount} className="text-base leading-6 text-trunks">
                Amount
              </label>
              <input
                id={ids.amount}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                inputMode="decimal"
                placeholder="0.00"
                className={cn(INPUT, 'tabular-nums', over && 'border-chichi')}
              />
            </div>
          </div>
          <p className="-mt-2 text-xs leading-4 text-trunks tabular-nums">
            {formatBalance(balance, decimals)} {coin} available
            {over && <span className="text-chichi"> · more than your balance</span>}
          </p>

          <div className="grid gap-2">
            <label htmlFor={ids.note} className="text-base leading-6 text-trunks">
              Note (optional)
            </label>
            <input id={ids.note} value={note} onChange={(e) => setNote(e.target.value.slice(0, 140))} className={INPUT} />
          </div>

          {limits && (Number(limits.maxPerTipUsd) > 0 || Number(limits.maxPerDayUsd) > 0) && (
            <p className="text-xs leading-4 text-trunks">
              {Number(limits.maxPerTipUsd) > 0 && `Up to ${formatBalance(limits.maxPerTipUsd)} ${limits.currency ?? 'USD'} a tip. `}
              {Number(limits.maxPerDayUsd) > 0 && `${formatBalance(limits.maxPerDayUsd)} ${limits.currency ?? 'USD'} a day.`}
            </p>
          )}

          {send.isError && (
            <p role="alert" className="text-sm leading-5 text-chichi">
              {send.error?.message || 'The tip was refused.'}
            </p>
          )}

          <Button type="submit" size="lg" fullWidth disabled={!ready}>
            {send.isPending ? 'Sending…' : 'Send tip'}
          </Button>
        </form>
      )}
    </Dialog>
  );
}
