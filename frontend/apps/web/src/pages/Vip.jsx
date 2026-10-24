import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/auth/AuthProvider';
import { useBonus, useClaimBonus } from '@/queries';
import { formatBalance } from '@/lib/format';
import { currencyMeta } from '@/data/currencies';
import { cn } from '@/lib/cn';

/**
 * `/vip` — the account's VIP standing and the three periodic bonuses.
 *
 * One read: `GET /api/v1/user/bonus` answers
 * `{vip: {level, card, wager, nextLevel, wagerToNextLevel, progressPct},
 *   currency, types: {daily, weekly, monthly}}`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `eligible` AND `claimable` ARE DIFFERENT THINGS, AND COLLAPSING THEM LIES.
 *
 * `eligible` is whether the account's VIP level has reached the bonus's
 * `minVipLevel`. `claimable` is whether there is something to take right now.
 *
 * A player at level 0 looking at a daily bonus with `minVipLevel: 20` is not
 * "not claimable yet" in the sense of "come back tomorrow" — they are twenty
 * levels away, and the two sentences send them to completely different
 * places. So the card branches on both and says which of the two it is.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * ## The tier list is NOT invented here
 *
 * The reference has a seven-tier ladder with named benefits. This platform
 * reports a level number, a card name and a wager target, and nothing about
 * what a level is worth. `/loyalty` already carries the ladder as this
 * project's own model, so this page reports the account's real standing and
 * links there rather than restating a benefits table from a different source
 * as though the platform had confirmed it.
 *
 * ## Every amount is a decimal string
 *
 * `wager`, `wagerToNextLevel` and each bonus `amount` are `NUMERIC` on the
 * wire. They are formatted, never parsed — same rule as the wallet.
 */

const TYPES = [
  { id: 'daily', label: 'Daily bonus', blurb: 'Paid every day once you qualify.' },
  { id: 'weekly', label: 'Weekly bonus', blurb: 'Paid once a week on your wagering.' },
  { id: 'monthly', label: 'Monthly bonus', blurb: 'The largest of the three.' },
];

export function Vip() {
  const { status } = useAuth();
  const { data, isPending, isError } = useBonus();

  if (status !== 'authenticated') return <SignedOut />;

  return (
    <div className="py-4">
      <h1 className="font-secondary text-2xl font-normal text-bulma">VIP club</h1>
      <p className="mt-1 text-sm text-trunks">
        Your level, and what it pays.
      </p>

      {isPending ? (
        <div className="mt-5 grid gap-3">
          <Skeleton className="h-36 rounded-s-md" />
          <div className="grid gap-3 sm:grid-cols-3">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-40 rounded-s-md" />
            ))}
          </div>
        </div>
      ) : isError ? (
        <p className="mt-5 rounded-s-md bg-gohan p-5 text-sm text-trunks">
          Could not load your VIP standing. Reload the page to try again.
        </p>
      ) : (
        <div className="mt-5 grid gap-3">
          <StandingCard vip={data?.vip} currency={data?.currency} />

          <div className="grid gap-3 sm:grid-cols-3">
            {TYPES.map((type) => (
              <BonusCard
                key={type.id}
                type={type}
                bonus={data?.types?.[type.id]}
                level={Number(data?.vip?.level ?? 0)}
                currency={data?.currency}
              />
            ))}
          </div>

          <p className="text-xs leading-relaxed text-trunks">
            What each level is worth is set by the operator.{' '}
            <Link to="/loyalty" className="text-piccolo hover:underline">
              The Loyalty Club
            </Link>{' '}
            explains the ladder.
          </p>
        </div>
      )}
    </div>
  );
}

