import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { DepositDialog } from '@/components/layout/DepositDialog';
import { ClaimRewardDialog } from '@/components/rewards/ClaimRewardDialog';
import { useRewards } from '@/hooks/useRewards';
import { useGates } from '@/hooks/useGates';
import { useBonusBalance, useClaimUnlocked, useFirstDepositOffer } from '@/queries/rewards';
import { compareDecimal, formatBalance } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * `/profile/rewards`.
 *
 * The account area's bonus list, reached from three places on the reference
 * and now on all three here: the `Rewards` row of the account menu, the
 * `Rewards` tab of the bar `ProfileLayout` draws over every account page —
 * the same bar the notifications page sits under — and the URL directly.
 *
 * Measured off the reference at a 1536px viewport, signed in:
 *
 *   claim row    right-aligned above the heading: a 16px `Claim reward`
 *                label beside a 40px `piccolo` square holding a plus
 *   heading      24px/32, weight 400, `bulma` — DM Sans, NOT the display face
 *                the rest of the site's headings use, same as Notifications
 *   grid         the reward cards, ~380px each across the full content width;
 *                three of them fit at 1536
 *   card         `gohan`, 8px radius, 16px pad, 16px between its blocks
 *   title        24px/32 bold
 *   body         16px/24 `bulma`
 *   callout      `goku` cut out of the card, 8px radius, 12px pad, a 24px
 *                `krillin` alert mark 12px from the text
 *   facts        label left, value right in bold — 16px, 8px apart
 *   reward       14px `trunks` caption over the granted offer in 20px bold
 *   terms        centred, 16px medium, underlined
 *   actions      two equal buttons, 44px tall, 16px apart
 *
 * ## The page is NOT the 750px reading column
 *
 * Notifications is a single list and the reference gives it 750px. This page
 * is a grid of cards and the reference runs it to the full width of `main` —
 * which is why `ProfileLayout` no longer caps its outlet and `Notifications`
 * carries its own `max-w` instead. Capping here would have squeezed three
 * cards' worth of grid into a 750px strip and left the claim control floating
 * in the middle of the page rather than at its end.
 *
 * ## Responsiveness
 *
 * The grid fits itself to the CONTAINER — `auto-fill` over a 320px minimum —
 * rather than counting columns off `sm:`/`xl:`. That is not a stylistic
 * preference here: the sidebar is 240px wide and stays mounted from `md` up,
 * so the content column is nowhere near the viewport width, and a `sm:`
 * (640px) rule for two columns puts two 224px cards side by side at a 768px
 * viewport — narrow enough to break the card's own title across five lines.
 * Measured against the container instead, the same page is one column until
 * the column really can hold two, two through the tablet range, and three at
 * 1536 where each card lands at ~400px — the reference's ~380px.
 *
 * `min(320px,100%)` rather than a bare `320px` is what keeps the track from
 * overflowing a container narrower than one card, which is the 320px-wide
 * phone the app still has to render on.
 *
 * ## What is real
 *
 * Three platform reads, no fixture:
 *
 *   offer      `GET /user/bonus/first-deposit` — shown only while THIS player
 *              is `eligible`. There is no opt-in on the platform (the bonus is
 *              applied by the deposit itself), so the card has no `Enable`.
 *   active     `GET /user/bonus-balance` — each locked bonus, its wagering
 *              progress, and for a gradual one the part unlocked so far, which
 *              `Claim` pays out (`POST /user/bonus-balance/claim`).
 *   history    the same read's ended bonuses.
 *
 * `Claim reward` redeems a code (`POST /user/bonus/redeem`) and is hidden when
 * the `bonus` gate is off. `Deposit` opens the header's drawer, mounted here
 * rather than threaded down through the layout.
 */

/** `player_bonuses.source` → name; the backend's own `LABEL` map. */
const SOURCE_LABEL = {
  first_deposit: 'First deposit bonus',
  spin_wheel: 'Spin wheel bonus',
  monthly_deposit: 'Deposit bonus',
};

