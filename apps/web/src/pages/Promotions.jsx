import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/auth/AuthProvider';
import { useBonusEvents, useSpin, useSpinEligibility, useSpinSlices } from '@/queries';
import { cn } from '@/lib/cn';

/**
 * `/promotions` — the spin wheel, and whatever the operator has scheduled.
 *
 * ## The platform has no scheduled promotions, and the page says so
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THIS PAGE USED TO CLAIM ONE EXISTED AND WAS MERELY EMPTY.
 *
 * `docs/10`'s Phase 7 bullet reads `GET /user/bonus/events` as the
 * operator's scheduled promotions, and this page was built on that: a
 * "Running now" panel listing `{name, description, startDate, endDate}`,
 * with an empty state saying nothing had been scheduled yet.
 *
 * The route is the caller's own `bonushistory` — `{id, event, amount,
 * createdAt}`, a log of bonuses already PAID. None of the four fields the
 * panel rendered exists on it, and there is no scheduled-promotions table
 * anywhere on this platform to read instead. The mistake survived because
 * the log is empty on this deployment, so the empty state was the only
 * thing anyone saw; one paid bonus would have produced a list of headings
 * reading "Promotion" over blank date ranges.
 *
 * So the panel is now the player's bonus history under its own name, and
 * the gap is stated on the page. An operator-run promotion with a window
 * is a migration and an admin screen, not something to imply by rendering
 * an empty list under an optimistic heading.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * What IS real here: `GET /user/spin-wheel/slices` (public, eight
 * configured segments) and the wheel that spins them.
 *
 * `docs/10` also lists banners as a source for this page. They are not one:
 * a banner row is an image and a placement type with no title, no blurb and
 * no destination, so it cannot describe a promotion. See `HomeBanner.jsx`.
 */
export function Promotions() {
  return (
    <div className="py-4">
      <h1 className="font-secondary text-2xl font-normal text-bulma">Promotions</h1>
      <p className="mt-1 text-sm text-trunks">
        The wheel, and every bonus this account has been paid.
      </p>

      <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_380px]">
        <BonusHistoryPanel />
        <SpinWheelCard />
      </div>
    </div>
  );
}

/**
 * The player's own bonus log.
 *
 * Player-scoped — it is their history, not a catalogue — so a signed-out
 * visitor gets an invitation rather than a 401 rendered as an error.
 */
