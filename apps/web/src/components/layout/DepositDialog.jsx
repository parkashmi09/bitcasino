import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { CoinMark } from './WalletMenu';
import { useBalances, useDisplayCurrency, useFiatCurrency } from '@/hooks/useWallet';
import { useExchangeRates } from '@/hooks/usePreferences';
import { CURRENCY_ORDER, currencyMeta, currencyNetworks } from '@/data/currencies';
import QRCode from 'qrcode';
import { compareDecimal, formatBalance, formatFiat, percentOf } from '@/lib/format';
import { useDepositAddress, useSubmitWithdrawal } from '@/queries/wallet';
import { cn } from '@/lib/cn';

/**
 * Where the header's Deposit button goes: the reference's wallet drawer.
 *
 * Read off bitcasino.io's own drawer rather than from memory, top to bottom —
 * see `docs/11-comparing-against-the-reference.md`:
 *
 *   chrome     full-height sheet on the end edge, 420px, `gohan` ground with
 *              WHITE cards on it; the close X is at the START of the bar and
 *              there is no title beside it
 *   heading    `Active balance`, 20px, directly under the bar
 *   balance    one white card: 40px coin mark, name over ticker, the amount
 *              over its fiat quote, and a chevron that expands the card into
 *              the currency list — the picker IS this card, not a rail of
 *              chips above it
 *   hint       a black tooltip, `Looking for a different currency?`, pointing
 *              at that chevron
 *   actions    Deposit / Buy / Withdraw as one segmented control, active half
 *              a white pill with a shadow; Deposit's glyph is a filled disc
 *   deposit    the exchange-or-wallet card with its `SMART DEPOSIT` strip,
 *              then the network row, then the QR and the address
 *
 * The previous pass had a centred `Currency` chip rail and a two-tab header,
 * which is a different screen wearing the same colours. Everything above is
 * the reference's order and the reference's geometry.
 *
 * ## What is real and what is waiting
 *
 * The balances, the currency choice and the fiat quote are real reads
 * (`GET /user/wallet/balances`, `GET /user/exchange-rate/rates`). The network
 * names are public facts, listed in `data/currencies.js`.
 *
 * The deposit ADDRESS is now real too, over the `GET_ADDRESS` socket event —
 * Phase 4. It is the one thing on this screen that must never be improvised,
 * because a player can send real money to whatever it shows, so `AddressPanel`
 * below has four explicit states and none of them falls back to something
 * plausible. Note especially the network caveat documented there: the platform
 * stores one address per coin with no chain, so for a multi-network coin the
 * address is NOT captioned with whichever network the player selected.
 *
 * Buy, and the exchange card's `SMART DEPOSIT`, are still unwired — they carry
 * the reference's shape and say plainly that they are not. Withdraw is a real
 * form over `SUBMIT_NEW_WITHDRAWL`.
 *
 * The geometry is the reference's drawer, not a centred card, so the panel
 * slides in from the edge it is attached to (`animate-sheet-in`, see
 * `index.css`) rather than zooming out of the middle of the screen. Below
 * `sm` it is a full-bleed sheet.
 */

const ANIMATION_MS = 150;

const TABS = [
  { value: 'deposit', label: 'Deposit', icon: 'plus', disc: true },
  { value: 'buy', label: 'Buy', icon: 'card' },
  { value: 'withdraw', label: 'Withdraw', icon: 'send' },
];

/** So the currency hint is shown once in a player's life, not once a session. */
const HINT_KEY = 'bc.wallet-currency-hint';

