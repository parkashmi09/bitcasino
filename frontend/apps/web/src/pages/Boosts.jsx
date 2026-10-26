import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { BoostArt } from '@/components/ui/BoostArt';
import { useBonus, useClaimBonus } from '@/queries';
import { formatBalance } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * `/profile/boosts`.
 *
 * The account area's boost list, reached from the `Boosts` row of the account
 * menu and the `Boosts` tab of the bar `ProfileLayout` draws over every
 * account page. Gated by `bonus` at the route.
 *
 * ## The reference's Casino Boost has no backend; the periodic bonuses do
 *
 * The reference's boost — winnings multiplied for N minutes from a timer under
 * a game — exists nowhere on the platform. What does exist is the three
 * periodic bonuses, `GET /user/bonus` → `types.{daily,weekly,monthly}`, each
 * with its VIP gate, an award waiting (or not) and a claim
 * (`POST /user/bonus/claim/:type`). Those are the boosts this page lists, in
 * the same card the reference's model would have used.
 *
 * `eligible` and `claimable` are different things — see `Vip.jsx` — and the
 * card says which one stands in the way.
 *
 * ## The empty state is the reference's
 *
 * Measured at a 1536px viewport, it is the page's only card when there is
 * nothing to show: full width of `main`, `gohan`, 12px radius, 64px pad
 * stacked and 40px once it is a row at `lg`; 96px art in a `goku` circle;
 * 20px/28 medium title over 16px/24 `trunks` body; the button pushed to the
 * end. `Read more` goes to `/vip`, where the levels that unlock these are.
 */

const TYPES = [
  { id: 'daily', label: 'Daily bonus' },
  { id: 'weekly', label: 'Weekly bonus' },
  { id: 'monthly', label: 'Monthly bonus' },
];

export function Boosts() {
  const { data, isPending, isError } = useBonus();

  if (isPending) return <Skeleton className="h-44 rounded-i-md" />;

  const items = TYPES.filter((type) => data?.types?.[type.id]);
  if (isError || items.length === 0) return <EmptyBoosts />;

  return (
    <div className="grid gap-4">
      {/* `font-primary` and `tracking-normal` both undo the base `h1` rule,
          which sets the display face and -0.01em. */}
      <h1 className="font-primary text-2xl font-normal tracking-normal text-bulma">
        Boosts
      </h1>

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] items-start gap-4">
        {items.map((type) => (
          <li key={type.id}>
            <BoostCard
              type={type}
              bonus={data.types[type.id]}
              level={Number(data?.vip?.level ?? 0)}
              currency={data?.currency ?? ''}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyBoosts() {
  return (
    <section
      className={cn(
        'flex flex-col items-center rounded-i-md bg-gohan p-16 text-center',
        'lg:flex-row lg:p-10 lg:text-start',
      )}
    >
      <div className="mb-10 grid size-24 shrink-0 place-items-center rounded-full bg-goku lg:mb-0">
        <BoostArt size={96} />
      </div>

      <div className="max-w-sm lg:ms-6 xl:max-w-4xl">
        <h1 className="font-primary text-xl leading-7 font-medium tracking-normal text-bulma">
          Your Boost is not available
        </h1>
        <p className="text-base leading-6 text-trunks">
          Oh no! You don&apos;t have any enabled boosts
        </p>
      </div>

      {/* `lg`, not the reference's `xl`: between the two the button lands
          hard against the subtitle. `docs/11` records it. */}
      <div className="mt-8 lg:mt-0 lg:ms-auto">
        <Button as={Link} to="/vip" className="text-base">
          Read more
        </Button>
      </div>
    </section>
  );
}

/** One periodic bonus. The award's amount is what a claim pays; without one, the running figure. */
function BoostCard({ type, bonus, level, currency }) {
  const claim = useClaimBonus();
  const eligible = Boolean(bonus.eligible);
  const claimable = Boolean(bonus.claimable);
  const amount = bonus.award?.amount ?? bonus.amount ?? '0';

  return (
    <article className="grid gap-4 rounded-i-sm bg-gohan p-4">
      <div className="flex items-center gap-3">
        <BoostArt size={48} className="shrink-0" />
        <h2 className="font-primary text-2xl leading-8 font-bold tracking-normal text-bulma">
          {type.label}
        </h2>
      </div>

      <p className="text-base leading-6 text-bulma">
        {!eligible
          ? `Unlocks at VIP level ${bonus.minVipLevel}. You are on ${level}.`
          : claimable
            ? 'Ready to claim.'
            : 'Nothing to claim right now — come back when the next one lands.'}
      </p>

      <dl className="grid gap-2">
        <Fact label="Amount:" value={`${formatBalance(amount)} ${currency}`} />
        <Fact label="VIP level needed:" value={bonus.minVipLevel} />
        {bonus.award?.deadline && (
          <Fact label="Claim by:" value={formatDate(bonus.award.deadline)} />
        )}
        {!claimable && bonus.nextClaimAt && (
          <Fact label="Next one:" value={formatDate(bonus.nextClaimAt)} />
        )}
        <Fact label="Paid so far:" value={`${formatBalance(bonus.totalPaid ?? '0')} ${currency}`} />
      </dl>

      {claimable ? (
        <Button size="lg" onClick={() => claim.mutate({ type: type.id })} disabled={claim.isPending}>
          {claim.isPending ? 'Claiming…' : 'Claim'}
        </Button>
      ) : (
        <Button as={Link} to="/vip" variant="outline" size="lg">
          VIP club
        </Button>
      )}

      {claim.isError && (
        <p role="alert" className="text-sm text-chichi">
          {claim.error?.message || 'The claim was refused.'}
        </p>
      )}
    </article>
  );
}

function Fact({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-base text-bulma">{label}</dt>
      <dd className="text-base font-bold text-bulma">{value}</dd>
    </div>
  );
}

/** `01/06/2027`, day-first like the reference, pinned to `en-GB`. */
function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
