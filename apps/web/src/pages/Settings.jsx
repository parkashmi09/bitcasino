import { useId, useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import {
  CURRENCY_ORDER,
  FIAT_DISPLAY_CURRENCIES,
  currencyMeta,
} from '@/data/currencies';
import { useDisplayCurrency, useFiatCurrency } from '@/hooks/useWallet';
import { usePreferences } from '@/hooks/usePreferences';
import { cn } from '@/lib/cn';

/**
 * `/profile/settings`.
 *
 * The shortest page in the account area: two currency preferences and three
 * subscription switches, in a 430px column on the page background. No card —
 * unlike Account, nothing here sits on `gohan` except the wallet row itself.
 *
 * Every number below was read off `bitcasino.io/profile/settings`, with
 * `getBoundingClientRect` and `getComputedStyle` on each piece, by the
 * procedure in `docs/11-comparing-against-the-reference.md`:
 *
 *   column        `grid gap-2 max-w-[430px]`
 *   heading       24px/32, weight 400, `bulma`, at y=154 — FLUSH against the
 *                 tab bar, like Notifications and unlike Account's y=162
 *   wallet label  16px/24 `bulma`, and NO gap under it
 *   wallet row    40px, `gohan`, 6px radius, value and button pushed apart
 *   value         16px/24, 16px in from the start edge
 *   button        40px, transparent over a 1px `trunks` INSET ring, 8px
 *                 radius, 16px pad, 16px/24 medium, `heles` on hover with the
 *                 ring going to `bulma`, and a 200ms `scale-90` on press
 *   fiat label    16px/24, 8px above its control — the one label here that
 *                 has a gap, because it is a real `<label>` in a field group
 *   fiat select   40px, `goku`, 6px radius, a 1px `beerus` INSET ring, 16px
 *                 pad, `appearance-none` under a 20px chevron inset 12px
 *   blurb         16px/24, two lines at this width
 *   switch row    24px tall, 8px apart, a 16px box 8px from its label
 *   box           4px radius, 0.8px `beerus`, filling `piccolo` when ticked
 *
 * The heading sits flush and the three blocks are 8px apart, so the whole
 * page is one `gap-2` column — which is why the wallet block's label carries
 * no gap of its own and the fiat block's does. Reproduced rather than
 * regularised: they are two different components on the reference and the 8px
 * difference is visible.
 *
 * ## What is real
 *
 * `Active wallet` is this app's own display currency, the one the header chip
 * and the deposit drawer read — `useDisplayCurrency`, shared, so changing it
 * here repaints the header on the same frame. `Email` is a real
 * `PATCH /user/preferences`. The FIAT preference drives the footer's
 * `1 USDT = …` pair against real rates from
 * `GET /user/exchange-rate/rates`.
 *
 * `SMS` and `Call` have no column on the platform and persist in the browser;
 * `usePreferences` holds that seam and names both sides of it.
 *
 * ## `Change Currency` swaps the row rather than opening a picker
 *
 * The reference's button opens a modal this project does not have a twin for —
 * its wallet modal is a different surface from this app's deposit drawer, and
 * building a second currency picker to sit in front of a store the header
 * already edits would be two pickers for one value. Pressing it here turns the
 * read-only value into a select in the same 40px row; choosing commits and
 * turns it back. Same control, same geometry, one picker. `docs/11` records it.
 */
export function Settings() {
  const [currency, setCurrency] = useDisplayCurrency();
  const [fiat, setFiat] = useFiatCurrency();
  const { switches, status, toggle, saveError } = usePreferences();

  const [changing, setChanging] = useState(false);
  const fiatId = useId();

  return (
    <div className="grid max-w-[430px] gap-2">
      <h1 className="font-primary text-2xl font-normal tracking-normal text-bulma">
        Settings
      </h1>

      {/* Active wallet. The label carries no bottom gap — see the note above. */}
      <div className="w-full">
        <p className="text-base leading-6 text-bulma">Active wallet</p>

        <div className="flex h-10 items-center justify-between gap-2 rounded-md bg-gohan">
          {changing ? (
            <select
              // `autoFocus` because the press that revealed this select was the
              // player asking to change the value; landing them on the control
              // is the whole point of the press.
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              aria-label="Active wallet"
              value={currency}
              onChange={(event) => {
                setCurrency(event.target.value);
                setChanging(false);
              }}
              onBlur={() => setChanging(false)}
              className={cn(
                'h-10 min-w-0 flex-1 cursor-pointer appearance-none rounded-md bg-transparent',
                'ps-4 pe-2 text-base leading-6 text-bulma outline-none',
              )}
            >
              {CURRENCY_ORDER.map((code) => (
                <option key={code} value={code}>
                  {code} — {currencyMeta(code).name}
                </option>
              ))}
            </select>
          ) : (
            <span className="min-w-0 truncate ps-4 text-base leading-6 text-bulma">
              {currency}
            </span>
          )}

          <button
            type="button"
            onClick={() => setChanging((open) => !open)}
            aria-expanded={changing}
            className={cn(
              'flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-i-sm px-4 py-2',
              'text-base leading-6 font-medium whitespace-nowrap text-bulma',
              'bg-transparent ring-1 ring-trunks ring-inset',
              'transition duration-200 hover:bg-heles hover:ring-bulma active:scale-90',
            )}
          >
            Change Currency
          </button>
        </div>
      </div>

      {/* Preferred FIAT currency. `appearance-none` under an overlaid chevron
          is the same idiom the footer's language select uses. */}
      <div>
        <label
          htmlFor={fiatId}
          className="flex items-center gap-2 pb-2 text-base leading-6 text-bulma select-none"
        >
          Preferred FIAT currency
        </label>

        <span className="relative block w-full">
          <select
            id={fiatId}
            value={fiat}
            onChange={(event) => setFiat(event.target.value)}
            className={cn(
              'relative z-2 m-0 block h-10 w-full max-w-full cursor-pointer appearance-none',
              'rounded-md bg-goku px-4 text-base leading-10 text-bulma',
              'shadow-[inset_0_0_0_1px_var(--color-beerus)] transition-shadow outline-none',
              'focus:shadow-[inset_0_0_0_1px_var(--color-piccolo)]',
            )}
          >
            {FIAT_DISPLAY_CURRENCIES.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {entry.code}
              </option>
            ))}
          </select>
          <Icon
            name="chevron-down"
            size={20}
            className="pointer-events-none absolute top-1/2 z-3 end-3 -translate-y-1/2 text-bulma"
          />
        </span>
      </div>

      {/* Subscriptions. `list-none` on the reference; a plain grid here, since
          three switches are a form and not a list. */}
      <div className="grid gap-2">
        <p className="text-base leading-6 text-bulma">
          Enjoy exclusive offers: Make sure to receive deposit offers and bonuses
          that are only available to subscribers!
        </p>

        <Switch
          label="Email"
          checked={switches.email}
          disabled={status !== 'ready'}
          onChange={(next) => toggle('email', next)}
        />
        <Switch label="SMS" checked={switches.sms} onChange={(next) => toggle('sms', next)} />
        <Switch label="Call" checked={switches.call} onChange={(next) => toggle('call', next)} />

        {/* The reference says nothing when a switch fails to save. `Email` is
            a real round trip here, and a box that silently flips back is worse
            than a line of text saying why. `docs/11` records the addition.

            `empty:hidden` rather than a reserved `min-h`: an always-present
            line would add its own height AND the column's 8px gap, which puts
            this block 28px over the 144px the reference measures. Hidden while
            empty, it takes nothing and the page is the reference's. */}
        <p aria-live="polite" className="text-sm leading-5 text-chichi empty:hidden">
          {saveError ? (saveError.message ?? 'Could not save that. Please try again.') : ''}
        </p>
      </div>
    </div>
  );
}

