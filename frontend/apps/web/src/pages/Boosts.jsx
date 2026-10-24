import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { BoostArt } from '@/components/ui/BoostArt';
import { BOOSTS, BOOST_EXPLAINER } from '@/data/boosts';
import { cn } from '@/lib/cn';

/**
 * `/profile/boosts`.
 *
 * The account area's Casino Boost list, reached from the `Boosts` row of the
 * account menu and the `Boosts` tab of the bar `ProfileLayout` draws over
 * every account page. A sibling of `/profile/rewards` under that bar, unlike
 * `Loyalty`, which leaves the account area entirely.
 *
 * ## What the reference actually shows
 *
 * The account this was measured on has no boosts, so the reference's page is
 * its **empty state and nothing else** — no page heading, no history block,
 * one card between the tab bar and the footer. Measured at a 1536px viewport:
 *
 *   card       full width of `main` (1201px), 176px tall, `gohan`, 12px
 *              radius, 64px pad stacked and 40px once it is a row at `lg`
 *   art        96px, `piccolo`, inside a 96px `goku` circle, `mb-10 lg:mb-0`
 *   title      20px/28, weight 500, `bulma`
 *   body       16px/24, `trunks`
 *   text block `max-w-sm` centred, `ms-6` and start-aligned from `lg`
 *   button     `Read more`, 113x40 `piccolo`, 16px medium — pushed to the far
 *              end by `ms-auto`, but only from `xl`
 *
 * That card is reproduced exactly, and it is what this page renders whenever
 * the list is empty.
 *
 * ## The populated card is OURS
 *
 * There was no boost on the account, so there was nothing to measure and the
 * card below is not a copy of anything. Its *content* is the reference's
 * model, though — its help centre says an available boost is shown with its
 * percentage, the time until it expires and the games it covers, and that it
 * runs for a fixed period up to a maximum reward, so those are the five facts
 * the card carries. Its *chrome* is `RewardCard`'s on the sibling page — same
 * `gohan` card, same 16px grid, same `Fact` line, same button — so the two
 * account pages read as one system rather than two guesses.
 *
 * `docs/11` records both of those.
 *
 * ## No `Activate` button
 *
 * The reference starts a boost from the button beside the timer *under a
 * boost-compatible game*, not from the account area. An `Activate` here would
 * have to invent a running timer with no service behind it, so the card's
 * action is a link into the eligible category instead — which is where the
 * activation actually is.
 *
 * ## `Read more` goes to a help centre this project does not have
 *
 * On the reference it opens `/help-center/help-your-bonuses/casino-boosts`.
 * Rather than point a button at a route that does not exist, the article's
 * substance sits at the foot of the page and `Read more` opens it. It is a
 * real disclosure — `aria-expanded`, `aria-controls`, `useId` — and the same
 * pattern `TrustSection` uses on the home page.
 *
 * ## Responsiveness
 *
 * The card list fits itself to the CONTAINER — `auto-fill` over a 320px
 * minimum — for the reason spelled out on `Rewards`: the 240px sidebar means
 * the content column is nowhere near the viewport width, so counting columns
 * off `sm:`/`xl:` puts two 224px cards side by side at a 768px viewport.
 *
 * The empty card stacks below `lg` and becomes a row above it, which is the
 * reference's own `flex-col lg:flex-row`.
 */
export function Boosts() {
  const [explainerOpen, setExplainerOpen] = useState(false);
  const explainerId = useId();

  // A boost past its date is not a boost. Dropping it here rather than in the
  // data is what makes the empty state a real state of this page instead of a
  // branch nothing reaches: let the fixture's `expiresAt` fall into the past
  // and the reference's card is what renders.
  const today = new Date().toISOString().slice(0, 10);
  const items = BOOSTS.filter((boost) => boost.expiresAt >= today);

  function openExplainer() {
    setExplainerOpen(true);
    // The disclosure is at the foot of a page that may be taller than the
    // viewport, so opening it from a button at the top has to bring it into
    // view or the button reads as dead.
    requestAnimationFrame(() => {
      document.getElementById(explainerId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
  }

  return (
    <div className="grid gap-4">
      {items.length === 0 ? (
        <EmptyBoosts onReadMore={openExplainer} />
      ) : (
        <>
          {/* `font-primary` and `tracking-normal` both undo the base `h1`
              rule, which sets the display face and -0.01em. The reference's
              account headings are plain DM Sans at 24/32 with no tracking.

              The reference has no heading on this page at all — but it has no
              list either, and a bare grid of cards under the tab bar is the
              one shape that needs to say what it is. The empty state below
              keeps the reference's headingless layout exactly. */}
          <h1 className="font-primary text-2xl font-normal tracking-normal text-bulma">
            Boosts
          </h1>

          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(320px,100%),1fr))] items-start gap-4">
            {items.map((boost) => (
              <li key={boost.id}>
                <BoostCard boost={boost} onReadMore={openExplainer} />
              </li>
            ))}
          </ul>
        </>
      )}

      <BoostExplainer
        id={explainerId}
        open={explainerOpen}
        onToggle={() => setExplainerOpen((value) => !value)}
      />
    </div>
  );
}

