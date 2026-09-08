import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { CoinMark } from './WalletMenu';
import { useBalances, useDisplayCurrency, useFiatCurrency } from '@/hooks/useWallet';
import { useExchangeRates } from '@/hooks/usePreferences';
import { CURRENCY_ORDER, currencyMeta, currencyNetworks } from '@/data/currencies';
import { formatBalance, formatFiat } from '@/lib/format';
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
 * The deposit ADDRESS is not, and is the one thing on this screen that must
 * never be improvised: it comes from the `GET_ADDRESS` socket event, and the
 * socket transport lands with Phase 4 of `docs/10-backend-integration.md`. A
 * player can read a fabricated address and send real money to it, so the QR
 * card states what it is waiting for instead of drawing a code. Same for Buy
 * and Withdraw, and for the exchange card's `SMART DEPOSIT` — they carry the
 * reference's shape and say plainly that they are not wired.
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

              <AddressPanel currency={currency} chain={chain} />
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
            <Waiting
              icon="send"
              title={`Withdraw ${currency}`}
              body="Withdrawals are submitted over the wallet socket and confirmed with your account password. The form opens with it, in Phase 4."
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
 * Where the QR and the address go.
 *
 * Drawn as the reference's square QR card so the sheet has the reference's
 * proportions, with the frame empty and the reason in it. This is the one
 * surface in the app that must never guess: an address is money's destination,
 * and a plausible-looking wrong one is worse than nothing at all.
 */
function AddressPanel({ currency, chain }) {
  return (
    <div className="grid justify-items-center gap-3 rounded-i-md border-[0.8px] border-beerus bg-goku px-6 py-8 text-center">
      <span className="grid aspect-square w-40 place-items-center rounded-i-sm border border-dashed border-beerus text-hit">
        <Icon name="qr" size={72} className="text-beerus" />
      </span>

      <p className="text-sm font-semibold text-bulma">
        {currency} deposit address{chain ? ` · ${chain.label}` : ''}
      </p>
      <p className="max-w-[280px] text-xs leading-relaxed text-trunks">
        Addresses are issued per coin and chain over the wallet socket, which this build does not
        connect to yet. Nothing is shown here until a real one can be.
      </p>
    </div>
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