export function Rewards() {
  const gates = useGates();
  const { claim } = useRewards();
  const offer = useFirstDepositOffer();
  const balance = useBonusBalance();
  const [claimOpen, setClaimOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);

  const canRedeem = gates.on('bonus');
  const active = balance.data?.active ?? [];
  const history = balance.data?.history ?? [];
  const loading = offer.isPending || balance.isPending;
  const empty = !offer.data && active.length === 0;

  return (
    <div className="grid gap-4">
      {/* The claim control. Label and button are one control in two parts —
          the reference wires both to the same dialog, so the text is a button
          rather than a caption sitting beside one. */}
      {canRedeem && (
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setClaimOpen(true)}
            className="cursor-pointer text-base text-bulma transition-colors hover:text-piccolo"
          >
            Claim reward
          </button>
          <button
            type="button"
            onClick={() => setClaimOpen(true)}
            aria-label="Claim reward"
            className={cn(
              'grid size-10 shrink-0 cursor-pointer place-items-center rounded-i-sm',
              'bg-piccolo text-on-piccolo shadow-sm transition-colors',
              'hover:bg-piccolo-80 active:bg-piccolo-120',
            )}
          >
            <Icon name="plus" size={20} />
          </button>
        </div>
      )}

      {/* `font-primary` and `tracking-normal` both undo the base `h1` rule,
          which sets the display face and -0.01em. The reference's account
          headings are plain DM Sans at 24/32 with no tracking. */}
      <h1 className="font-primary text-2xl font-normal tracking-normal text-bulma">
        Rewards
      </h1>

      {loading ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] gap-4">
          <Skeleton className="h-96 rounded-i-sm" />
        </div>
      ) : balance.isError ? (
        <p className="max-w-[750px] text-sm text-trunks">
          Could not load your rewards. Reload the page to try again.
        </p>
      ) : empty ? (
        <p className="max-w-[750px] text-sm text-trunks">
          You have no rewards right now.{canRedeem && ' Claim one with a code, or'}{' '}
          see what is running on the promotions page.
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] items-start gap-4">
          {offer.data && (
            <li>
              <OfferCard offer={offer.data} onDeposit={() => setDepositOpen(true)} />
            </li>
          )}
          {active.map((bonus) => (
            <li key={bonus.id}>
              <BonusCard bonus={bonus} />
            </li>
          ))}
        </ul>
      )}

      {history.length > 0 && <History rows={history} />}

      {canRedeem && (
        <ClaimRewardDialog
          open={claimOpen}
          onClose={() => setClaimOpen(false)}
          onClaim={claim}
        />
      )}

      {/* Mounted only while open — unlike the claim dialog it reads the wallet,
          and an always-mounted copy would fetch balances on every visit to a
          page nobody opened a drawer from. The same rule `Layout` follows. */}
      {depositOpen && <DepositDialog open onClose={() => setDepositOpen(false)} />}
    </div>
  );
}

/**
 * The card shell every reward shares. A grid rather than a stack of margins
 * so every block is spaced by the same 16px, including the conditional ones.
 */
function Card({ title, description, facts, reward, children }) {
  return (
    <article className="grid gap-4 rounded-i-sm bg-gohan p-4">
      <h2 className="font-primary text-2xl leading-8 font-bold tracking-normal text-bulma">
        {title}
      </h2>

      {description && <p className="text-base leading-6 text-bulma">{description}</p>}

      <dl className="grid gap-2">
        {facts.filter(([, value]) => value).map(([label, value]) => (
          <Fact key={label} label={label} value={value} />
        ))}
      </dl>

      {reward && (
        <div className="grid gap-1">
          <span className="text-sm text-trunks">Reward</span>
          <div className="text-xl leading-7 font-bold text-bulma">{reward}</div>
        </div>
      )}

      {children}
    </article>
  );
}

