import React from 'react';
import { DialogShell } from './site';
import { cx } from './utils';
import './exchange.css';

/**
 * StakeButtonsModal — edit the user's quick-stake buttons (6–8 values) in the site's DialogShell.
 * Mount it only while open (`{open && <StakeButtonsModal …/>}`): the draft is seeded once, at
 * mount, from `values`.
 *
 * @param {object}   props
 * @param {number[]} props.values                6–8 current values.
 * @param {(next:number[])=>void|Promise} props.onSave   Called with the numbers in the same order (whole unless `allowDecimals`).
 * @param {()=>void} props.onClose
 * @param {number}   [props.min=1]               Each value must be ≥ min.
 * @param {number}   [props.max]                 …and ≤ max when given.
 * @param {boolean}  [props.saving]              Disables the form and shows "Saving…".
 * @param {string|null} [props.error]            Server-side error under the grid.
 * @param {string}   [props.title='Edit Stakes']
 * @param {string}   [props.currency]            Prefix inside each input, like the slip's stake ("₹", "USDT").
 * @param {string}   [props.currencyName]        Named in the intro line ("Amounts are in USDT.").
 * @param {boolean}  [props.allowDecimals]       Accept "12.5" (a coin worth more than a rupee);
 *                                               otherwise whole numbers only, as before.
 */
export default function StakeButtonsModal({
  values = [],
  onSave,
  onClose,
  min = 1,
  max,
  saving = false,
  error = null,
  title = 'Edit Stakes',
  currency = '',
  currencyName,
  allowDecimals = false,
}) {
  const [draft, setDraft] = React.useState(() => values.map((v) => String(v)));

  const invalid = draft.map((v) => {
    const n = Number(v);
    return !v || !Number.isFinite(n) || n < min || (max != null && n > max);
  });
  const anyInvalid = invalid.some(Boolean);

  return (
    <DialogShell title={title} onClose={onClose} size="lg:!h-[30rem]">
      <div className="pb-4 pt-2">
        <p className="text-xs text-tertiary">
          These amounts appear as quick-stake buttons on the bet slip.
          {currencyName && <> Amounts are in <span className="font-semibold text-secondary">{currencyName}</span>.</>}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
          {draft.map((v, i) => (
            <label key={i} className="block">
              <span className="input-label !mb-1 !mt-0 block text-xs">Stake {i + 1}</span>
              <span
                className={cx('input !h-10', invalid[i] && '!border-error')}
                data-disabled={saving || undefined}
              >
                {currency && <span className="flex-none text-sm text-tertiary">{currency}</span>}
                <input
                  className="exch-num min-w-0 text-sm font-extrabold"
                  inputMode={allowDecimals ? 'decimal' : 'numeric'}
                  value={v}
                  disabled={saving}
                  onChange={(e) => {
                    const raw = e.target.value;
                    const val = allowDecimals ? raw.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1') : raw.replace(/\D/g, '');
                    setDraft((d) => d.map((x, j) => (j === i ? val : x)));
                  }}
                />
              </span>
            </label>
          ))}
        </div>
        {(anyInvalid || error) && (
          <p role="alert" className="mt-3 text-xs text-error">
            {error ?? `Each stake must be at least ${min}${max != null ? ` and at most ${max}` : ''}.`}
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="button button-second button-m flex-1 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || anyInvalid}
            onClick={() => onSave?.(draft.map((v) => (allowDecimals ? Number(v) : Math.round(Number(v)))))}
            className="button button-brand button-m flex-1 text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}
