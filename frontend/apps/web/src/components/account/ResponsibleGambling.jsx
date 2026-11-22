import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { useResponsibleAction, useResponsibleGambling } from '@/queries/account';
import { formatBalance } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * Settings → Responsible gambling (`/user/responsible-gambling`): the player's own breaks and
 * limits. Every write only makes the account safer — a break cannot be shortened, and a removed
 * limit keeps applying for 12 hours — so each control says so before it is pressed.
 *
 * A break is two steps on the backend: a fixed 24-hour cooldown first, then the length. A
 * PLATFORM break also refuses sign-in until it ends.
 */

const TYPES = [
  ['CASINO', 'Casino'],
  ['SPORTS', 'Sports'],
  ['PLATFORM', 'Whole account'],
];
const TYPE_LABEL = Object.fromEntries(TYPES);

/** backend responsible.constants.js BREAK_PERIODS, in order. */
const BREAKS = ['1 day', '1 week', '1 month', '6 months', '1 year', '2 years', '3 years', '5 years', '10 years', 'permanent'];

const LIMITS = [
  ['LOSS_LIMIT', 'Loss limit'],
  ['WAGER_LIMIT', 'Wager limit'],
];
const LIMIT_LABEL = Object.fromEntries(LIMITS);
const PERIODS = [
  ['DAYS', 'Daily'],
  ['WEEKS', 'Weekly'],
  ['MONTHS', 'Monthly'],
];
const PERIOD_LABEL = Object.fromEntries(PERIODS);

const SELECT =
  'h-10 w-full cursor-pointer appearance-none rounded-md bg-goku px-4 text-base text-bulma shadow-[inset_0_0_0_1px_var(--color-beerus)] outline-none focus:shadow-[inset_0_0_0_1px_var(--color-piccolo)]';

export function ResponsibleGambling() {
  const { data, isPending, isError, refetch } = useResponsibleGambling();
  const exclusions = data?.selfExclusions ?? [];
  const limits = data?.limits ?? [];

  return (
    <section className="grid gap-4 pt-6" aria-labelledby="rg-heading">
      <h2 id="rg-heading" className="font-primary text-xl leading-7 font-normal tracking-normal text-bulma">
        Responsible gambling
      </h2>

      {isPending ? (
        <Skeleton className="h-24 rounded-md" />
      ) : isError ? (
        <p className="text-sm text-trunks">
          Could not load your limits.{' '}
          <button type="button" onClick={() => refetch()} className="cursor-pointer text-piccolo hover:underline">
            Try again
          </button>
        </p>
      ) : (
        <>
          {(exclusions.length > 0 || limits.length > 0) && (
            <ul className="grid gap-2">
              {exclusions.map((row) => (
                <ExclusionRow key={row.id} row={row} />
              ))}
              {limits.map((row) => (
                <LimitRow key={row.id} row={row} />
              ))}
            </ul>
          )}
          <BreakForm exclusions={exclusions} />
          <LimitForm limits={limits} />
        </>
      )}
    </section>
  );
}

function ExclusionRow({ row }) {
  const cooling = Boolean(row.selfExclusionCooldownUntilAt);
  return (
    <li className="grid gap-0.5 rounded-md bg-gohan px-4 py-3">
      <span className="text-base leading-6 text-bulma">
        {cooling ? 'Cooldown' : 'Break'} · {TYPE_LABEL[row.selfExclusionType] ?? row.selfExclusionType}
      </span>
      <span className="text-xs leading-4 text-trunks">
        {formatWhen(row.selfExclusionUntilAt) === 'permanent' ? 'Permanent' : `Until ${formatWhen(row.selfExclusionUntilAt)}`}
      </span>
    </li>
  );
}

function LimitRow({ row }) {
  const action = useResponsibleAction();
  const ending = Boolean(row.expiredAt);
  return (
    <li className="flex items-center justify-between gap-3 rounded-md bg-gohan px-4 py-3">
      <span className="grid min-w-0 gap-0.5">
        <span className="text-base leading-6 text-bulma">
          {PERIOD_LABEL[row.periodUnit] ?? ''} {(LIMIT_LABEL[row.type] ?? row.type).toLowerCase()}
        </span>
        <span className="text-xs leading-4 text-trunks tabular-nums">
          {formatBalance(row.progressAmount ?? '0')} / {formatBalance(row.usdAmount)} USD · resets {formatWhen(row.resetsAt)}
        </span>
        {ending && <span className="text-xs leading-4 text-krillin">Ends {formatWhen(row.expiredAt)}</span>}
      </span>
      {!ending && (
        <Button
          variant="outline"
          size="sm"
          disabled={action.isPending}
          onClick={() => action.mutate({ kind: 'remove', id: row.id })}
        >
          Remove
        </Button>
      )}
    </li>
  );
}

