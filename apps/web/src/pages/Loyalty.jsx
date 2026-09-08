import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import {
  LOYALTY,
  LOYALTY_BENEFITS,
  LOYALTY_PROFITS,
  LOYALTY_PROGRESS,
  LOYALTY_PROMISES,
  LOYALTY_TIERS,
} from '@/data/loyalty';
import { cn } from '@/lib/cn';

/**
 * `/loyalty` — the Loyalty Club landing page.
 *
 * This is where the reference actually goes from both of the places this app
 * links it: the account menu's `Loyalty` row and the account tab bar's
 * `Loyalty` tab. Both point at `/profile/loyalty` there, and that path 302s to
 * `/loyalty`, which is this page — a full-width marketing sheet with no
 * account tab bar over it. `App.jsx` keeps the same redirect so the reference's
 * URL still resolves.
 *
 * ## Measured off bitcasino.io/loyalty at a 1265px content column
 *
 * The page is one `grid gap-8` column, which is already what `main` gives its
 * children, so the sections below carry no vertical margins of their own.
 *
 *   hero        full-bleed, flush with the header, 16px bottom corners only.
 *               `lp-bg.jpg` under a `golden-pattern.png` on `mix-blend-lighten`
 *   h1          32px, then 64px/72 light from `xl`, Space Grotesk
 *   layout      stacked and centred, 40%/60% text-then-art from `xl`
 *   promises    3 columns always; the two curved arrows appear at `lg`, where
 *               the track becomes `1fr auto 1fr auto 1fr`. Icons 80px
 *   headings    24px light, Space Grotesk, centred, with a small gold
 *               flourish either side BELOW `md` only
 *   benefit     288px card, `gohan`, 8px radius, 24px pad, 128px art,
 *               16px `krillin` title over 16/24 body. 3-up from `xl`
 *   tier card   288px (320px from `xl`), min 420px tall, `gohan`, 12px radius,
 *               the `loyalty_landing_levels_border.svg` frame painted across
 *               the top at `100% auto`, 96px emblem, 24px `piccolo` name,
 *               facts split by dashed `trunks` rules
 *   profits     544px list beside a 544px render; the selected row is the only
 *               one with a `gohan` fill, and selecting one swaps the render
 *   divider     4px `krillin` rule with the 196x40 diamond cluster centred on it
 *   progress    4 bullet cards, 1px `beerus` border, 8px radius, titles in
 *               `piccolo` / `krillin` / `cell` / `whis` in that order
 *
 * **Type is Space Grotesk throughout**, body copy included — `getComputedStyle`
 * on the card paragraphs says so. That is unusual for this site, where body
 * text is DM Sans, and it is why every `<p>` here carries `font-secondary`
 * rather than inheriting.
 *
 * ## Theme
 *
 * The reference wraps the whole page in `theme-bitcasino-light`, so the page
 * is light even where the rest of the site is not. Only the hero does that
 * here (`theme-light`), because only the hero has to: its type sits on a pale
 * photograph and would vanish against a dark palette. Everything below it is
 * drawn from tokens and follows the app's theme like every other page.
 *
 * ## What this page does NOT do
 *
 * The reference's "Find out your Loyalty level" buttons carry no href and no
 * visible handler. Rather than invent a destination, all three scroll to the
 * tier table, which is the question they ask — and the tier the account is
 * actually on is marked there, read from `LOYALTY`. That marker is ours; the
 * reference has nothing like it, and `docs/11` records it.
 */
