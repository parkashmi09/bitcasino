import { useId } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { FIAT_DISPLAY_CURRENCIES } from '@/data/currencies';
import { BTC_UNITS, useBtcUnit, useFiatCurrency } from '@/hooks/useWallet';
import { cn } from '@/lib/cn';

/**
 * The reference's `cashier_wallet_settings`, drawn inside the wallet drawer:
 *
 *   back    the bordered 32px square chevron at the top of the cashier body
 *   title   `Wallet settings`, 20px medium, no bigger than `Active balance`
 *   rows    `Bitcoin metric prefix` with the mBTC / μBTC pill switch, and
 *           `Preferred FIAT currency` with the same listbox the settings
 *           page uses; a hairline divider; then a `Security` section whose
 *           `Add Two-factor authentication` row is real navigation, exactly
 *           like the landing page's rows are
 *
 * This is the wallet drawer's own settings step — a sibling of the landing and
 * of the transactions sheet, reachable by the `Wallet settings` row and left
 * again by its back action. It is deliberately NOT `/profile/settings`: that
 * page keeps on being the account settings, and this stays the in-cashier view
 * the reference keeps there. Both preferences persist (`bc.btc-unit`,
 * `bc.fiat` — see `useWallet.js`) and are shared, so changing them here
 * repaints whatever else reads them on the same frame.
 *
 * The switch's default is mBTC because that is the unit Bitcoin's row already
 * prints (`data/currencies.js`), so the drawer reads the same before and after
 * someone ever opens this step.
 */
export function WalletSettings({ onBack, onNavigate }) {
  const [btcUnit, setBtcUnit] = useBtcUnit();
  const [fiat, setFiat] = useFiatCurrency();
  const fiatId = useId();

  return (
    <div className="grid gap-8">
      <div className="flex items-center justify-between">
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

      <div data-testid="cashier_wallet_settings" className="grid gap-6">
        <p className="font-primary text-xl font-medium">Wallet settings</p>

        <div className="grid gap-3">
          <p className="text-base font-medium text-trunks">Currency</p>

          <div className="grid grid-cols-2 items-center gap-3 py-2">
            <p className="text-base leading-6 text-bulma">Bitcoin metric prefix</p>
            <BtcUnitSwitch value={btcUnit} onChange={setBtcUnit} />
          </div>

          <div className="grid grid-cols-2 items-center gap-3 py-2">
            <p className="text-base leading-6 text-bulma">Preferred FIAT currency</p>
            <span className="relative block w-full">
              <select
                id={fiatId}
                value={fiat}
                onChange={(event) => setFiat(event.target.value)}
                className={cn(
                  'relative z-2 m-0 block h-10 w-full max-w-full cursor-pointer appearance-none',
                  'rounded-i-md bg-goku px-4 text-base leading-10 text-bulma',
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

          <span className="border-t-[0.8px] border-beerus" />

          <p className="mt-3 text-base font-medium text-trunks">Security</p>

          <Link
            to="/profile/security"
            onClick={onNavigate}
            className={cn(
              'flex min-h-11 cursor-pointer items-center justify-between gap-2 py-2',
              'text-start transition-colors',
            )}
          >
            <span className="text-base leading-6 text-bulma">Add Two-factor authentication</span>
            <Icon name="chevron-right" size={18} className="text-trunks rtl:-scale-x-100" />
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * The reference's `Tab_Switch`: a beaded pill track with a thumb that glides
 * between the two Bitcoin units. The thumb is `calc(50% - 4px)` wide inside a
 * 4px-padded track and translates by its own width, which moves it exactly
 * onto either half no matter the track's size.
 */
function BtcUnitSwitch({ value, onChange }) {
  const selected = BTC_UNITS.indexOf(value);

  return (
    <div
      role="radiogroup"
      aria-label="Bitcoin metric prefix"
      data-testid="metric_prefix_switch"
      className="relative flex w-fit rounded-full bg-goku p-1"
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-1 start-1 w-[calc(50%-0.25rem)] rounded-full bg-gohan',
          'shadow-sm transition-transform duration-200 ease-out',
        )}
        style={{ transform: `translateX(${selected * 100}%)` }}
      />
      {BTC_UNITS.map((unit) => {
        const active = unit === value;
        return (
          <button
            key={unit}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(unit)}
            className={cn(
              'relative z-10 cursor-pointer py-2.5 pe-3 ps-3 text-sm font-medium whitespace-nowrap',
              'transition-colors',
              active ? 'text-bulma' : 'text-trunks hover:text-bulma',
            )}
          >
            {unit}
          </button>
        );
      })}
    </div>
  );
}