import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { MenuPanel } from './HeaderMenu';
import { usePopover } from '@/hooks/usePopover';
import { useBalances, useDisplayCurrency } from '@/hooks/useWallet';
import { CURRENCY_ORDER, currencyMeta } from '@/data/currencies';
import { walletBalance } from '@/lib/format';
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
 * the way to the screen (`walletBalance`). It is never invented and never
 * parsed — two places in the currency's DISPLAY unit, which is the reference's
 * own wallet denomination and why a Bitcoin balance reads `0.00 mBTC` here
 * rather than `0.00000000`. A wallet that has not answered yet shows a
 * skeleton rather than a zero, because a false zero beside a real account is
 * worse than no number.
 *
 * ## What goes at narrow widths
 *
 * The Deposit LABEL drops at `md`, leaving its glyph — that is the reference's
 * own `hidden md:block`, and it is the opposite of the obvious choice, since
 * the balance is why a player looks at the header at all.
 *
 * The amount goes at **389px**, not at `sm`, and the number is measured rather
 * than picked. This header's three slots need
 *
 *   32 padding + 78 brand + 144 wallet + 132 actions = 386px
 *
 * with the amount in, and 356 without it. Below 386 the brand block is the
 * piece that gives — it is `min-w-0 flex-1` and its 40px hamburger will not
 * shrink, so it stops shrinking and starts sitting UNDER the wallet box. So
 * the amount shows from 400px up, which covers every phone from an iPhone 12
 * onwards, and leaves 14px for a balance wider than `0.00`.
 *
 * That is still not the reference, which keeps the amount to its narrowest
 * width — it can afford to, because its phone header holds four things where
 * this one holds six: its search and its nav trigger live in a bottom tab bar
 * this project does not have. Below 400px the number is one tap away, in the
 * panel this button already opens.
 *
 * ## The panel
 *
 * Measured off a screenshot of the reference's own phone panel — pixel runs
 * read from the image rather than eyeballed, because the panel cannot be
 * framed and the account it belongs to is not ours. The screenshot is 277px
 * wide against a 40px header control that measures 26px in it, so everything
 * below is image pixels ÷ 0.644, and the source viewport works out at ~430px:
 *
 *   panel      360px wide, radius 8px, `goku`, top hairline, NO side border
 *              — centred in the viewport, not anchored to this trigger
 *   height     568px of an 877px viewport, i.e. it stops well short of the
 *              fold: `min(65dvh, 36rem)` is that cap at both readings
 *   list       16px gutter, rows 40px on a 4px pitch
 *   row        `gohan` fill on an 8px radius, 8px inner gutter, 24px coin,
 *              12px gap, one line of `Name (CODE)`, the amount at the end
 *   selected   a `piccolo` hairline round the row — the fill does NOT change
 *   footer     48px, a 20px gutter, `Hide 0 balances` in `trunks` and a
 *              44x24 switch, and it does not scroll with the list
 *
 * There is no heading: the first row starts 18px under the panel's own top
 * edge, where a 48px `Balances` band used to be here.
 *
 * ## Why it is centred below `sm`
 *
 * This is the ONE header control that does not live in the actions slot — it
 * sits in the middle one, between the two `flex-1` halves — so a card anchored
 * `end-0` to it hangs off the LEFT of the screen, not the right: it measured
 * `x = -162` on a 215px viewport, two thirds of the list outside the window
 * with no way to scroll to it. The reference's is centred in the viewport
 * (23px and 19px of image either side of a 235px card), which is what a
 * dropdown looks like once it is wider than the room its trigger leaves.
 *
 * So below `sm` the panel is `MenuPanel`'s `sheet` — `fixed`, so it measures
 * against the viewport rather than the header — pulled back to the middle with
 * `start-1/2 -translate-x-1/2` and narrowed to `100vw - 40px` where 360 will
 * not fit. From `sm` up it is the 360px card anchored to the trigger, which is
 * where the reference's sits too.
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
 * Which coins the picker offers: ALL of them, which is what the reference's
 * panel lists — twelve rows visible on a phone and the rest under the scroll.
 * There is no `Show all currencies` step on the reference and there is none
 * here; the only filter is its `Hide 0 balances` switch, and that is off by
 * default.
 *
 * The selected currency survives the filter. Every balance on a new account is
 * zero, so a strict filter empties the panel the moment the switch goes on and
 * takes the row saying which currency you are actually on with it.
 */