export function Loyalty() {
  return (
    // `grid-cols-[minmax(0,1fr)]`, not a bare `grid`: the tier row is 7x320px
    // of scrolling track, and a default grid column is `auto` — it sizes to its
    // content, so the whole page inherits that 2336px width and every section
    // below spills off the viewport. The reference's own wrapper carries the
    // same `minmax(0, 1fr)` column for the same reason.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <Hero />
      <Benefits />
      <Levels />
      <Profits />
      <DiamondRule />
      <Progress />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The banner band.
 *
 * `-mx-4 md:-mx-8 md:-mt-10` cancels `main`'s own padding so the band runs the
 * full width of the content column and sits flush under the header, which is
 * where the reference has it — its `main` carries no padding on this route at
 * all. Only the bottom corners are rounded, for the same reason.
 */
function Hero() {
  return (
    <section
      className={cn(
        'theme-light relative -mx-4 overflow-hidden rounded-b-2xl bg-cover bg-center',
        'pb-8 md:-mx-8 md:-mt-10 lg:pb-10',
      )}
      style={{ backgroundImage: 'url(/images/loyalty/hero-bg.webp)' }}
    >
      {/* The gold filigree over the photograph. `mix-blend-lighten` is the
          reference's own compositing — the pattern is a dark plate with light
          strokes, so anything else paints a grey box over the banner. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center mix-blend-lighten"
        style={{ backgroundImage: 'url(/images/loyalty/golden-pattern.webp)' }}
      />

      <div
        className={cn(
          'relative mx-auto grid max-w-[1400px] items-center gap-6 px-5 pt-8 text-center text-popo',
          'xl:grid-cols-[40%_60%] xl:gap-0 xl:pt-16 xl:text-start',
        )}
      >
        <div className="grid justify-items-center gap-8 xl:justify-items-start xl:ps-10">
          <div className="grid gap-4">
            <h1 className="font-secondary text-[32px] leading-[1.15] font-normal xl:text-[64px] xl:leading-[72px] xl:font-light">
              Welcome to the Loyalty Club!
            </h1>
            <p className="font-secondary text-xl leading-8 font-light">
              Get rewarded for playing your favourite games!
            </p>
          </div>

          <LevelCta />
        </div>

        {/* Decorative: the heading says everything the render says. */}
        <img
          src="/images/loyalty/banner.webp"
          alt=""
          aria-hidden="true"
          width={880}
          height={632}
          className="mx-auto h-auto w-full max-w-[560px] xl:max-w-[880px]"
        />
      </div>

      <ul
        className={cn(
          'relative mx-auto grid max-w-[1104px] grid-cols-3 items-start gap-2 px-5 pt-8 text-center',
          'lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:gap-4 lg:pt-10',
        )}
      >
        {LOYALTY_PROMISES.map((promise, index) => (
          <li key={promise.title} className="contents">
            {/* The arrow belongs BETWEEN two promises, so it is drawn ahead of
                every promise but the first. `contents` keeps both the arrow
                and the promise as direct grid items of the track above. */}
            {index > 0 && (
              <img
                src="/images/loyalty/arrow-curved.svg"
                alt=""
                aria-hidden="true"
                width={80}
                height={27}
                className="hidden h-auto w-20 self-center lg:block rtl:-scale-x-100"
              />
            )}
            <div className="grid grid-rows-[80px_auto] items-start justify-items-center gap-2">
              <img
                src={promise.art}
                alt=""
                aria-hidden="true"
                width={80}
                height={80}
                className="h-auto w-14 sm:w-20"
              />
              <div>
                <h2 className="font-secondary text-base text-popo">{promise.title}</h2>
                <p className="font-secondary text-sm text-trunks sm:text-base">{promise.body}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Benefits                                                                    */
/* -------------------------------------------------------------------------- */

function Benefits() {
  return (
    <section className="grid gap-8">
      <SectionHeading>6 Benefits of the Loyalty Club</SectionHeading>

      <Deck label="Loyalty Club benefits" className="xl:grid-cols-3">
        {LOYALTY_BENEFITS.map((benefit) => (
          <DeckItem key={benefit.title}>
            <div className="grid h-full min-h-[260px] grid-rows-[100px_auto] items-center justify-items-center gap-2 rounded-i-sm bg-gohan p-6 text-center">
              <img
                src={benefit.art}
                alt=""
                aria-hidden="true"
                width={128}
                height={128}
                className="h-auto w-32"
              />
              <div className="grid gap-2">
                <h3 className="font-secondary text-base font-medium text-krillin">
                  {benefit.title}
                </h3>
                <p className="font-secondary text-base leading-6 text-bulma">{benefit.body}</p>
              </div>
            </div>
          </DeckItem>
        ))}
      </Deck>

      <LevelCta className="justify-self-center" />
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Levels                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The seven tiers.
 *
 * This one stays a scroller at every width — seven 320px cards are 2.2k of
 * track, so there is no viewport this collapses into a grid on, and the
 * reference does not try.
 *
 * `scroll-mt-20` is for the three CTAs: they are `#levels` anchors, and the
 * header is fixed at 64px over the top of the page.
 */
function Levels() {
  return (
    <section id="levels" className="grid scroll-mt-20 gap-6">
      <div className="grid gap-2 text-center">
        <SectionHeading>You can achieve 7 levels</SectionHeading>
        <p className="font-secondary text-base text-bulma">
          The higher the level, the better the benefits.
        </p>
      </div>

      <Deck label="Loyalty levels">
        {LOYALTY_TIERS.map((tier) => (
          <TierCard key={tier.name} tier={tier} current={tier.name === LOYALTY.tier} />
        ))}
      </Deck>
    </section>
  );
}

function TierCard({ tier, current }) {
  return (
    <li className="w-72 shrink-0 snap-start xl:w-80">
      {/* The gold frame is a background, not a border: it is one SVG drawn
          across the top of the card at its own aspect ratio, which no border
          or ring can reproduce. `bg-top` + `100% auto` is the reference's own
          sizing. */}
      <div
        className="relative grid h-full min-h-[420px] content-start gap-1 rounded-i-md bg-gohan bg-top bg-no-repeat px-8 py-6 text-center"
        style={{
          backgroundImage: 'url(/images/loyalty/levels-border.svg)',
          backgroundSize: '100% auto',
        }}
      >
        <img
          src={tier.art}
          alt=""
          aria-hidden="true"
          width={96}
          height={96}
          className="mx-auto mb-2 h-24 w-24 object-contain"
        />

        <h3 className="font-secondary text-2xl font-normal text-piccolo">{tier.name}</h3>

        {/* Ours, not the reference's: which tier the account is actually on,
            from `LOYALTY`. It is what makes "Find out your Loyalty level"
            answer anything.

            The slot is on every card, `invisible` on six of them, so the facts
            below start on the same line across the row. Marking one card by
            pushing its contents 28px down would be worse than not marking it. */}
        <p
          aria-hidden={!current}
          className={cn(
            'justify-self-center rounded-full bg-piccolo px-3 py-0.5 text-xs font-medium text-goten',
            !current && 'invisible',
          )}
        >
          Your level
        </p>

        <TierFact label="Points:">{tier.points}</TierFact>
        <TierRule />
        <TierFact label="Points multiplier:">{tier.multiplier}</TierFact>
        {tier.milestones && (
          <>
            <TierRule />
            <TierFact label="Milestone rewards:">{tier.milestones}</TierFact>
          </>
        )}
      </div>
    </li>
  );
}

function TierFact({ label, children }) {
  return (
    <div className="grid gap-1">
      <p className="font-secondary text-sm text-trunks">{label}</p>
      <p className="font-secondary text-lg text-bulma">{children}</p>
    </div>
  );
}

/** Dashed, not solid — the reference's `border-dashed border-trunks` hairline. */
function TierRule() {
  return <hr className="my-2 border-0 border-t border-dashed border-trunks" />;
}

/* -------------------------------------------------------------------------- */
/* Profits                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Three claims beside one render, where picking a claim swaps the render.
 *
 * The rows are real buttons: they change what the section shows, so they are
 * controls, not decoration. `aria-pressed` carries the selection, and the
 * picture is `aria-hidden` because the row already says everything it says.
 */
function Profits() {
  const [active, setActive] = useState(0);

  return (
    <section className="grid items-center gap-6 xl:grid-cols-2">
      <div className="grid w-full max-w-[544px] gap-4 justify-self-center xl:justify-self-end">
        <SectionHeading className="xl:justify-start">Enjoy these Profits:</SectionHeading>

        <ul className="grid gap-2">
          {LOYALTY_PROFITS.map((profit, index) => (
            <li key={profit.title}>
              <button
                type="button"
                aria-pressed={index === active}
                onClick={() => setActive(index)}
                className={cn(
                  'grid w-full cursor-pointer grid-flow-col justify-items-start gap-x-2 rounded-i-sm p-6 text-start transition-colors',
                  '[grid-template-columns:auto_1fr]',
                  index === active ? 'bg-gohan' : 'hover:bg-heles',
                )}
              >
                <Icon name="check" size={24} className="mt-1 text-piccolo" />
                <div>
                  <h3 className="font-secondary text-xl font-normal text-bulma md:text-2xl">
                    {profit.title}
                  </h3>
                  <p className="font-secondary text-base text-trunks md:text-lg">{profit.body}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <img
        src={LOYALTY_PROFITS[active].art}
        alt=""
        aria-hidden="true"
        width={544}
        height={544}
        className="mx-auto h-auto w-full max-w-[400px] xl:max-w-[544px]"
      />
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Divider                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The 4px gold rule with the diamond cluster sitting on it. Full-bleed, like
 * the hero — it is a band across the page, not a rule inside the column.
 */
function DiamondRule() {
  return (
    <div aria-hidden="true" className="relative -mx-4 my-4 h-1 bg-krillin md:-mx-8">
      <img
        src="/images/loyalty/line-diamonds.svg"
        alt=""
        width={196}
        height={40}
        className="absolute start-1/2 top-1/2 h-auto w-[196px] -translate-x-1/2 -translate-y-1/2 rtl:translate-x-1/2"
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Progress                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `tone` reaches this as a token NAME, so the class has to be looked up rather
 * than built: Tailwind scans source text, and `text-${tone}` is not text it
 * can see.
 */
const TONES = {
  piccolo: 'text-piccolo',
  krillin: 'text-krillin',
  cell: 'text-cell',
  whis: 'text-whis',
};

function Progress() {
  return (
    <section className="relative grid gap-6 pb-8 text-center">
      {/* The scribbles either side of the heading. Hidden below `lg`, where
          the column is too narrow for them to be anything but clutter — which
          is what the reference does with them too. */}
      <img
        src="/images/loyalty/color-elements-a.svg"
        alt=""
        aria-hidden="true"
        width={282}
        height={224}
        className="pointer-events-none absolute -start-4 top-20 hidden h-auto w-[282px] xl:block"
      />
      <img
        src="/images/loyalty/color-elements-b.svg"
        alt=""
        aria-hidden="true"
        width={198}
        height={292}
        className="pointer-events-none absolute -end-4 top-12 hidden h-auto w-[198px] xl:block"
      />

      <div className="relative grid gap-2">
        <SectionHeading>Your level progress</SectionHeading>
        <p className="font-secondary text-base text-bulma">
          At any time, you can check your level progress and points earned under your profile.
        </p>
      </div>

      <Deck label="How loyalty progress works" wrapperClassName="relative mx-auto w-full max-w-[1104px]" className="xl:grid-cols-4">
        {LOYALTY_PROGRESS.map((card) => (
          <DeckItem key={card.title}>
            <div className="grid h-full content-start gap-3 rounded-i-sm border border-beerus bg-goku p-6 text-start">
              <h3 className={cn('font-secondary text-base font-normal', TONES[card.tone])}>
                {card.title}
              </h3>
              <ul className="grid list-disc gap-3 ps-4 marker:text-trunks">
                {card.points.map((point) => (
                  <li key={point} className="font-secondary text-base text-bulma">
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </DeckItem>
        ))}
      </Deck>

      <LevelCta className="relative justify-self-center" />
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                               */
/* -------------------------------------------------------------------------- */

/**
 * A section title, with the small gold flourish the reference puts either side
 * of it **below `md` only** — the ornament exists to fill the width a phone
 * leaves around a short centred heading, and looks like debris beside one that
 * already has a wide column to itself.
 */
function SectionHeading({ children, className }) {
  return (
    <div className={cn("grid grid-flow-col items-center justify-center gap-3", className)}>
      <Flourish />
      <h2 className="font-secondary text-2xl font-light text-bulma">{children}</h2>
      <Flourish mirrored />
    </div>
  );
}

function Flourish({ mirrored }) {
  return (
    <img
      src="/images/loyalty/heading-flourish.svg"
      alt=""
      aria-hidden="true"
      width={31}
      height={18}
      className={cn('h-auto w-[31px] md:hidden', mirrored && '-scale-x-100')}
    />
  );
}

/**
 * The page's one call to action, three times over.
 *
 * A fragment anchor rather than a `Link`, because it moves within the page —
 * but the scroll is driven from the handler rather than left to the browser.
 * Native fragment navigation does not move this page: the app is a
 * client-rendered route, and by the time the hash lands the browser has already
 * decided where the document was. `scrollIntoView` is deterministic, and
 * `preventDefault` keeps the three buttons from stacking history entries.
 *
 * The `href` stays, so the control is still a link to middle-click, to focus,
 * and to read out.
 */
function LevelCta({ className }) {
  function onClick(event) {
    const target = document.getElementById('levels');
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <Button as="a" href="#levels" onClick={onClick} className={cn('ps-4 pe-2 text-base', className)}>
      Find out your Loyalty level
      <Icon name="chevron-right" size={24} className="rtl:-scale-x-100" />
    </Button>
  );
}

/**
 * A row of cards that scrolls sideways on a narrow screen and becomes a grid
 * once there is room — which is what the reference does, except that it ships
 * the carousel and the grid as two separate DOM subtrees and hides one of
 * them. One subtree that changes `display` says the same thing and cannot
 * drift.
 *
 * `className` supplies the grid at `xl` (`xl:grid-cols-3`, say). Leave it off
 * and the row scrolls at every width, which is what the tier table wants.
 *
 * The paging buttons are the same control `Rail` floats over the game rows,
 * and follow the same rule: only the direction you can actually travel is
 * shown, and both are hidden while the row fits.
 */
function Deck({ label, className, wrapperClassName, children }) {
  const ref = useRef(null);
  const [canScroll, setCanScroll] = useState({ start: false, end: false });

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Math.abs keeps this correct under RTL, where scrollLeft goes negative.
    const offset = Math.abs(el.scrollLeft);
    const max = el.scrollWidth - el.clientWidth;
    setCanScroll({ start: offset > 8, end: offset < max - 8 });
  }, []);

  useEffect(() => {
    sync();
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sync, children]);

  const page = (direction) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    // `min-w-0` is load-bearing: a grid or flex item's automatic minimum size
    // is its content, so without it a 2336px row of cards widens the section
    // that holds it instead of scrolling inside it.
    <div className={cn("relative min-w-0", wrapperClassName)}>
      <ul
        ref={ref}
        onScroll={sync}
        aria-label={label}
        className={cn(
          'no-scrollbar flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1',
          className && `${className} xl:grid xl:overflow-x-visible xl:pb-0`,
        )}
      >
        {children}
      </ul>

      {[-1, 1].map((direction) => {
        const enabled = direction === -1 ? canScroll.start : canScroll.end;
        return (
          <button
            key={direction}
            type="button"
            onClick={() => page(direction)}
            tabIndex={enabled ? 0 : -1}
            aria-hidden={!enabled}
            aria-label={direction === -1 ? `Scroll ${label} left` : `Scroll ${label} right`}
            className={cn(
              'absolute top-1/2 z-10 hidden size-8 -translate-y-1/2 place-items-center',
              'rounded-full bg-goku text-bulma shadow-[0_2px_10px_rgba(0,0,0,0.18)]',
              'transition-opacity hover:bg-gohan md:grid',
              className && 'xl:hidden',
              direction === -1 ? '-start-3' : '-end-3',
              enabled ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
          >
            <Icon name={direction === -1 ? 'chevron-left' : 'chevron-right'} size={18} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * One card in a `Deck`. Fixed 288px while the row scrolls; free to fill its
 * track once the row is a grid.
 */
function DeckItem({ children }) {
  return <li className="w-72 shrink-0 snap-start xl:w-auto">{children}</li>;
}