/** The deposit offer the player can still get. */
function OfferCard({ offer, onDeposit }) {
  const { currency } = offer;
  const description = offer.wagerMultiplier
    ? `The bonus needs to be wagered ${offer.wagerMultiplier} times before you can withdraw it.`
    : offer.wageringLock
      ? 'The bonus stays locked until it has been wagered.'
      : 'The bonus is paid to your balance.';

  return (
    <Card
      title={offer.title}
      description={description}
      facts={[
        ['Minimum deposit amount:', `${formatBalance(offer.minDeposit)} ${currency}`],
        ['Expires:', offer.expiryDays && `${offer.expiryDays} days after it is credited`],
      ]}
      reward={offer.tiers.map((tier) => (
        <p key={tier.minDeposit}>
          {tier.percent}% from {formatBalance(tier.minDeposit)} {currency}
          {tier.maxBonus && (
            <span className="text-base font-normal text-trunks">
              {' '}(max {formatBalance(tier.maxBonus)})
            </span>
          )}
        </p>
      ))}
    >
      {/* A `Link`, not an `<a>`: `/terms` is a route in this app. */}
      <Link
        to="/terms"
        className="text-center text-base font-medium text-bulma underline underline-offset-2 transition-colors hover:text-piccolo"
      >
        Terms &amp; Conditions
      </Link>
      <Button size="lg" onClick={onDeposit}>
        Deposit
      </Button>
    </Card>
  );
}

/**
 * One locked bonus. A gradual one (`unlockMode: gradual`) pays out what each
 * bet unlocks; `Claim` takes every gradual bonus's unlocked part at once,
 * which is the only claim the platform has.
 */
function BonusCard({ bonus }) {
  const claim = useClaimUnlocked();
  const { currency } = bonus;
  const width = Math.min(100, Math.max(0, Number(bonus.progress) || 0));
  const claimable = bonus.claimable && compareDecimal(bonus.claimable, '0') > 0;

  return (
    <Card
      title={SOURCE_LABEL[bonus.source] ?? 'Bonus'}
      facts={[
        ['Wagered:', `${formatBalance(bonus.wagered)} / ${formatBalance(bonus.requiredWager)} ${currency}`],
        ['Unlocked:', bonus.unlocked && `${formatBalance(bonus.unlocked)} ${currency}`],
        ['Expiry date:', formatDate(bonus.expiresAt)],
      ]}
      reward={`${formatBalance(bonus.amount)} ${currency}`}
    >
      <div
        role="progressbar"
        aria-label="Wagering progress"
        aria-valuenow={width}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2 overflow-hidden rounded-full bg-goku"
      >
        <div className="h-full rounded-full bg-piccolo" style={{ width: `${width}%` }} />
      </div>

      {claimable && (
        <Button size="lg" onClick={() => claim.mutate()} disabled={claim.isPending}>
          {claim.isPending ? 'Claiming…' : `Claim ${formatBalance(bonus.claimable)} ${currency}`}
        </Button>
      )}
      {claim.isError && (
        <p role="alert" className="text-sm text-chichi">
          {claim.error?.message || 'The claim was refused.'}
        </p>
      )}
    </Card>
  );
}

/** Ended bonuses — completed, expired or forfeited. */
function History({ rows }) {
  return (
    <section className="grid max-w-[750px] gap-2 pt-4">
      <h2 className="text-base font-medium text-bulma">History</h2>
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex items-baseline justify-between gap-3 rounded-i-sm bg-gohan px-4 py-3 text-sm"
          >
            <span className="text-bulma">
              {SOURCE_LABEL[row.source] ?? 'Bonus'}{' '}
              <span className="text-trunks capitalize">· {row.status}</span>
            </span>
            <span className="text-end text-bulma tabular-nums">
              {formatBalance(row.amount)} {row.currency}
              <span className="block text-xs text-trunks">
                {formatDate(row.endedAt ?? row.grantedAt)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One `label: value` line. `dt`/`dd` in a flex row rather than a two-column
 * grid, so a long value stays hard against the card's end edge instead of
 * aligning to a column that the shorter of the two rows would define.
 */
function Fact({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-base text-bulma">{label}</dt>
      <dd className="text-base font-bold text-bulma">{value}</dd>
    </div>
  );
}

/**
 * `01/06/2027` — the day-first form the reference prints. `en-GB` is pinned
 * so a browser set to `en-US` does not print the same date as `6/1/2027`.
 */
function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