/** Level, card name, and progress to the next one. */
function StandingCard({ vip, currency }) {
  const level = Number(vip?.level ?? 0);
  const decimals = currencyMeta(currency ?? 'USDT').decimals;

  /**
   * The server's own percentage, clamped for the bar only.
   *
   * `progressPct` arrives as a decimal string. It is printed as sent and
   * clamped only for the width, so a server figure over 100 shows a full bar
   * and still reports the number it actually gave.
   */
  const pct = Number(vip?.progressPct ?? 0);
  const width = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;

  return (
    <section className="grid gap-4 rounded-s-md bg-gohan p-5">
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-full bg-goku text-piccolo">
          <Icon name="trophy" size={26} />
        </span>
        <div>
          <p className="text-xs text-trunks">Your level</p>
          <p className="font-secondary text-2xl leading-8 font-medium text-bulma">
            {/* `card` is the platform's own name for the tier — "brownz" at
                level 0. Printed as it comes rather than mapped onto the
                reference's tier names, which are a different ladder. */}
            {level}
            {vip?.card && (
              <span className="ms-2 align-middle text-sm font-normal text-trunks capitalize">
                {vip.card}
              </span>
            )}
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-trunks">
            Wagered {formatBalance(vip?.wager ?? '0', decimals)}
          </span>
          <span className="text-trunks tabular-nums">
            {vip?.progressPct ?? '0'}% to level {vip?.nextLevel ?? level + 1}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-goku">
          <div
            className="h-full rounded-full bg-piccolo transition-[width] duration-500"
            style={{ width: `${width}%` }}
          />
        </div>
        <p className="mt-1.5 text-xs text-trunks">
          {formatBalance(vip?.wagerToNextLevel ?? '0', decimals)} more to go.
        </p>
      </div>
    </section>
  );
}

function BonusCard({ type, bonus, level, currency }) {
  const claim = useClaimBonus();
  const decimals = currencyMeta(currency ?? 'USDT').decimals;

  const eligible = Boolean(bonus?.eligible);
  const claimable = Boolean(bonus?.claimable);
  const minLevel = Number(bonus?.minVipLevel ?? 0);

  return (
    <section className="grid h-full content-start gap-2 rounded-s-md bg-gohan p-5">
      <h2 className="text-sm font-medium text-bulma">{type.label}</h2>
      <p className="text-xs leading-relaxed text-trunks">{type.blurb}</p>

      <p className="mt-1 font-secondary text-xl leading-7 font-medium text-bulma tabular-nums">
        {formatBalance(bonus?.amount ?? '0', decimals)}{' '}
        <span className="text-sm font-normal text-trunks">{currency}</span>
      </p>

      {/* The two refusals are different problems with different fixes, and
          the read tells them apart before anything is pressed. */}
      {!eligible ? (
        <p className="text-xs leading-relaxed text-trunks">
          Unlocks at VIP level {minLevel}. You are on {level}.
        </p>
      ) : !claimable ? (
        <p className="text-xs leading-relaxed text-trunks">
          Nothing to claim right now — come back when the next one lands.
        </p>
      ) : (
        <Button
          size="sm"
          className="mt-1 w-max"
          onClick={() => claim.mutate({ type: type.id })}
          disabled={claim.isPending}
        >
          {claim.isPending ? 'Claiming…' : 'Claim'}
        </Button>
      )}

      {claim.isError && (
        <p role="alert" className="text-xs leading-relaxed text-dodoria">
          {claim.error?.message || 'The claim was refused.'}
        </p>
      )}

      {claim.isSuccess && (
        <p className="text-xs leading-relaxed text-roshi">Claimed.</p>
      )}

      {bonus?.totalPaid && bonus.totalPaid !== '0.00000000' && (
        <p
          className={cn('mt-auto pt-2 text-xs text-trunks tabular-nums')}
        >
          {formatBalance(bonus.totalPaid, decimals)} {currency} paid so far
        </p>
      )}
    </section>
  );
}

/**
 * A VIP level belongs to an account, so there is nothing to show a visitor.
 * An invitation beats a 401 rendered as a broken page.
 */
function SignedOut() {
  return (
    <div className="py-4">
      <h1 className="font-secondary text-2xl font-normal text-bulma">VIP club</h1>
      <div className="mt-5 grid max-w-[560px] gap-3 rounded-s-md bg-gohan p-6">
        <p className="text-sm leading-relaxed text-bulma">
          Every wager climbs the ladder, and each level pays a daily, weekly
          and monthly bonus.
        </p>
        <p className="text-sm leading-relaxed text-trunks">
          Your level is tied to your account, so log in to see where you are.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button as={Link} to="/login">
            Log in
          </Button>
          <Button as={Link} to="/register" variant="secondary">
            Create an account
          </Button>
        </div>
      </div>
    </div>
  );
}
