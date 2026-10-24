import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { DepositDialog } from '@/components/layout/DepositDialog';
import { ClaimRewardDialog } from '@/components/rewards/ClaimRewardDialog';
import { useRewards } from '@/hooks/useRewards';
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
 * The two action buttons stay side by side at every width — at the narrowest
 * layout the app has they are still ~140px each, which `Enable` and `Deposit`
 * both fit inside without wrapping.
 *
 * ## What is real and what is fixed
 *
 * `Enable` and `Claim reward` both do what they say, against `localStorage`
 * (see `useRewards`). `Deposit` opens the same drawer the header's button
 * does — mounted here rather than reached through the layout, because the
 * drawer is self-contained and threading an opener down through `Layout`,
 * `ProfileLayout` and the outlet to reach one button would be the larger
 * change. The offers themselves are fixtures; `data/rewards.js` has the seam.
 */
export function Rewards() {
  const { items, enable, claim } = useRewards();
  const [claimOpen, setClaimOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);

  return (
    <div className="grid gap-4">
      {/* The claim control. Label and button are one control in two parts —
          the reference wires both to the same dialog, so the text is a button
          rather than a caption sitting beside one. */}
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
            'bg-piccolo text-goten shadow-sm transition-colors',
            'hover:bg-piccolo-80 active:bg-piccolo-120',
          )}
        >
          <Icon name="plus" size={20} />
        </button>
      </div>

      {/* `font-primary` and `tracking-normal` both undo the base `h1` rule,
          which sets the display face and -0.01em. The reference's account
          headings are plain DM Sans at 24/32 with no tracking. */}
      <h1 className="font-primary text-2xl font-normal tracking-normal text-bulma">
        Rewards
      </h1>

      {items.length === 0 ? (
        <p className="max-w-[750px] text-sm text-trunks">
          You have no rewards right now. Claim one with a code, or see what is
          running on the promotions page.
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] items-start gap-4">
          {items.map((reward) => (
            <li key={reward.id}>
              <RewardCard
                reward={reward}
                onEnable={() => enable(reward.id)}
                onDeposit={() => setDepositOpen(true)}
              />
            </li>
          ))}
        </ul>
      )}

      <ClaimRewardDialog
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        onClaim={claim}
      />

      {/* Mounted only while open — unlike the claim dialog it reads the wallet,
          and an always-mounted copy would fetch balances on every visit to a
          page nobody opened a drawer from. The same rule `Layout` follows. */}
      {depositOpen && <DepositDialog open onClose={() => setDepositOpen(false)} />}
    </div>
  );
}

/**
 * One offer.
 *
 * The card is a grid rather than a stack of margins so every block is spaced
 * by the same 16px, including the ones that are conditional — a `notice` is
 * absent on some offers, and margins would leave a double gap where one used
 * to be.
 *
 * `Enable` disappears once the reward is enabled rather than greying out: an
 * enabled bonus has nothing left to enable, and the reference's card at that
 * point is a single full-width `Deposit`. The callout goes with it, because
 * its whole text is "enable this first".
 */
function RewardCard({ reward, onEnable, onDeposit }) {
  const { title, description, notice, minDeposit, expiresAt, termsHref, enabled } =
    reward;

  return (
    <article className="grid gap-4 rounded-i-sm bg-gohan p-4">
      <h2 className="font-primary text-2xl leading-8 font-bold tracking-normal text-bulma">
        {title}
      </h2>

      <p className="text-base leading-6 text-bulma">{description}</p>

      {notice && !enabled && (
        <div className="flex items-start gap-3 rounded-i-sm bg-goku p-3">
          <Icon name="alert" size={24} className="mt-0.5 text-krillin" />
          <p className="text-base leading-6 text-bulma">{notice}</p>
        </div>
      )}

      <dl className="grid gap-2">
        <Fact label="Minimum deposit amount:" value={minDeposit} />
        <Fact label="Expiry date:" value={formatDate(expiresAt)} />
      </dl>

      <div className="grid gap-1">
        <span className="text-sm text-trunks">Reward</span>
        <p className="text-xl leading-7 font-bold text-bulma">{reward.reward}</p>
      </div>

      {/* A `Link`, not an `<a>`: `/terms` is a route in this app. Centred and
          underlined at rest, which is the reference's own treatment here — it
          is the card's fine print, not one of its actions. */}
      <Link
        to={termsHref}
        className="text-center text-base font-medium text-bulma underline underline-offset-2 transition-colors hover:text-piccolo"
      >
        Terms &amp; Conditions
      </Link>

      <div className={cn('grid gap-4', !enabled && 'grid-cols-2')}>
        {!enabled && (
          <Button variant="outline" size="lg" onClick={onEnable}>
            Enable
          </Button>
        )}
        <Button size="lg" onClick={onDeposit}>
          Deposit
        </Button>
      </div>
    </article>
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
 * `01/06/2027` — the day-first form the reference prints.
 *
 * `en-GB` is pinned rather than left to the visitor's locale for the reason
 * `Notifications.formatDate` pins `en-US`: the reference serves one format to
 * everyone, and a browser set to `en-US` would otherwise render `6/1/2027`
 * here — the same date, read as a different one.
 */
function formatDate(iso) {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}