/**
 * The reference's page, verbatim: art, two lines, one button.
 *
 * The title is the page's `<h1>`. The reference sets it as a `span` inside the
 * card and gives the route no heading of its own, which leaves the document
 * with none — so this keeps the reference's type exactly (20/28 medium, not
 * the 24/32 the account headings use) and only changes the element.
 */
function EmptyBoosts({ onReadMore }) {
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

      {/* The reference writes `mt-8 xl:mt-0 xl:ml-auto` here, which leaves a
          176px band — `lg` to `xl` — where the card is already a row but the
          button has not been pushed to the end yet, so it lands hard against
          the last word of the subtitle with no gap at all. Measured at a
          1103px viewport: the text ends at x=757 and the button starts at
          x=757. Moving both to `lg` is identical to the reference at the
          1536px it was measured at, and is a row rather than a collision on
          every laptop between the two breakpoints. `docs/11` records it. */}
      <div className="mt-8 lg:mt-0 lg:ms-auto">
        <Button onClick={onReadMore} className="text-base">
          Read more
        </Button>
      </div>
    </section>
  );
}

/**
 * One boost.
 *
 * A grid rather than a stack of margins, for `RewardCard`'s reason: every
 * block is spaced by the same 16px including the conditional ones, and margins
 * would leave a double gap where an absent block used to be.
 *
 * The percentage is the card's heading because it is the one number that
 * decides whether the offer is worth taking — the reference leads its own
 * boost banner with it too.
 */
function BoostCard({ boost, onReadMore }) {
  const { percentage, eligible, categorySlug, durationMin, maxReward, expiresAt } =
    boost;

  return (
    <article className="grid gap-4 rounded-i-sm bg-gohan p-4">
      <div className="flex items-center gap-3">
        <BoostArt size={48} className="shrink-0" />
        <h2 className="font-primary text-2xl leading-8 font-bold tracking-normal text-bulma">
          {percentage}% Casino Boost
        </h2>
      </div>

      <p className="text-base leading-6 text-bulma">
        Your winnings are boosted by {percentage}% for {durationMin}{' '}
        {durationMin === 1 ? 'minute' : 'minutes'} once you start the boost.
      </p>

      <div className="flex items-start gap-3 rounded-i-sm bg-goku p-3">
        <Icon name="alert" size={24} className="mt-0.5 text-krillin" />
        <p className="text-base leading-6 text-bulma">
          Start the boost from the timer under a boost-compatible game.
        </p>
      </div>

      <dl className="grid gap-2">
        <Fact label="Eligible games:" value={eligible} />
        <Fact label="Boost period:" value={`${durationMin} min`} />
        <Fact label="Maximum boost:" value={maxReward} />
        <Fact label="Expiry date:" value={formatDate(expiresAt)} />
      </dl>

      <div className={cn('grid gap-4', categorySlug && 'grid-cols-2')}>
        {categorySlug && (
          <Button as={Link} to={`/categories/${categorySlug}`} size="lg">
            Choose a game
          </Button>
        )}
        <Button variant="outline" size="lg" onClick={onReadMore}>
          Read more
        </Button>
      </div>
    </article>
  );
}

/**
 * One `label: value` line. `dt`/`dd` in a flex row rather than a two-column
 * grid, so a long value stays hard against the card's end edge instead of
 * aligning to a column that the shorter of the two rows would define — the
 * same `Fact` the reward cards use.
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
 * What `Read more` opens: the help-centre article, on the page.
 *
 * Always mounted and always visible as a heading, so the page says where the
 * explanation is before anyone presses anything, and the button below the
 * fold has something to scroll to.
 */
function BoostExplainer({ id, open, onToggle }) {
  return (
    <section className="grid max-w-[750px] gap-2 pt-4">
      <h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full cursor-pointer items-center justify-between gap-3 text-start text-base font-medium text-bulma transition-colors hover:text-piccolo"
        >
          How Casino Boosts work
          <Icon
            name="chevron-down"
            size={20}
            className={cn('transition-transform duration-200', open && '-scale-y-100')}
          />
        </button>
      </h2>

      <div id={id} hidden={!open} className="grid gap-4">
        {BOOST_EXPLAINER.map((paragraph) => (
          <p key={paragraph} className="text-base leading-6 text-trunks">
            {paragraph}
          </p>
        ))}
      </div>
    </section>
  );
}

/**
 * `01/06/2027` — the day-first form the reference prints, pinned to `en-GB`
 * for the reason `Rewards.formatDate` pins it: the reference serves one format
 * to everyone, and a browser set to `en-US` would render `6/1/2027` here — the
 * same date, read as a different one.
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