/** Step 1 (24-hour cooldown) until a cooldown is running, then step 2 (the length). */
function BreakForm({ exclusions }) {
  const action = useResponsibleAction();
  const [type, setType] = useState('CASINO');
  const [period, setPeriod] = useState('1 week');
  const [sure, setSure] = useState(false);
  const typeId = useId();
  const periodId = useId();
  const cooling = exclusions.some((row) => row.selfExclusionCooldownUntilAt);

  function submit(event) {
    event.preventDefault();
    if (!sure) return setSure(true);
    action.mutate(
      cooling ? { kind: 'break', type, breakPeriod: period } : { kind: 'cooldown', type },
      { onSettled: () => setSure(false) },
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-md bg-gohan p-4">
      <p className="text-base leading-6 text-bulma">Take a break</p>
      <p className="text-xs leading-4 text-trunks">
        {cooling
          ? 'Your cooldown is running. Choose how long the break lasts. It cannot be shortened or removed.'
          : 'A break starts with a 24-hour cooldown, then you choose its length. A whole-account break also stops you signing in.'}
      </p>
      <Field id={typeId} label="Covers">
        <select id={typeId} value={type} onChange={(e) => setType(e.target.value)} className={SELECT}>
          {TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {cooling && (
        <Field id={periodId} label="Length">
          <select id={periodId} value={period} onChange={(e) => setPeriod(e.target.value)} className={SELECT}>
            {BREAKS.map((value) => (
              <option key={value} value={value}>
                {value === 'permanent' ? 'Permanent' : value}
              </option>
            ))}
          </select>
        </Field>
      )}
      <ActionError action={action} />
      <Button type="submit" variant={sure ? 'primary' : 'secondary'} disabled={action.isPending} className="text-base">
        {sure ? 'Confirm, this cannot be undone' : cooling ? 'Start break' : 'Start 24-hour cooldown'}
      </Button>
    </form>
  );
}

function LimitForm({ limits }) {
  const action = useResponsibleAction();
  const free = LIMITS.filter(([value]) => !limits.some((row) => row.type === value && !row.expiredAt));
  const [type, setType] = useState(free[0]?.[0] ?? 'LOSS_LIMIT');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState('DAYS');
  const typeId = useId();
  const amountId = useId();
  const unitId = useId();
  const chosen = free.some(([value]) => value === type) ? type : free[0]?.[0];

  if (free.length === 0) return null;

  function submit(event) {
    event.preventDefault();
    action.mutate({ kind: 'limit', type: chosen, usdAmount: amount, periodUnit: unit }, { onSuccess: () => setAmount('') });
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-md bg-gohan p-4">
      <p className="text-base leading-6 text-bulma">Set a limit</p>
      <p className="text-xs leading-4 text-trunks">
        Stakes that would go over it are refused. Removing a limit takes 12 hours.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Field id={typeId} label="Limit">
          <select id={typeId} value={chosen} onChange={(e) => setType(e.target.value)} className={SELECT}>
            {free.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field id={unitId} label="Period">
          <select id={unitId} value={unit} onChange={(e) => setUnit(e.target.value)} className={SELECT}>
            {PERIODS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field id={amountId} label="Amount (USD)">
        <input
          id={amountId}
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          inputMode="decimal"
          placeholder="0.00"
          className={cn(SELECT, 'cursor-text tabular-nums')}
        />
      </Field>
      <ActionError action={action} />
      <Button type="submit" variant="secondary" disabled={!/[1-9]/.test(amount) || action.isPending} className="text-base">
        Set limit
      </Button>
    </form>
  );
}

function Field({ id, label, children }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm leading-5 text-trunks">
        {label}
      </label>
      <span className="relative block">
        {children}
        {children.type === 'select' && (
          <Icon name="chevron-down" size={20} className="pointer-events-none absolute top-1/2 end-3 -translate-y-1/2 text-bulma" />
        )}
      </span>
    </div>
  );
}

function ActionError({ action }) {
  if (!action.isError) return null;
  return (
    <p role="alert" className="text-sm leading-5 text-chichi">
      {action.error?.message || 'That was refused. Please try again.'}
    </p>
  );
}

function formatWhen(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  // Anything over a century out is the backend's "permanent".
  if (date.getFullYear() - new Date().getFullYear() > 100) return 'permanent';
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
