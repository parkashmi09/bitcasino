import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { MenuDivider, MenuHeading, MenuPanel } from './HeaderMenu';
import { usePopover } from '@/hooks/usePopover';
import { useBalances, useDisplayCurrency } from '@/hooks/useWallet';
import { CURRENCY_ORDER, currencyMeta } from '@/data/currencies';
import { formatBalance } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * The wallet end of the signed-in header: balance, currency picker, Deposit.
 *
 * Every measurement here came off bitcasino.io's own signed-in header, read
 * from the live DOM rather than eyeballed from a screenshot — see
 * `docs/11-comparing-against-the-reference.md`:
 *
 *   box       h-10, radius 12px, bg gohan, border 0.8px beerus,
 *             padding 0 4px 0 8px, gap 8px  →  198px wide at USDT 0.00
 *   balance   24px coin mark, text-sm font-medium tracking-tight, 18px chevron
 *   Deposit   h-8, radius 8px, bg piccolo, px-3, gap-1.5, 15px glyph,
 *             13px label, and the label is `hidden md:block`
 *
 * The shape that matters is that Deposit sits **inside** the box, inset by the
 * box's own 4px of padding, rather than being a second pill butted up against
 * it. That inset — a 32px orange button floating in a 40px `gohan` frame — is
 * what makes the control read as the reference's rather than as two buttons
 * that happen to touch.
 *
 * The number is real: `GET /user/wallet/balances`, formatted as a string all
 * the way to the screen (`formatBalance`). It is never invented and never
 * parsed — the currency's display precision decides how much of the stored
 * eight decimal places is shown, and a wallet that has not answered yet shows
 * a skeleton rather than a zero, because a false zero beside a real account is
 * worse than no number.
 *
 * ## What goes at narrow widths
 *
 * The Deposit LABEL drops at `md`, leaving its glyph — that is the reference's
 * own `hidden md:block`, and it is the opposite of the obvious choice, since
 * the balance is why a player looks at the header at all.
 *
 * The amount then drops at `sm`, which is NOT the reference's; there it stays
 * down to the narrowest width. The reason is a control count this project
 * cannot match: the reference's phone header holds four things because its
 * search and its nav trigger live in a bottom tab bar, while this one holds
 * six. Six 40px controls plus a 29px amount overflow a 360px phone, and of the
 * two ways out — dropping a control a player needs, or moving the number one
 * tap into the panel this button already opens — the number is the one that
 * survives being moved.
 */

/**
 * The coin disc, 24px to match the reference's coin artwork.
 *
 * The reference serves each coin's real mark from
 * `cashier-module.imgix.net/images/icons/currencies/<code>.svg`; this project
 * has no licence to those logos, so it draws the ticker's initial on the
 * coin's brand colour at the same size — a placeholder that reads as one
 * rather than a traced copy.
 */
export function CoinMark({ code, size = 24, className }) {
  const { tint } = currencyMeta(code);

  return (
    <span
      style={{ backgroundColor: tint, width: size, height: size }}
      className={cn(
        'grid shrink-0 place-items-center rounded-full font-semibold text-white',
        className,
      )}
      aria-hidden="true"
    >
      <span style={{ fontSize: Math.round(size * 0.5) }} className="leading-none">
        {code.charAt(0)}
      </span>
    </span>
  );
}

/**
 * Which coins the picker offers. Everything the wallet actually holds first —
 * a player with money in a currency must be able to find it without hunting —
 * then the four the platform defaults to, so a brand-new empty wallet still
 * has something to choose between. `Show all currencies` opens the rest.
 */
const BASE = ['BTC', 'ETH', 'USDT', 'INR'];

function pickList(balances, selected, all) {
  if (all) return CURRENCY_ORDER;

  const held = CURRENCY_ORDER.filter((code) => /[1-9]/.test(String(balances[code] ?? '')));
  return [...new Set([...held, ...BASE, selected])].filter((code) => CURRENCY_ORDER.includes(code));
}