function BonusHistoryPanel() {
  const { status } = useAuth();
  const { data, isPending, isError } = useBonusEvents({ limit: 20 });

  const events = data?.events ?? [];

  if (status !== 'authenticated') {
    return (
      <Panel title="Your bonuses">
        <p className="text-sm leading-relaxed text-trunks">
          Bonuses are paid per account, so this list needs you signed in.
        </p>
        <Button as={Link} to="/login" className="mt-3 w-max">
          Log in
        </Button>
      </Panel>
    );
  }

  if (isPending) {
    return (
      <Panel title="Your bonuses">
        <div className="grid gap-2">
          {[0, 1].map((row) => (
            <Skeleton key={row} className="h-20 rounded-i-sm" />
          ))}
        </div>
      </Panel>
    );
  }

  if (isError) {
    return (
      <Panel title="Your bonuses">
        <p className="text-sm text-trunks">
          Could not load your bonuses. Reload the page to try again.
        </p>
      </Panel>
    );
  }

  if (events.length === 0) {
    return (
      <Panel title="Your bonuses">
        {/* Deliberately specific. "Check back soon" is what a broken fetch
            would also say; this says which mechanism is empty. */}
        <p className="text-sm leading-relaxed text-trunks">
          No bonus has been paid to this account yet. Every one that is shows
          up here with what it was and what it paid.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-trunks">
          The wheel beside this is always available, and the{' '}
          <Link to="/vip" className="text-piccolo hover:underline">
            VIP club
          </Link>{' '}
          pays daily, weekly and monthly by level.
        </p>
      </Panel>
    );
  }

  return (
    <Panel title="Your bonuses">
      <ul className="grid gap-2">
        {events.map((event) => (
          <li
            key={event.id}
            className="flex items-baseline justify-between gap-4 rounded-i-sm bg-goku px-4 py-3"
          >
            <div>
              <h3 className="text-sm font-medium text-bulma">{event.name}</h3>
              <p className="mt-1 text-xs text-trunks tabular-nums">{formatPaidAt(event.at)}</p>
            </div>
            {/* A decimal string, printed as one. `bonushistory.amount` is
                `NUMERIC` and carries no currency column, so there is no code
                to put beside it — inventing one would label a sum in a coin
                nobody said it was paid in. */}
            <span className="shrink-0 font-secondary text-sm font-bold text-roshi tabular-nums">
              +{event.amount}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/**
 * The spin wheel.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * A SPIN PAYS A BONUS PERCENTAGE ON THE NEXT DEPOSIT. IT IS NOT A CREDIT.
 *
 * `spinWheel.service.js` says so at its own return: "the percentage is
 * applied to the next deposit, so no money moves here". The reply is a
 * `redeemCode` and a `rewardPct`, and the balance is untouched.
 *
 * So this screen never says "you won 20 USDT", and never puts a figure next
 * to the wallet. It says what the code is worth and what it is for. A player
 * who read "you won" here and then checked their balance would find nothing,
 * which is the one outcome a promotions page must not produce.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * The segments are public and the odds are not: the weights are stripped from
 * the public route, so this draws the wheel's *shape* and never implies a
 * probability from it.
 */
function SpinWheelCard() {
  const { status } = useAuth();
  const { data, isPending } = useSpinSlices();
  const eligibility = useSpinEligibility();
  const spin = useSpin();

  const [result, setResult] = useState(null);

  const slices = data?.slices ?? [];
  const disabled = Boolean(data?.disabled);
  const signedIn = status === 'authenticated';

  const go = async () => {
    setResult(null);
    try {
      setResult(await spin.mutateAsync());
    } catch {
      // `spin.error` carries it and the panel renders from that.
    }
  };

  return (
    <Panel title="Spin the wheel">
      {isPending ? (
        <Skeleton className="mx-auto size-48 rounded-full" />
      ) : disabled || slices.length === 0 ? (
        <p className="text-sm leading-relaxed text-trunks">
          {/* `disabled: true` is the operator's own switch, not a fault. */}
          The wheel is switched off at the moment.
        </p>
      ) : (
        <>
          <Wheel slices={slices} />

          <p className="text-xs leading-relaxed text-trunks">
            Each segment is a bonus percentage applied to your{' '}
            <strong className="font-medium text-bulma">next deposit</strong> — a
            spin issues a code, it does not credit your balance.
          </p>

          {!signedIn ? (
            <Button as={Link} to="/login" fullWidth>
              Log in to spin
            </Button>
          ) : result ? (
            <SpinResult result={result} onAgain={() => setResult(null)} />
          ) : (
            <>
              <Button
                fullWidth
                onClick={go}
                disabled={spin.isPending || eligibility.data?.eligible === false}
              >
                {spin.isPending
                  ? 'Spinning…'
                  : eligibility.data?.firstSpin
                    ? 'Take your free spin'
                    : 'Spin'}
              </Button>

              {eligibility.data?.eligible === false && (
                <p className="text-xs leading-relaxed text-trunks">
                  {/* The two reasons a spin is refused are different problems
                      with different fixes, and the eligibility read tells them
                      apart before the player presses anything. */}
                  {eligibility.data.nextEligibleAt
                    ? `You can spin again ${formatWhen(eligibility.data.nextEligibleAt)}.`
                    : 'A qualifying deposit is needed before your next spin.'}
                </p>
              )}

              {spin.isError && (
                <p role="alert" className="rounded-i-sm bg-dodoria/10 px-3 py-2 text-xs text-bulma">
                  {spin.error?.message || 'The spin was refused.'}
                </p>
              )}
            </>
          )}
        </>
      )}
    </Panel>
  );
}

/**
 * The wheel itself, as an SVG of equal segments.
 *
 * **Equal segments, and that is the honest drawing.** The public route strips
 * the weights, so this client does not know the odds — and sizing a segment
 * by anything else would imply a probability it cannot support. The colours
 * are the operator's own, from the row.
 */
function Wheel({ slices }) {
  const step = 360 / slices.length;

  return (
    <div className="mx-auto grid w-max place-items-center">
      <svg viewBox="-1 -1 2 2" className="size-48 -rotate-90" role="img" aria-label="Prize wheel">
        {slices.map((slice, index) => (
          <path
            key={slice.id ?? index}
            d={wedge(index * step, (index + 1) * step)}
            fill={slice.color || '#64748b'}
            stroke="rgb(var(--goku))"
            strokeWidth="0.01"
          />
        ))}
      </svg>

      <ul className="mt-3 grid w-full grid-cols-2 gap-x-3 gap-y-1 text-xs">
        {slices.map((slice, index) => (
          <li key={slice.id ?? index} className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: slice.color || '#64748b' }}
            />
            <span className={slice.isBadLuck ? 'truncate text-trunks' : 'truncate text-bulma'}>
              {slice.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One wedge of the unit circle, in degrees. */
function wedge(fromDeg, toDeg) {
  const from = (fromDeg * Math.PI) / 180;
  const to = (toDeg * Math.PI) / 180;
  const large = toDeg - fromDeg > 180 ? 1 : 0;

  return [
    `M 0 0`,
    `L ${Math.cos(from).toFixed(4)} ${Math.sin(from).toFixed(4)}`,
    `A 1 1 0 ${large} 1 ${Math.cos(to).toFixed(4)} ${Math.sin(to).toFixed(4)}`,
    'Z',
  ].join(' ');
}

function SpinResult({ result, onAgain }) {
  const lost = Boolean(result.isBadLuck);

  return (
    <div className="grid gap-2 rounded-i-md bg-goku px-4 py-4 text-center">
      <span
        className={cn(
          'mx-auto grid size-12 place-items-center rounded-full',
          lost ? 'bg-beerus text-trunks' : 'bg-roshi/15 text-roshi',
        )}
      >
        <Icon name={lost ? 'frown' : 'check'} size={24} />
      </span>

      <p className="text-sm font-medium text-bulma">
        {lost ? 'Better luck next time' : `${result.slice?.label ?? result.rewardPct} deposit bonus`}
      </p>

      {!lost && result.redeemCode && (
        <>
          <p className="text-xs leading-relaxed text-trunks">
            {/* The code is the prize. Saying what it does is the difference
                between this and a screen that implies a payout. */}
            Use this code on your next deposit to add{' '}
            {result.rewardPct}% to it.
          </p>
          <code className="rounded-i-sm bg-gohan px-3 py-2 font-mono text-sm break-all text-bulma">
            {result.redeemCode}
          </code>
        </>
      )}

      <button
        type="button"
        onClick={onAgain}
        className="mt-1 cursor-pointer text-xs font-medium text-piccolo hover:underline"
      >
        Close
      </button>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <section className="grid h-max content-start gap-3 rounded-s-md bg-gohan p-5">
      <h2 className="font-secondary text-lg font-medium text-bulma">{title}</h2>
      {children}
    </section>
  );
}

/**
 * When a bonus was paid.
 *
 * This replaced `formatWindow`, which rendered a start and an end date off
 * a row that has neither — see the block at the top of this file. A log
 * entry has one date and it is in the past.
 *
 * `createdat` is `timestamp WITHOUT time zone`, so the string arrives with
 * no offset and `Date` reads it as local. That is off by the deployment's
 * own UTC offset and it is the platform's column that is wrong, not this;
 * a day-and-month label absorbs it, which a clock time would not.
 */
function formatPaidAt(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'soon';

  const hours = (date.getTime() - Date.now()) / 3_600_000;
  if (hours < 1) return 'in under an hour';
  if (hours < 24) return `in ${Math.round(hours)} hours`;
  return `on ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}