/**
 * One subscription switch.
 *
 * A real `<input type="checkbox">` rather than the reference's `<button>`: the
 * box is `appearance-none` and styled directly, so it keeps the native
 * keyboard contract and the label association for free, and `peer-checked:`
 * paints the tick over it. The reference's button has to reimplement both, and
 * there is nothing to gain by copying that.
 *
 * The tick is `pointer-events-none` so a click anywhere on the 16px box lands
 * on the input under it rather than on the glyph.
 */
function Switch({ label, checked, onChange, disabled }) {
  return (
    <label
      className={cn(
        'flex items-center gap-2 select-none',
        disabled ? 'cursor-default opacity-60' : 'cursor-pointer',
      )}
    >
      <span className="relative grid size-4 shrink-0 place-items-center">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className={cn(
            'peer size-4 cursor-pointer appearance-none rounded-[4px]',
            // The border stays `beerus` when ticked — the reference keeps its
            // hairline under the fill rather than swapping it to `piccolo`,
            // and at 0.8px on an orange box it reads as a soft edge.
            'border-[0.8px] border-beerus bg-goku transition-colors',
            'checked:bg-piccolo disabled:cursor-default',
          )}
        />
        <Icon
          name="check"
          size={12}
          strokeWidth={3}
          className="pointer-events-none absolute text-goten opacity-0 peer-checked:opacity-100"
        />
      </span>
      <span className="text-base leading-6 text-bulma">{label}</span>
    </label>
  );
}