function pickList(balances, selected, hideZero) {
  if (!hideZero) return CURRENCY_ORDER;

  return CURRENCY_ORDER.filter(
    (code) => code === selected || /[1-9]/.test(String(balances[code] ?? '')),
  );
}

export function WalletMenu({ onOpenDeposit }) {
  const { open, toggle, close, ref } = usePopover();
  const [currency, setCurrency] = useDisplayCurrency();
  const { balances, status, reload } = useBalances();
  // Lives out here rather than in the panel: the panel unmounts on close, and
  // a filter that reset every time you looked at it would be a switch that
  // never stays where it was put.
  const [hideZero, setHideZero] = useState(false);

  const meta = currencyMeta(currency);
  const balance = walletBalance(balances[currency] ?? '0', meta);
  const list = pickList(balances, currency, hideZero);

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
            <Skeleton className="h-3.5 w-12 max-[399px]:hidden" />
          ) : (
            <span className="text-sm leading-none font-medium tracking-tight text-bulma max-[399px]:hidden">
              {balance.amount}
              {balance.unit && <span className="text-trunks"> {balance.unit}</span>}
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

      {/* The panel, measured off the reference's own phone screenshot — see
          the note above the component. */}
      {open && (
        <MenuPanel
          label="Wallet balances"
          sheet
          className={cn(
            'flex flex-col overflow-y-hidden rounded-i-sm',
            'max-h-[min(65dvh,36rem)] w-[min(360px,calc(100vw-40px))]',
            'max-sm:start-1/2 max-sm:end-auto max-sm:-translate-x-1/2',
            'sm:w-[360px]',
          )}
        >
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
            <div className="grid gap-1 p-4">
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <Skeleton key={row} className="h-10 rounded-i-sm" />
              ))}
            </div>
          )}

          {status === 'ready' && (
            <>
              {/* The list is the only part that scrolls, so the switch below
                  stays put while it does — the reference's own phone panel
                  clips a row against a footer that does not move.

                  `min-h-0` because a flex child's floor is its content height:
                  without it the column grows past the panel's `max-h` and puts
                  the footer off the bottom of the screen instead of scrolling.
                  `grid-cols-1` is `minmax(0, 1fr)`, where a bare `grid` sizes
                  its one column to max-content — which gives the panel a
                  HORIZONTAL scrollbar and clips the balances the moment it is
                  narrower than a row. */}
              <ul className="grid min-h-0 flex-1 grid-cols-1 gap-1 overflow-y-auto p-4">
                {list.map((code) => {
                  const row = currencyMeta(code);
                  const active = code === currency;
                  const held = walletBalance(balances[code] ?? '0', row);

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
                          'flex h-10 w-full cursor-pointer items-center gap-3 rounded-i-sm px-2',
                          // The transparent border is `Button.jsx`'s trick, and
                          // it is what keeps the selected row exactly as tall
                          // as the eleven others instead of 2px taller.
                          'border border-transparent bg-gohan text-start transition-colors',
                          active ? 'border-piccolo' : 'hover:bg-heles',
                        )}
                      >
                        <CoinMark code={code} size={24} />
                        <span className="min-w-0 flex-1 truncate text-sm text-bulma">
                          {row.name} ({code})
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-bulma">
                          {held.amount}
                          {held.unit && <span className="text-trunks"> {held.unit}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {/* 48px, and its 20px gutter is wider than the list's 16px —
                  both measured, and the difference is the reference's. */}
              <div className="flex h-12 shrink-0 items-center justify-between gap-3 px-5">
                <span className="text-sm text-trunks">Hide 0 balances</span>
                <Switch
                  checked={hideZero}
                  onChange={setHideZero}
                  label="Hide 0 balances"
                />
              </div>
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