export function WalletMenu({ onOpenDeposit }) {
  const { open, toggle, close, ref } = usePopover();
  const [currency, setCurrency] = useDisplayCurrency();
  const { balances, status, reload } = useBalances();
  const [showAll, setShowAll] = useState(false);

  const meta = currencyMeta(currency);
  const amount = formatBalance(balances[currency] ?? '0', meta.decimals);
  const list = pickList(balances, currency, showAll);

  return (
    <div ref={ref} className="relative">
      {/* One box, 40px tall on a 12px radius, holding both halves. The border
          and the `gohan` fill belong to it rather than to either button, and
          its 4px of end padding is what insets Deposit. */}
      <div
        className={cn(
          'flex h-10 items-center gap-2 rounded-i-md border-[0.8px] border-beerus bg-gohan',
          'ps-2 pe-1',
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`Balance, ${currency}`}
          className="group flex cursor-pointer items-center gap-2"
        >
          {/* `-m-0.5` is the reference's own: the mark DRAWS at 24px but takes
              20px of layout, which pulls the 8px gaps in either side of it and
              is the whole of the difference between a 202px box and its
              198px one. */}
          <CoinMark code={currency} className="-m-0.5" />
          {/* No `tabular-nums` on this one — the reference does not set it, and
              a lone value has nothing to line up with. The panel's column of
              balances keeps it, which is what tabular figures are for. */}
          {status === 'loading' ? (
            <Skeleton className="h-3.5 w-12 max-sm:hidden" />
          ) : (
            <span className="text-sm leading-none font-medium tracking-tight text-bulma max-sm:hidden">
              {amount}
            </span>
          )}
          <Icon
            name="chevron-down"
            size={18}
            className={cn(
              'shrink-0 text-trunks transition-transform duration-150',
              open && 'rotate-180',
            )}
          />
        </button>

        <button
          type="button"
          onClick={onOpenDeposit}
          aria-label="Deposit"
          className={cn(
            'flex h-8 cursor-pointer items-center gap-1.5 rounded-i-sm bg-piccolo px-3 text-goten',
            'transition-colors hover:bg-piccolo-80 active:bg-piccolo-120',
          )}
        >
          <Icon name="wallet" size={15} />
          {/* The label is the piece that goes on a phone, not the balance. */}
          <span className="hidden text-[13px] font-medium md:block">Deposit</span>
        </button>
      </div>

      {open && (
        <MenuPanel label="Wallet balances" className="w-[300px]">
          <MenuHeading>Balances</MenuHeading>
          <MenuDivider />

          {status === 'error' && (
            <div className="grid gap-2 px-4 py-6 text-center">
              <p className="text-sm text-bulma">Balances could not be loaded.</p>
              <button
                type="button"
                onClick={reload}
                className="cursor-pointer text-sm font-medium text-piccolo hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {status === 'loading' && (
            <div className="grid gap-1 p-2">
              {[0, 1, 2, 3].map((row) => (
                <Skeleton key={row} className="h-11 rounded-i-sm" />
              ))}
            </div>
          )}

          {status === 'ready' && (
            <>
              <ul className="grid gap-0.5 p-2">
                {list.map((code) => {
                  const row = currencyMeta(code);
                  const active = code === currency;

                  return (
                    <li key={code}>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        onClick={() => {
                          setCurrency(code);
                          close();
                        }}
                        className={cn(
                          'flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-i-sm px-2',
                          'text-start transition-colors',
                          active ? 'bg-jiren' : 'hover:bg-heles',
                        )}
                      >
                        <CoinMark code={code} size={24} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-bulma">{code}</span>
                          <span className="block truncate text-xs text-trunks">{row.name}</span>
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-bulma">
                          {formatBalance(balances[code] ?? '0', row.decimals)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <MenuDivider />
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className={cn(
                  'flex h-11 w-full cursor-pointer items-center justify-between px-4',
                  'text-sm font-medium text-bulma transition-colors hover:bg-heles',
                )}
              >
                {showAll ? 'Show fewer currencies' : 'Show all currencies'}
                <Icon
                  name="chevron-down"
                  size={16}
                  className={cn('text-trunks transition-transform duration-150', showAll && 'rotate-180')}
                />
              </button>
            </>
          )}
        </MenuPanel>
      )}
    </div>
  );
}

/**
 * The wallet control's own loading shape, for the header's middle slot while
 * the session is still being resolved. 198px is what the reference's box
 * measures holding `0.00` and a Deposit label; matching it means the slot does
 * not resize under the search field when the real control arrives.
 */
export function WalletMenuSkeleton() {
  return <Skeleton className="h-10 w-[198px] rounded-i-md max-md:w-[132px]" />;
}