export function DepositDialog({ open, onClose }) {
  const [tab, setTab] = useState('deposit');
  const [closing, setClosing] = useState(false);
  const [picking, setPicking] = useState(false);
  const [hint, setHint] = useState(false);

  const [currency, setCurrency] = useDisplayCurrency();
  const [fiat] = useFiatCurrency();
  const { balances, status, reload } = useBalances();
  const { rates } = useExchangeRates();

  const networks = useMemo(() => currencyNetworks(currency), [currency]);
  const [network, setNetwork] = useState(null);
  const [pickingNetwork, setPickingNetwork] = useState(false);

  const openerRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    openerRef.current = document.activeElement;
    setClosing(false);
    setTab('deposit');
    setPicking(false);
    setPickingNetwork(false);

    try {
      setHint(localStorage.getItem(HINT_KEY) !== 'seen');
    } catch {
      // Storage disabled. Showing the hint is the harmless side of the guess.
      setHint(true);
    }

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const id = window.setTimeout(() => panelRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(id);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  /* The chosen chain belongs to the coin, so it resets with it — a Tron
     selection surviving a switch to BTC would qualify the address panel with
     a network the coin does not run on. */
  useEffect(() => setNetwork(networks[0]?.id ?? null), [networks]);

  const dismissHint = useCallback(() => {
    setHint(false);
    try {
      localStorage.setItem(HINT_KEY, 'seen');
    } catch {
      // It will ask again next time. Not worth handling further.
    }
  }, []);

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      setClosing(false);
      onClose();
      openerRef.current?.focus?.();
    }, ANIMATION_MS);
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open && !closing) return null;

  const leaving = closing || !open;
  const meta = currencyMeta(currency);
  const amount = formatBalance(balances[currency] ?? '0', meta.decimals);
  const quote = formatFiat(balances[currency] ?? '0', rates[currency], rates[fiat], fiat);
  const chain = networks.find((entry) => entry.id === network) ?? networks[0] ?? null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        role="presentation"
        onClick={close}
        className={cn(
          'absolute inset-0 bg-popo/50',
          leaving ? 'animate-overlay-out' : 'animate-overlay-in',
        )}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Wallet"
        tabIndex={-1}
        className={cn(
          'relative flex h-full w-full flex-col bg-gohan text-bulma shadow-lg outline-none',
          'sm:max-w-[420px]',
          leaving ? 'animate-sheet-out' : 'animate-sheet-in',
        )}
      >
        {/* The reference puts the X alone at the start of the bar. No title:
            `Active balance` below is the heading, and repeating `Wallet`
            above it would be two headings for one screen. */}
        <div className="flex h-16 shrink-0 items-center px-2">
          <button
            type="button"
            onClick={close}
            aria-label="Close wallet"
            className="grid size-11 cursor-pointer place-items-center rounded-i-sm text-bulma transition-colors hover:bg-heles"
          >
            <Icon name="close" size={22} />
          </button>
        </div>

        <div
          className={cn(
            'min-h-0 flex-1 overflow-y-auto px-4 pb-8',
            'max-sm:pb-[calc(2rem+env(safe-area-inset-bottom))]',
          )}
        >
          <h2 className="mb-3 font-primary text-xl font-semibold">Active balance</h2>

          <div className="relative">
            <BalanceCard
              currency={currency}
              meta={meta}
              amount={amount}
              quote={quote}
              status={status}
              open={picking}
              onToggle={() => {
                setPicking((value) => !value);
                dismissHint();
              }}
              balances={balances}
              rates={rates}
              fiat={fiat}
              onPick={(code) => {
                setCurrency(code);
                setPicking(false);
              }}
              onReload={reload}
            />

            {/* The reference's coach mark: a black pill hanging off the
                chevron, dismissed by taking it up or by tapping it. */}
            {hint && !picking && (
              <button
                type="button"
                onClick={dismissHint}
                className={cn(
                  'absolute end-4 top-full z-10 -translate-y-4 cursor-pointer',
                  'max-w-[calc(100%-1rem)] rounded-i-sm bg-popo px-4 py-2.5 text-start',
                  'text-sm font-medium text-goten shadow-lg',
                )}
              >
                Looking for a different currency?
              </button>
            )}
          </div>

          <Segmented value={tab} onChange={setTab} hasHint={hint && !picking} />

          {tab === 'deposit' && (
            <div className="grid gap-3">
              <ExchangeCard />

              {chain && (
                <NetworkRow
                  currency={currency}
                  chain={chain}
                  options={networks}
                  open={pickingNetwork}
                  onToggle={() => setPickingNetwork((value) => !value)}
                  onPick={(id) => {
                    setNetwork(id);
                    setPickingNetwork(false);
                  }}
                />
              )}

              <AddressPanel currency={currency} chain={chain} networks={networks} />
            </div>
          )}

          {tab === 'buy' && (
            <Waiting
              icon="card"
              title={`Buy ${currency} with card`}
              body="The card on-ramp is a hosted checkout opened with a session token from the payments service. This build does not hold the credentials to open one, so nothing is shown here rather than a form that cannot submit."
            />
          )}

          {tab === 'withdraw' && (
            <WithdrawForm
              currency={currency}
              balance={balances[currency] ?? '0'}
              decimals={meta.decimals}
              onDone={reload}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The white card the whole drawer is anchored on, and the currency picker.
 *
 * One card doing both is the reference's decision and it is the right one:
 * the thing a player wants to change is the coin they are looking at, so the
 * control that changes it is the row showing it, expanded in place. The
 * chevron is the only affordance, and the list pushes the rest of the drawer
 * down rather than floating over it.
 */
function BalanceCard({
  currency,
  meta,
  amount,
  quote,
  status,
  open,
  onToggle,
  balances,
  rates,
  fiat,
  onPick,
  onReload,
}) {
  /* Held coins first — a player with money in one has to find it without
     scrolling past twenty they do not hold — then everything else, in the
     wallet's own order. */
  const list = useMemo(() => {
    const held = CURRENCY_ORDER.filter((code) => /[1-9]/.test(String(balances[code] ?? '')));
    return [...new Set([...held, currency, ...CURRENCY_ORDER])];
  }, [balances, currency]);

  return (
    <div className="overflow-hidden rounded-i-md border-[0.8px] border-beerus bg-goku">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`Active balance, ${meta.name}. Change currency`}
        className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-3.5 text-start transition-colors hover:bg-heles sm:gap-3"
      >
        <CoinMark code={currency} size={40} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-bulma">{meta.name}</span>
          <span className="block text-sm text-trunks">{currency}</span>
        </span>

        {/* A crypto balance is eight places plus a ticker — `0.00000000 ETH`
            is 130px of digits, and on a 360px sheet that is most of the row.
            It steps down a size below `sm` so the coin's NAME still has room
            to be read rather than truncating to `Ethe…`. */}
        <span className="shrink-0 text-end">
          {status === 'loading' ? (
            <Skeleton className="h-4 w-20" />
          ) : (
            <span className="block text-[15px] font-semibold tabular-nums text-bulma sm:text-base">
              {amount} {currency}
            </span>
          )}
          {/* Only when a rate answered for both legs — see `formatFiat`. */}
          {quote && <span className="block text-sm tabular-nums text-trunks">{quote}</span>}
        </span>

        <Icon
          name="chevron-down"
          size={22}
          className={cn(
            'shrink-0 text-bulma transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="border-t-[0.8px] border-beerus">
          {status === 'error' && (
            <div className="grid gap-2 px-4 py-6 text-center">
              <p className="text-sm text-bulma">Balances could not be loaded.</p>
              <button
                type="button"
                onClick={onReload}
                className="cursor-pointer text-sm font-medium text-piccolo hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {status === 'loading' && (
            <div className="grid gap-1 p-2">
              {[0, 1, 2, 3].map((row) => (
                <Skeleton key={row} className="h-12 rounded-i-sm" />
              ))}
            </div>
          )}

          {status !== 'loading' && status !== 'error' && (
            /* Capped so the list scrolls inside the card instead of pushing
               the QR a screen and a half down the sheet. */
            <ul className="grid max-h-[280px] gap-0.5 overflow-y-auto p-2">
              {list.map((code) => {
                const row = currencyMeta(code);
                const active = code === currency;
                const rowQuote = formatFiat(balances[code] ?? '0', rates[code], rates[fiat], fiat);

                return (
                  <li key={code}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => onPick(code)}
                      className={cn(
                        'flex w-full cursor-pointer items-center gap-3 rounded-i-sm px-2 py-2',
                        'text-start transition-colors',
                        active ? 'bg-jiren' : 'hover:bg-heles',
                      )}
                    >
                      <CoinMark code={code} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-bulma">
                          {row.name}
                        </span>
                        <span className="block text-xs text-trunks">{code}</span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className="block text-sm font-medium tabular-nums text-bulma">
                          {formatBalance(balances[code] ?? '0', row.decimals)}
                        </span>
                        {rowQuote && (
                          <span className="block text-xs tabular-nums text-trunks">{rowQuote}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Deposit / Buy / Withdraw as the reference draws it: three equal halves in a
 * white track, the active one a pill lifted off it by a shadow rather than by
 * a fill, because the track is white too.
 *
 * `hasHint` pushes the control down while the coach mark is up — the tooltip
 * hangs below the balance card and would otherwise sit on top of it.
 */
function Segmented({ value, onChange, hasHint }) {
  return (
    <div
      role="tablist"
      aria-label="Wallet actions"
      className={cn(
        'my-4 grid grid-cols-3 gap-1 rounded-full border-[0.8px] border-beerus bg-goku p-1',
        hasHint && 'mt-8',
      )}
    >
      {TABS.map((tab) => {
        const active = tab.value === value;

        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              'flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full',
              'text-sm font-medium transition-colors',
              active
                ? 'bg-goku text-bulma shadow-[0_1px_6px_rgb(0_0_0/0.14)]'
                : 'text-trunks hover:bg-heles',
            )}
          >
            {tab.disc ? (
              /* Deposit's `+` is a filled disc on the reference, not a bare
                 stroke like the other two — it is the primary action and the
                 disc is the whole of what says so. */
              <span
                className={cn(
                  'grid size-5 shrink-0 place-items-center rounded-full text-goku transition-colors',
                  active ? 'bg-bulma' : 'bg-trunks',
                )}
              >
                <Icon name={tab.icon} size={13} />
              </span>
            ) : (
              <Icon name={tab.icon} size={19} />
            )}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * `Deposit from Exchange or Wallet`, the reference's aggregator card.
 *
 * Carried for the shape and the position — it is the first thing under the
 * actions there, and leaving a hole where it sits changes the rhythm of the
 * whole sheet. It does nothing, and says so: `aria-disabled` keeps it in the
 * tab order so the reason reaches a screen reader, which `disabled` would
 * not.
 */
function ExchangeCard() {
  return (
    <div className="overflow-hidden rounded-i-md border-[0.8px] border-beerus bg-goku">
      <button
        type="button"
        aria-disabled="true"
        aria-describedby="bc-exchange-note"
        onClick={(event) => event.preventDefault()}
        className="flex w-full cursor-not-allowed items-center gap-3 px-4 py-3.5 text-start"
      >
        {/* Three overlapping discs where the reference shows its partners'
            marks. This project has no licence to those logos and no
            partnership to claim, so they are shapes, not traced brands. */}
        <span aria-hidden="true" className="flex shrink-0 -space-x-2">
          {['#1652f0', '#f0b90b', '#e2761b'].map((tint) => (
            <span
              key={tint}
              style={{ backgroundColor: tint }}
              className="size-7 rounded-full ring-2 ring-goku"
            />
          ))}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold text-bulma">
            Deposit from Exchange or Wallet
          </span>
          <span className="block text-sm text-trunks">Connect an account</span>
        </span>
      </button>

      <p
        id="bc-exchange-note"
        className="bg-whis/10 py-2.5 text-center text-xs font-semibold tracking-[0.08em] text-whis uppercase"
      >
        Smart deposit — not available yet
      </p>
    </div>
  );
}

/**
 * The chain the address would be issued on.
 *
 * A picker rather than a caption because for USDT the choice decides whether
 * the money arrives — an address on one chain is not an address on another —
 * and it collapses to a plain row for a coin that only has one.
 */
function NetworkRow({ currency, chain, options, open, onToggle, onPick }) {
  const single = options.length < 2;

  return (
    <div className="overflow-hidden rounded-i-md border-[0.8px] border-beerus bg-goku">
      <button
        type="button"
        onClick={single ? undefined : onToggle}
        aria-expanded={single ? undefined : open}
        aria-disabled={single || undefined}
        className={cn(
          'flex w-full items-center gap-3 px-4 py-3.5 text-start transition-colors',
          single ? 'cursor-default' : 'cursor-pointer hover:bg-heles',
        )}
      >
        <NetworkMark currency={currency} short={chain.short} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-bulma">{chain.label}</span>
          <span className="block text-sm text-trunks">{currencyMeta(currency).name}</span>
        </span>

        {!single && (
          <Icon
            name="chevron-down"
            size={22}
            className={cn(
              'shrink-0 text-bulma transition-transform duration-150',
              open && 'rotate-180',
            )}
          />
        )}
      </button>

      {open && !single && (
        <ul className="grid gap-0.5 border-t-[0.8px] border-beerus p-2">
          {options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={option.id === chain.id}
                onClick={() => onPick(option.id)}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-3 rounded-i-sm px-2 py-2',
                  'text-start text-sm font-medium transition-colors',
                  option.id === chain.id ? 'bg-jiren text-bulma' : 'text-bulma hover:bg-heles',
                )}
              >
                <NetworkMark currency={currency} short={option.short} size={32} />
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The coin disc with the chain's ticker badged on its corner, as on the reference. */
function NetworkMark({ currency, short, size = 40 }) {
  return (
    <span className="relative shrink-0">
      <CoinMark code={currency} size={size} />
      <span
        className={cn(
          'absolute -end-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full px-1',
          'bg-popo text-[9px] leading-none font-semibold text-goten',
        )}
        aria-hidden="true"
      >
        {short}
      </span>
    </span>
  );
}

/**
 * The QR and the address — a real `GET_ADDRESS` read over the wallet socket.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS IS THE ONE SURFACE IN THE APP THAT MUST NEVER GUESS.
 *
 * A player can send real money to whatever is shown here, and a deposit to a
 * wrong address is unrecoverable. So every state is explicit and none of them
 * falls back to something plausible:
 *
 *   loading      a skeleton the size of the card, not an empty frame
 *   error        says the address could not be read, with a retry
 *   unallocated  says no address is provisioned — `allocated: false` is a real
 *                answer from the platform, not a failure
 *   allocated    the address, and a QR encoding EXACTLY that string
 *
 * ── THE NETWORK CAVEAT, WHICH IS A REAL RISK ────────────────────────────
 *
 * `wallets` stores one address per (uid, coin) and has **no chain column**, so
 * the platform cannot say which network an address belongs to — it answers
 * `chain: null`. For a single-network coin that is fine and the network is
 * implied. For USDT it is not: TRC20, ERC20 and BEP20 are different addresses,
 * and sending to the wrong one loses the funds.
 *
 * So when the coin has several networks and the platform names none, this says
 * so instead of captioning the address with whichever network the player
 * happened to have selected above. Labelling it would be inventing the single
 * most dangerous fact on the screen.
 * ═════════════════════════════════════════════════════════════════════════
 */
function AddressPanel({ currency, chain: _chain, networks }) {
  const { data, isPending, isError, error, refetch } = useDepositAddress(currency);
  const [copied, setCopied] = useState(false);

  const address = data?.allocated ? data.address : null;
  /** The network the PLATFORM names, never the one the player picked. */
  const confirmedChain = data?.chain ?? null;
  const ambiguous = Boolean(address) && !confirmedChain && (networks?.length ?? 0) > 1;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied or unavailable. The address is selectable as text,
      // which is the fallback — no error state for a convenience.
    }
  };

  return (
    <div className="grid justify-items-center gap-3 rounded-i-md border-[0.8px] border-beerus bg-goku px-6 py-8 text-center">
      {isPending ? (
        <Skeleton className="aspect-square w-40 rounded-i-sm" />
      ) : address ? (
        <AddressQr value={address} />
      ) : (
        <span className="grid aspect-square w-40 place-items-center rounded-i-sm border border-dashed border-beerus">
          <Icon name="qr" size={72} className="text-beerus" />
        </span>
      )}

      <p className="text-sm font-semibold text-bulma">
        {currency} deposit address
        {confirmedChain ? ` · ${confirmedChain}` : ''}
      </p>

      {isPending ? (
        <Skeleton className="h-8 w-full max-w-[280px]" />
      ) : isError ? (
        <>
          <p className="max-w-[280px] text-xs leading-relaxed text-trunks">
            {error?.code === 'SOCKET_TIMEOUT'
              ? 'The wallet connection did not respond. Nothing is shown until an address can be read.'
              : 'The deposit address could not be read. Nothing is shown until it can be.'}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-i-sm bg-beerus px-3 py-1.5 text-xs font-medium text-bulma transition-colors hover:bg-trunks/20"
          >
            Try again
          </button>
        </>
      ) : address ? (
        <>
          <button
            type="button"
            onClick={copy}
            title="Copy address"
            className="flex w-full max-w-[300px] items-center gap-2 rounded-i-sm border-[0.8px] border-beerus bg-gohan px-3 py-2 text-start transition-colors hover:border-trunks/40"
          >
            {/* `break-all` and not truncation: a partly shown address is one
                somebody can copy by hand and get wrong. */}
            <span className="min-w-0 flex-1 font-mono text-[11px] leading-4 break-all text-bulma">
              {address}
            </span>
            <Icon
              name={copied ? 'check' : 'copy'}
              size={16}
              className={copied ? 'shrink-0 text-roshi' : 'shrink-0 text-trunks'}
            />
          </button>

          {ambiguous ? (
            <p
              role="alert"
              className="max-w-[300px] rounded-i-sm bg-hit/10 px-3 py-2 text-xs leading-relaxed text-bulma"
            >
              <strong className="font-semibold">Confirm the network first.</strong>{' '}
              {currency} exists on {networks.map((n) => n.label).join(', ')}, and this
              deployment does not record which one this address is on. Sending on the
              wrong network loses the deposit.
            </p>
          ) : (
            <p className="max-w-[280px] text-xs leading-relaxed text-trunks">
              Send only {currency}
              {confirmedChain ? ` on ${confirmedChain}` : ''} to this address.
            </p>
          )}
        </>
      ) : (
        <p className="max-w-[280px] text-xs leading-relaxed text-trunks">
          No {currency} deposit address is provisioned for this account yet. The
          platform issues them per coin; nothing is shown here until one exists.
        </p>
      )}
    </div>
  );
}

/**
 * A QR of exactly the address string, rendered to a canvas.
 *
 * The value encoded is the same string shown beneath it — never a URI scheme
 * or an amount-carrying payment link, because a QR a player cannot read is a
 * QR they cannot check against the text.
 *
 * Errors are swallowed to a blank frame rather than surfaced: the address
 * itself is above it and copyable, so a failed render costs convenience, not
 * correctness.
 */
function AddressQr({ value }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    QRCode.toCanvas(canvas, value, { width: 160, margin: 1 }).catch(() => {});
  }, [value]);

  return (
    <span className="grid aspect-square w-40 place-items-center overflow-hidden rounded-i-sm bg-goten p-1">
      <canvas ref={ref} aria-label="Deposit address QR code" className="size-full" />
    </span>
  );
}

/**
 * The withdrawal form — `SUBMIT_NEW_WITHDRAWL` over the wallet socket.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS MOVES REAL MONEY AND IT TAKES THE ACCOUNT PASSWORD.
 *
 * Four rules, and each one is load-bearing:
 *
 * 1. **The password is never stored.** It lives in component state for the
 *    duration of the form and is cleared on submit, on success and on close.
 *    It is not in a query key, not in the cache, not in a ref. The socket
 *    frame is JSON in a byte array — TLS protects it, the encoding does not —
 *    so it travels exactly as a password on an HTTPS form post does.
 *
 * 2. **The amount is a decimal STRING the whole way.** Never `Number()`.
 *    Balances are `NUMERIC(30,8)` and a float cannot hold one; a withdrawal is
 *    the worst possible place to find a rounding error. The percentage
 *    shortcuts below do string arithmetic for the same reason.
 *
 * 3. **No automatic retry.** A withdrawal is not idempotent and the server has
 *    no request id to deduplicate on, so a retry after a timeout is how one
 *    payout becomes two. `useSubmitWithdrawal` inherits `retry: false`, and
 *    the button is disabled while a submit is in flight.
 *
 * 4. **The confirm step is not decoration.** An address typed one character
 *    wrong sends the money somewhere unrecoverable, so the form shows back
 *    what it is about to do and asks again before it emits.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * The server verifies the password against the hash before anything moves, and
 * checks affordability inside the same transaction as the debit. Neither is
 * re-implemented here: the client's checks are there to spare a round trip and
 * to say what is wrong, not to be the control.
 */
function WithdrawForm({ currency, balance, decimals, onDone }) {
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(null);

  const submit = useSubmitWithdrawal();

  /** String-safe: take a percentage without ever making the balance a float. */
  const takePercent = (percent) => setAmount(percentOf(balance, percent, decimals));

  const overBalance = compareDecimal(amount || '0', balance) > 0;
  const positive = /[1-9]/.test(amount || '');
  const ready = address.trim().length > 0 && positive && !overBalance;

  const reset = () => {
    setAddress('');
    setAmount('');
    setPassword('');
    setConfirming(false);
  };

  const send = async () => {
    try {
      const result = await submit.mutateAsync({
        coin: currency,
        amount,
        wallet: address,
        password,
      });
      // Cleared the moment it is no longer needed, before anything renders.
      setPassword('');
      setDone(result);
      reset();
      onDone?.();
    } catch {
      // `submit.error` carries it; the panel below renders from that. The
      // password is deliberately kept so the player can correct only it.
      setConfirming(false);
    }
  };

  if (done) {
    return (
      <div className="grid justify-items-center gap-2 rounded-i-md border-[0.8px] border-beerus bg-goku px-6 py-10 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-roshi/15 text-roshi">
          <Icon name="check" size={28} />
        </span>
        <p className="text-sm font-medium text-bulma">Withdrawal requested</p>
        <p className="text-xs leading-relaxed text-trunks">
          {formatBalance(done.amount ?? '0', decimals)} {done.coin ?? currency} is pending
          review. It leaves your balance now and appears in your history.
        </p>
        <button
          type="button"
          onClick={() => setDone(null)}
          className="mt-1 rounded-i-sm bg-beerus px-3 py-1.5 text-xs font-medium text-bulma transition-colors hover:bg-trunks/20"
        >
          Make another
        </button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!confirming) setConfirming(true);
      }}
    >
      <Field label={`${currency} address`}>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          disabled={confirming}
          spellCheck={false}
          autoComplete="off"
          placeholder={`Destination ${currency} address`}
          className="h-11 w-full rounded-i-sm border-[0.8px] border-beerus bg-goku px-3 font-mono text-xs text-bulma outline-none focus:border-piccolo disabled:text-trunks"
        />
      </Field>

      <Field
        label="Amount"
        hint={`${formatBalance(balance, decimals)} ${currency} available`}
      >
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          disabled={confirming}
          inputMode="decimal"
          placeholder="0.00"
          className="h-11 w-full rounded-i-sm border-[0.8px] border-beerus bg-goku px-3 text-sm tabular-nums text-bulma outline-none focus:border-piccolo disabled:text-trunks"
        />
        {!confirming && (
          <div className="mt-1.5 flex gap-1.5">
            {[25, 50, 75, 100].map((percent) => (
              <button
                key={percent}
                type="button"
                onClick={() => takePercent(percent)}
                className="flex-1 rounded-i-xs bg-beerus py-1 text-[11px] font-medium text-bulma transition-colors hover:bg-trunks/20"
              >
                {percent === 100 ? 'Max' : `${percent}%`}
              </button>
            ))}
          </div>
        )}
        {overBalance && (
          <p role="alert" className="mt-1.5 text-[11px] text-dodoria">
            That is more than your {currency} balance.
          </p>
        )}
      </Field>

      {confirming && (
        <>
          {/* Shown back before it is sent. An address one character wrong is
              money gone, so the last thing the player reads is the thing that
              is about to happen — not a form they have stopped looking at. */}
          <div className="grid gap-1 rounded-i-md bg-goku px-3 py-2.5 text-xs">
            <Row label="Sending" value={`${formatBalance(amount, decimals)} ${currency}`} />
            <Row label="To" value={address} mono />
          </div>

          <Field label="Account password" hint="Verified before anything moves.">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="h-11 w-full rounded-i-sm border-[0.8px] border-beerus bg-goku px-3 text-sm text-bulma outline-none focus:border-piccolo"
            />
          </Field>
        </>
      )}

      {submit.isError && (
        <p role="alert" className="rounded-i-sm bg-dodoria/10 px-3 py-2 text-xs text-bulma">
          {submit.error?.message || 'The withdrawal was refused.'}
        </p>
      )}

      {confirming ? (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={submit.isPending}
            className="h-11 flex-1 rounded-i-sm bg-beerus text-sm font-medium text-bulma transition-colors hover:bg-trunks/20 disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="button"
            onClick={send}
            // Disabled while in flight: a second click is a second payout.
            disabled={submit.isPending || password.length === 0}
            className="h-11 flex-1 rounded-i-sm bg-piccolo text-sm font-medium text-goten transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submit.isPending ? 'Sending…' : 'Confirm withdrawal'}
          </button>
        </div>
      ) : (
        <button
          type="submit"
          disabled={!ready}
          className="h-11 rounded-i-sm bg-piccolo text-sm font-medium text-goten transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          Review withdrawal
        </button>
      )}
    </form>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="grid gap-1.5">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-bulma">{label}</span>
        {hint && <span className="text-[11px] text-trunks">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Row({ label, value, mono = false }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-trunks">{label}</span>
      <span className={cn('min-w-0 text-end break-all text-bulma', mono && 'font-mono text-[11px]')}>
        {value}
      </span>
    </span>
  );
}

/**
 * The state a surface is in when the screen is built and the transport is not.
 * Deliberately plain — a dashed box says "nothing here yet" without pretending
 * to be a disabled version of something that works.
 */
function Waiting({ icon, title, body }) {
  return (
    <div className="grid justify-items-center gap-2 rounded-i-md border border-dashed border-beerus bg-goku px-6 py-10 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-gohan text-trunks">
        <Icon name={icon} size={28} />
      </span>
      <p className="text-sm font-medium text-bulma">{title}</p>
      <p className="text-xs leading-relaxed text-trunks">{body}</p>
    </div>
  );
}
