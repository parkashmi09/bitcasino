import React from 'react';
import { Switch } from './site';
import { cx } from './utils';
import { IconEdit, IconCheck } from './icons';

const chip = (v) => {
  const n = Number(v) || 0;
  if (n >= 100000 && n % 100000 === 0) return `${n / 100000}L`;
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}K`;
  return n.toLocaleString('en-US');
};

/**
 * OneClickToggle — the one-click betting switch plus its three stake chips. With one-click ON a
 * price tap places immediately at the ACTIVE chip's stake (the wiring layer decides that); this
 * component only shows and edits the state.
 *
 * @param {object}   props
 * @param {boolean}  props.enabled
 * @param {(next:boolean)=>void} props.onToggle
 * @param {number[]} props.stakes                 Exactly three values.
 * @param {number}   [props.activeStake]          Highlighted chip (must equal one of `stakes`).
 * @param {(v:number)=>void} [props.onSelectStake]
 * @param {(next:number[])=>void} [props.onStakesChange]  Omit to hide the edit pencil.
 * @param {string}   [props.label='One Click Bet']
 * @param {string}   [props.className]
 */
export default function OneClickToggle({
  enabled,
  onToggle,
  stakes = [100, 500, 1000],
  activeStake,
  onSelectStake,
  onStakesChange,
  label = 'One Click Bet',
  className = '',
}) {
  /* The draft only exists while editing — seeded at the moment the pencil is pressed, not from a
     prop at mount, so a parent that loads stakes later is never shadowed. */
  const [draft, setDraft] = React.useState(null);
  const editing = draft !== null;

  const save = () => {
    const next = draft.map((v) => Math.max(1, Math.round(Number(v) || 0)));
    onStakesChange?.(next);
    setDraft(null);
  };

  return (
    <div className={cx('rounded-xl bg-layer3 p-3', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-primary">{label}</p>
          <p className="mt-0.5 text-xs text-tertiary">
            {enabled ? 'Bets place instantly on tap' : 'Tap a price to open the slip'}
          </p>
        </div>
        <Switch value={enabled} onChange={onToggle} size="small" label={label} />
      </div>

      {enabled && (
        <div className="mt-3 flex items-center gap-2">
          <div className="grid flex-1 grid-cols-3 gap-2">
            {(editing ? draft : stakes).map((v, i) =>
              editing ? (
                <div key={i} className="input !h-9 !px-2">
                  <input
                    className="exch-num min-w-0 text-center text-sm font-extrabold"
                    inputMode="numeric"
                    value={v}
                    aria-label={`Stake ${i + 1}`}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, '');
                      setDraft((d) => d.map((x, j) => (j === i ? val : x)));
                    }}
                  />
                </div>
              ) : (
                <button
                  key={i}
                  type="button"
                  aria-pressed={Number(activeStake) === Number(v)}
                  onClick={() => onSelectStake?.(Number(v))}
                  className={cx(
                    'button h-9 rounded-lg text-sm font-extrabold transition-colors',
                    Number(activeStake) === Number(v)
                      ? 'button-brand'
                      : 'bg-layer5 text-secondary hover:bg-layer6 hover:text-primary',
                  )}
                >
                  {chip(v)}
                </button>
              ),
            )}
          </div>
          {onStakesChange && (
            <button
              type="button"
              aria-label={editing ? 'Save stakes' : 'Edit stakes'}
              onClick={editing ? save : () => setDraft(stakes.map(String))}
              className={cx(
                'flex size-9 flex-none items-center justify-center rounded-lg transition-colors',
                editing ? 'bg-button-brand' : 'bg-layer5 hover:bg-layer6',
              )}
            >
              {editing ? (
                <IconCheck className="size-4 fill-alw_dark" />
              ) : (
                <IconEdit className="size-4 fill-secondary" />
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
