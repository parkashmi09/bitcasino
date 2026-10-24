import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PromoPage, PromoParagraph, PromoSection } from '@/components/sections/PromoLayout';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/auth/AuthProvider';
import { useSpin, useSpinEligibility, useSpinSlices } from '@/queries';
import { SPIN_WHEEL } from '@/data/spinWheel';
import { cn } from '@/lib/cn';

/**
 * `/promotions/spin-the-wheel` — the wheel, on a promotion page of its own.
 *
 * It used to be a panel on `/promotions`, which the reference builds as a list
 * of campaigns and nothing else. Moving it here keeps the index a list and
 * gives the wheel the room a working feature needs; the row that links to it
 * is `SPIN_WHEEL` in `data/spinWheel.js`.
 *
 * The page borrows `PromoLayout` — the same hero, column width, section
 * headings and `Other promotions` rail the League and the Rakeback use — so it
 * sits in the set rather than beside it. There is no reference page to
 * transcribe here (the reference has no wheel), so the body is this app's own
 * copy describing this app's own mechanic, which is the one case where writing
 * the words is right.
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
export function SpinWheel() {
  return (
    <PromoPage promo={SPIN_WHEEL}>
      <PromoSection>
        <PromoParagraph lead="Your first spin is on the house.">
          Every spin after it is unlocked by a qualifying deposit, and the wheel
          remembers where you are in that cycle — the button below says which of
          the two you are looking at before you press it.
        </PromoParagraph>
      </PromoSection>

      <PromoSection
        heading="Take your spin"
        blurb="Eight segments, and what you land on is a bonus percentage off your next deposit."
      >
        <Wheel />
      </PromoSection>

      <PromoSection heading="What you win">
        <PromoParagraph lead="A redeem code, not a balance." block>
          A spin issues a code carrying a percentage. Apply it to your next
          deposit and the percentage is added to that deposit. Nothing is
          credited to your wallet at the moment you spin, and the wheel never
          takes anything from it either.
        </PromoParagraph>
        <PromoParagraph lead="Some segments pay nothing." block>
          Two of the eight are marked better luck. They are drawn the same size
          as the rest here because the odds are the house’s and are not
          published — the drawing shows the wheel’s shape, not its weighting.
        </PromoParagraph>
      </PromoSection>
    </PromoPage>
  );
}

/** The wheel, the legend, and the control under them. */
function Wheel() {
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

  if (isPending) {
    return <Skeleton className="mx-auto size-48 rounded-full" />;
  }

  if (disabled || slices.length === 0) {
    return (
      <p className="my-4 text-center text-base leading-6 text-bulma">
        {/* `disabled: true` is the operator's own switch, not a fault. */}
        The wheel is switched off at the moment.
      </p>
    );
  }

  return (
    <div className="mx-auto grid max-w-[26rem] gap-4">
      <Disc slices={slices} />

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
            <p className="text-center text-xs leading-relaxed text-trunks">
              {/* The two reasons a spin is refused are different problems with
                  different fixes, and the eligibility read tells them apart
                  before the player presses anything. */}
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
    </div>
  );
}

/**
 * The wheel itself, as an SVG of equal segments.
 *
 * **Equal segments, and that is the honest drawing.** The public route strips
 * the weights, so this client does not know the odds — and sizing a segment by
 * anything else would imply a probability it cannot support. The colours are
 * the operator's own, from the row.
 */
function Disc({ slices }) {
  const step = 360 / slices.length;

  return (
    <div className="mx-auto grid w-full place-items-center">
      <svg viewBox="-1 -1 2 2" className="size-56 -rotate-90" role="img" aria-label="Prize wheel">
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

      <ul className="mt-4 grid w-full grid-cols-2 gap-x-3 gap-y-1 text-sm">
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
    <div className="grid gap-2 rounded-i-md bg-gohan px-4 py-4 text-center">
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
            Use this code on your next deposit to add {result.rewardPct}% to it.
          </p>
          <code className="rounded-i-sm bg-goku px-3 py-2 font-mono text-sm break-all text-bulma">
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

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'soon';

  const hours = (date.getTime() - Date.now()) / 3_600_000;
  if (hours < 1) return 'in under an hour';
  if (hours < 24) return `in ${Math.round(hours)} hours`;
  return `on ${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
}
