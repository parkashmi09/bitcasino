import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { Icon } from '@/components/ui/Icon';
import { usePopover } from '@/hooks/usePopover';
import { useReferral } from '@/hooks/useReferral';
import {
  REFERRAL_FAQ,
  REFERRAL_FAQ_VISIBLE,
  REFERRAL_STEPS,
  REFERRAL_TERMS,
  REFERRAL_TIERS,
} from '@/data/referral';
import { cn } from '@/lib/cn';

/**
 * `/profile/refer-a-friend`.
 *
 * Four bands under the account tab bar: the invite banner, `How does it
 * work?`, then a split between the referral list and a column holding the
 * statistics and the FAQ.
 *
 * Measured off `bitcasino.io/profile/refer-a-friend` with
 * `getBoundingClientRect` and `getComputedStyle`, by the procedure in
 * `docs/11-comparing-against-the-reference.md`:
 *
 *   page        `grid gap-4`
 *   banner      290px tall, 24px radius, `#fbf7f7`, art bleeding off the end
 *   heading     32px/40 weight 300, Space Grotesk, capped at `max-w-sm`
 *   link row    `grid-cols-[2fr_1fr] gap-2`, 40px tall, capped at `max-w-md`
 *   link box    `goku`, 8px radius, the URL truncated, a copy glyph after it
 *   consent     12px `trunks`, the terms link underlined in `popo`
 *   steps       heading 24px light, 30px and centred from `md`
 *   step        32px badge below `md`, 48px above; ring `#e0cdac`; title 16px
 *               semibold then 20px; body 14px `trunks` then 16px
 *   dots        `linear-gradient(#000 4%, transparent 0)` at `1px 20px`,
 *               `repeat-y` — a 1px dot every 20px. Vertical and 208px tall
 *               below `md`, horizontal and 70% wide above it
 *   split       `flex gap-4` with a 1px `beerus` rule between the columns
 *   stats       20px/32 light label over a 56px/64 light figure, 128px art
 *   card        1px `beerus`, 8px radius, 20px pad with 24px at the bottom
 *   faq         16px semibold question, 14px answer, `beerus` rule between
 *
 * ## What is real
 *
 * All of it except the copy. The platform has a referral programme —
 * `GET /user/profile/referral` for the code, `GET /user/affiliate/team` for
 * the count and `GET /user/affiliate/rewards` for the amount — so the link,
 * `Total Referrals` and `Total earned` are this account's own numbers rather
 * than fixtures. `hooks/useReferral` holds that.
 *
 * The invite link is `<origin>/ref/<code>`, and `App.jsx` redirects `/ref/:code`
 * into `/register?ref=<code>` — the parameter `SignUp` already reads and
 * resolves against `GET /profile/verify-referral/:code`. So the link a player
 * copies here is one their friend can actually open, end to end.
 *
 * The steps, the prize table and the FAQ are the reference's published terms
 * and live in `data/referral.js`; `docs/07-assets.md` records them alongside
 * the artwork.
 *
 * ## Responsiveness — the one place this page leaves the reference
 *
 * The reference's split band is `relative flex gap-4` with a `w-2/5` column
 * and a `min-w-[402px]` FAQ card, and it carries **no responsive classes at
 * all**: below about 1000px its own page overflows sideways and the statistics
 * column runs off the screen. Measured at a 767px viewport, the FAQ card sits
 * outside the viewport entirely.
 *
 * So the split stacks below `xl` here and is the reference's two columns above
 * it. Everything else — the banner, the steps, the dotted connectors, the
 * cards — is the reference's own responsive behaviour, including the `md`
 * switch that turns the three steps from a vertical list with a dotted spine
 * into a row under a dotted rule. `docs/11` records the difference.
 */
export function Refer() {
  const { link, referrals, earned, status } = useReferral();
  const [termsOpen, setTermsOpen] = useState(false);

  return (
    <div className="grid gap-4">
      <InviteBanner link={link} status={status} onOpenTerms={() => setTermsOpen(true)} />
      <HowItWorks />

      <section className="flex flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1 xl:me-8">
          <NoReferrals link={link} status={status} />
        </div>

        {/* A rule, not a border: it is between the columns and belongs to
            neither. Horizontal while they are stacked, vertical once they are
            side by side — the reference only ever draws the vertical one. */}
        <hr className="h-px w-full border-0 bg-beerus xl:h-auto xl:min-h-[1000px] xl:w-px" />

        <div className="flex flex-col gap-8 xl:ms-8 xl:w-2/5 xl:max-w-xl">
          <Statistics referrals={referrals} earned={earned} status={status} />
          <Faq />
        </div>
      </section>

      <ReferralTermsDialog open={termsOpen} onClose={() => setTermsOpen(false)} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Banner                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The invite banner.
 *
 * `#fbf7f7` is the reference's own literal, one step off `gohan` (`#F9F7F6`)
 * and not a token on either site — so it is written as a literal here too
 * rather than rounded into `bg-gohan`, which would be a different colour on a
 * dark theme as well as a different colour on a light one.
 *
 * The art is three layers, the reference's own: the pale ground and the gold
 * filigree each fill the card, and the megaphone render sits against the end
 * edge at half width. All three are `aria-hidden` because the heading beside
 * them says everything they say. Below `md` the whole art
 * column is dropped — the reference does the same, and a 290px card cannot
 * hold both a three-line heading and a picture on a phone.
 */
function InviteBanner({ link, status, onOpenTerms }) {
  return (
    <section className="relative flex w-full overflow-hidden rounded-3xl bg-[#fbf7f7] md:h-[290px]">
      <div className="relative z-1 flex w-full flex-col gap-6 px-6 py-6 md:w-3/4 md:gap-8">
        <h1 className="max-w-sm font-secondary text-[32px] leading-10 font-light text-popo">
          Invite friends and get up to 5,000 USDT
        </h1>

        <LinkRow link={link} status={status} className="max-w-md" />

        <p className="max-w-[420px] text-xs leading-4 text-trunks">
          By proceeding, I agree to the{' '}
          {/* The reference opens its terms in a dialog rather than sending the
              player off the page, so the consent line is a button, not a link.
              The terms themselves are `data/referral.js#referral-terms`. */}
          <button
            type="button"
            onClick={onOpenTerms}
            className="cursor-pointer text-popo underline underline-offset-2 transition-colors hover:text-piccolo"
          >
            Referral Terms &amp; Conditions
          </button>{' '}
          and understand that anyone with my invite link will be aware I use
          Bitcasino.
        </p>
      </div>

      <div aria-hidden="true" className="relative hidden w-full md:block">
        <img
          src="/images/refer/faded-background.webp"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <img
          src="/images/refer/gold-element.webp"
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
        <img
          src="/images/refer/speaker.png"
          alt=""
          className="absolute inset-y-0 end-0 h-full w-1/2 object-cover"
        />
      </div>
    </section>
  );
}

/**
 * The reference's share menu: the four networks it offers, each with the
 * network's own mark and web share intent.
 *
 * The marks are fetched off the reference's CDN, along with everything else on
 * this page — see their row in `docs/07-assets.md`. The intents are the
 * networks' own share endpoints, with one deviation worth naming: Messenger
 * has no app-free web share URL — its Send Dialog demands an `app_id` and its
 * `fb-messenger://` scheme is mobile-only — so that row points at Facebook's
 * app-free sharer instead.
 */
const SHARE_TARGETS = [
  {
    id: 'telegram',
    label: 'Share via Telegram',
    icon: '/images/refer/share-telegram.png',
    intent: (link) => `https://t.me/share/url?url=${encodeURIComponent(link)}`,
  },
  {
    id: 'whatsapp',
    label: 'Share via WhatsApp',
    icon: '/images/refer/share-whatsapp.svg',
    intent: (link) => `https://wa.me/?text=${encodeURIComponent(link)}`,
  },
  {
    id: 'messenger',
    label: 'Share via Messenger',
    icon: '/images/refer/share-messenger.svg',
    intent: (link) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
  },
  {
    id: 'line',
    label: 'Share via Line',
    icon: '/images/refer/share-line.svg',
    intent: (link) => `https://line.me/R/msg/?text=${encodeURIComponent(link)}`,
  },
];

/**
 * The invite link and the two things you can do with it.
 *
 * `grid-cols-[2fr_1fr]` is the reference's: the link takes two thirds and
 * `Share` the last third, so the two grow together instead of the link
 * swallowing the button on a wide card.
 *
 * The link itself is a **button**, not a link — pressing it copies. That is
 * what the reference does, and it is why the URL inside it is a `<p>` rather
 * than an `<a>`: an anchor here would navigate the player to their own invite
 * page instead of putting it on their clipboard.
 *
 * `Share` opens the reference's four-network menu. It is `fixed`, not
 * `absolute`: the banner's `overflow-hidden` clips anything absolute to the
 * card, and a fixed panel measured off the trigger escapes it the same way
 * `Sidebar`'s rail tip and the operator notice do — no portal.
 */
function LinkRow({ link, status, className }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const { open, toggle, close, ref } = usePopover();
  const [anchor, setAnchor] = useState(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // A fixed panel needs the trigger's box at the moment the menu opens. It
  // never repositions: the menu closes on the things that would un-moor it —
  // a scroll, a resize, a click elsewhere, Escape.
  useEffect(() => {
    if (!open) return undefined;
    const box = ref.current?.getBoundingClientRect();
    if (!box) return undefined;
    const panelWidth = 288; // `w-72` = 18rem, in px.
    setAnchor({
      top: box.bottom + 8,
      left: Math.max(8, Math.min(box.right - panelWidth, window.innerWidth - panelWidth - 8)),
    });
    const detach = () => close();
    window.addEventListener('resize', detach);
    window.addEventListener('scroll', detach, true);
    return () => {
      setAnchor(null);
      window.removeEventListener('resize', detach);
      window.removeEventListener('scroll', detach, true);
    };
  }, [open, close, ref]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Denied clipboard permission, or an insecure origin. The link is on
      // screen and selectable either way, so there is nothing to recover —
      // but claiming it was copied when it was not would be worse than
      // saying nothing.
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1800);
  }

  const label = status === 'loading' ? 'Loading your invite link…' : link;

  return (
    <div ref={ref} className={cn('grid grid-cols-[2fr_1fr] items-center gap-2', className)}>
      <button
        type="button"
        onClick={copy}
        disabled={!link}
        aria-label={link ? `Copy invite link ${link}` : 'Invite link'}
        className={cn(
          'flex h-10 min-w-0 cursor-pointer items-center justify-between gap-2 rounded-i-sm bg-goku px-4',
          'text-start transition-colors hover:bg-heles disabled:cursor-default disabled:opacity-60',
        )}
      >
        <span className="min-w-0 truncate text-base text-popo">
          {label ?? 'No invite link yet'}
        </span>
        <Icon name={copied ? 'check' : 'copy'} size={20} className="text-popo" />
      </button>

      <Button
        variant="secondary"
        onClick={toggle}
        disabled={!link}
        aria-haspopup="menu"
        aria-expanded={open}
        fullWidth
        className="text-base"
      >
        Share
        <Icon name="share" size={18} />
      </Button>

      {open && anchor && (
        <div
          role="menu"
          aria-label="Share your invite link"
          style={{ top: anchor.top, left: anchor.left }}
          className="fixed z-50 w-72 origin-top-right animate-menu-in rounded-i-md border-[0.8px] border-beerus bg-goku p-1 shadow-lg"
        >
          {SHARE_TARGETS.map((target) => (
            <a
              key={target.id}
              role="menuitem"
              href={target.intent(link)}
              target="_blank"
              rel="noreferrer"
              onClick={close}
              className="flex h-10 w-full items-center justify-between gap-2 rounded-i-sm px-2 text-sm text-bulma transition-colors hover:bg-heles"
            >
              <span className="flex items-center gap-2">
                <img src={target.icon} alt="" className="size-6" />
                <span>{target.label}</span>
              </span>
            </a>
          ))}
        </div>
      )}

      {/* Announced without moving focus, which is the whole point of a copy
          confirmation — the player is about to paste, not to read the page. */}
      <p aria-live="polite" className="sr-only">
        {copied ? 'Invite link copied' : ''}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* How it works                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The dotted connector, drawn the reference's way: a background gradient that
 * is 4% opaque colour and 96% nothing, tiled every 20px, which paints one 1px
 * dot per tile. A `border-dashed` cannot do this — its dashes are wider than
 * they are tall and scale with the border width.
 *
 * Vertical and 208px tall while the steps are a list; horizontal and 70% of
 * the band once they are a row.
 */
const DOTS_VERTICAL = {
  backgroundImage: 'linear-gradient(rgb(0 0 0) 4%, rgba(255,255,255,0) 0%)',
  backgroundSize: '1px 20px',
  backgroundRepeat: 'repeat-y',
  backgroundPosition: '50% 0',
};

const DOTS_HORIZONTAL = {
  backgroundImage: 'linear-gradient(to right, rgb(0 0 0) 4%, rgba(255,255,255,0) 0%)',
  backgroundSize: '20px 1px',
  backgroundRepeat: 'repeat-x',
  backgroundPosition: '0 50%',
};

function HowItWorks() {
  return (
    <section className="flex w-full flex-col gap-4 md:mt-8 md:gap-10">
      <h2 className="w-full font-secondary text-2xl font-light text-bulma md:text-center md:text-3xl">
        How does it work?
      </h2>

      {/* The connector is one element behind all three steps, not a border on
          each — it has to run BETWEEN the badges, which a per-step border
          would stop short of, and behind them, which is what the opaque
          `bg-goku` badge does to it.

          The reference positions it as a sibling above the list and gives the
          vertical run a fixed `h-52`. Positioned that way it lands 24px above
          the badge centres rather than through them, and the fixed height is
          tied to their exact step copy. Both runs are inset off the list here
          instead: `start-4` is the 32px badge's centre while the steps are a
          column, `top-10` the 48px badge's centre once they are a row —
          16px of the step's own `md:p-4` plus half the badge.

          The three steps also take equal widths at `md` (`md:flex-1`), which
          the reference does not: its steps are content-sized, so its badges sit
          414px and 359px apart and the rule it centres between them is off
          each end by a different amount. */}
      <div className="relative flex md:block">
        <span
          aria-hidden="true"
          style={DOTS_VERTICAL}
          className="pointer-events-none absolute start-4 top-4 bottom-4 w-px md:hidden"
        />
        <span
          aria-hidden="true"
          style={DOTS_HORIZONTAL}
          className="pointer-events-none absolute start-1/2 top-10 hidden h-px w-[70%] -translate-x-1/2 md:block"
        />

        <ol className="relative flex flex-col justify-center gap-8 md:flex-row md:gap-4">
          {REFERRAL_STEPS.map((step, index) => (
            <li
              key={step.title}
              className={cn(
                'flex max-w-sm gap-4',
                'md:max-w-[496px] md:flex-1 md:flex-col md:items-center md:p-4 md:px-2 md:text-center',
              )}
            >
              <span
                className={cn(
                  'grid h-8 w-8 min-w-8 place-items-center rounded-full bg-goku drop-shadow-md',
                  'md:h-12 md:w-12 md:min-w-12',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid h-6 w-6 place-items-center rounded-full border-2 border-[#e0cdac] text-sm',
                    'md:h-10 md:w-10 md:text-xl',
                  )}
                >
                  {index + 1}
                </span>
              </span>

              <div className="flex flex-col pt-1 md:pt-0">
                <h3 className="mb-2 text-base font-semibold text-bulma md:mt-8 md:mb-3 md:text-xl">
                  {step.title}
                </h3>
                <p className="text-sm text-trunks md:px-12 md:text-base">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Referral list                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The list column.
 *
 * There is only an empty state, and that is not a gap: `GET /affiliate/team`
 * answers a `members[]` array, but the reference's populated view is a 30-day
 * progress bar per referral whose progress this platform reports nowhere —
 * `Rewards` rows carry an amount and a date, not a points total against a
 * 30-day window. Inventing a bar and animating it to a number we made up would
 * be the one thing on this page that is not real, so the count and the amount
 * are shown in the statistics column instead, where they are exact.
 */
function NoReferrals({ link, status }) {
  return (
    <div className="flex justify-center pt-12 md:pt-32">
      <div className="grid gap-4">
        <div className="grid justify-items-center gap-4 text-center">
          <Icon name="frown" size={32} className="text-bulma" />
          <h2 className="text-base leading-6 font-semibold text-bulma">No referrals</h2>
          <p className="max-w-[240px] text-base leading-6 text-trunks">
            You don’t have any active referrals yet. Invite &amp; start earning rewards
          </p>
        </div>

        {/* The same control as the banner's, on a `goku` ground rather than the
            banner's, so it needs its own border to read as a field. */}
        <LinkRow
          link={link}
          status={status}
          className="w-full max-w-[420px] [&>button]:border [&>button]:border-beerus"
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Statistics                                                                  */
/* -------------------------------------------------------------------------- */

function Statistics({ referrals, earned, status }) {
  return (
    <section className="grid gap-4">
      <h2 className="font-secondary text-2xl font-light text-bulma">Referral statistics</h2>

      <StatCard
        label="Total Referrals"
        value={status === 'loading' ? '—' : String(referrals)}
        art="/images/refer/referral.png"
      />
      <StatCard
        label="Total earned"
        // A string all the way from Postgres — see `useReferral`.
        value={status === 'loading' ? '—' : `${earned} USDT`}
        art="/images/refer/earned.png"
      />
    </section>
  );
}

/**
 * One figure.
 *
 * `-tracking-widest` on a 56px numeral is the reference's own: at that size the
 * default spacing makes `0 USDT` read as three separate things.
 */
function StatCard({ label, value, art }) {
  return (
    <div className="flex flex-col self-start rounded-i-sm border border-beerus px-5 pt-5 pb-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="font-secondary text-xl leading-8 font-light text-bulma">{label}</h3>
          <p className="pt-4 font-secondary text-[56px] leading-16 font-light -tracking-widest text-bulma">
            {value}
          </p>
        </div>
        <img
          src={art}
          alt=""
          aria-hidden="true"
          width={128}
          height={128}
          className="h-32 w-32 shrink-0 object-contain"
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* FAQ                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Six questions, three of them behind `Show more`.
 *
 * Each question is a real disclosure — `aria-expanded`, `aria-controls`,
 * `useId` — which is the same shape `TrustSection` uses on the home page and
 * `Boosts` uses for its explainer.
 */
function Faq() {
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(null);

  const shown = expanded ? REFERRAL_FAQ : REFERRAL_FAQ.slice(0, REFERRAL_FAQ_VISIBLE);

  return (
    <section className="grid gap-6">
      <h2 className="font-secondary text-2xl font-light text-bulma">Faq</h2>

      <div className="flex flex-col self-start rounded-i-sm border border-beerus bg-goku px-5 py-4">
        <ul className="grid">
          {shown.map((item, index) => (
            <li key={item.question}>
              {index > 0 && <hr className="my-4 h-px border-0 bg-beerus" />}
              <FaqItem
                item={item}
                open={open === item.question}
                onToggle={() =>
                  setOpen((current) => (current === item.question ? null : item.question))
                }
              />
            </li>
          ))}
        </ul>

        <div className="py-2">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="w-full cursor-pointer text-center text-sm leading-none font-medium text-bulma underline transition-colors hover:text-piccolo"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        </div>
      </div>
    </section>
  );
}

function FaqItem({ item, open, onToggle }) {
  const id = useId();

  return (
    <>
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={id}
          className="flex w-full cursor-pointer items-start justify-between gap-6 text-start text-base font-semibold text-bulma transition-colors hover:text-piccolo"
        >
          {item.question}
          <Icon
            name="chevron-down"
            size={20}
            className={cn(
              'mt-0.5 shrink-0 transition-transform duration-200',
              open && '-scale-y-100',
            )}
          />
        </button>
      </h3>

      <div id={id} hidden={!open} className="grid gap-3 pt-3">
        {item.body.map((paragraph) => (
          <p key={paragraph} className="text-sm leading-5 text-trunks">
            {paragraph}
          </p>
        ))}

        {item.table && <PrizeTable />}
      </div>
    </>
  );
}

/**
 * The eight reward tiers.
 *
 * `overflow-x-auto` on the wrapper rather than a smaller font: three columns of
 * numbers in a 402px card is already tight, and a table that scrolls inside
 * itself is better than one that pushes the whole page sideways — which is
 * what the split band does on the reference.
 */
function PrizeTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[320px] border-collapse text-sm">
        <thead>
          <tr className="text-start text-bulma">
            <th scope="col" className="py-2 pe-3 text-start font-semibold">
              Level
            </th>
            <th scope="col" className="py-2 pe-3 text-start font-semibold">
              Points
            </th>
            <th scope="col" className="py-2 text-start font-semibold">
              Reward
            </th>
          </tr>
        </thead>
        <tbody>
          {REFERRAL_TIERS.map((tier) => (
            <tr key={tier.level} className="border-t border-beerus text-trunks">
              <td className="py-2 pe-3 whitespace-nowrap">{tier.level}</td>
              <td className="py-2 pe-3 whitespace-nowrap">{tier.points}</td>
              <td className="py-2 whitespace-nowrap">{tier.reward}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Terms dialog                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The "Referral Terms & Conditions" dialog the banner's consent line opens.
 *
 * The reference opens the same panel on both phones and desktops — a 520px
 * card capped at 75% of the viewport (480px from `md` up, which is the
 * reference's own number) that scrolls inside itself — so this rides the
 * app's `Dialog`, which already scrolls the panel and locks the body behind
 * it. The copy is `REFERRAL_TERMS` in `data/referral.js`, and the prize
 * table is the same `PrizeTable` the FAQ answers with.
 *
 * The overview is one numbered list that runs through the table — the
 * reference numbers clause 13 (`Bitcasino reserves the right…`) as 13, not as
 * the restart after a table — so the list is drawn in two runs around it.
 */
function ReferralTermsDialog({ open, onClose }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Refer a Friend Terms & Conditions"
      width="max-w-[520px]"
      maxHeight="max-h-[75%] md:max-h-[480px]"
    >
      <p className="text-sm leading-5 text-trunks">{REFERRAL_TERMS.intro}</p>

      {REFERRAL_TERMS.sections.map((section) => (
        <section key={section.heading} className="grid gap-3">
          <h3 className="pt-2 text-base font-semibold text-bulma">{section.heading}</h3>
          <TermsItemsList items={section.items} />
        </section>
      ))}
    </Dialog>
  );
}

/**
 * A numbered clause list, split around the prize table when one is present so
 * the numbering carries straight through it — the reference's own behaviour.
 */
function TermsItemsList({ items }) {
  const tableAt = items.findIndex(
    (item) => typeof item === 'object' && item && item.table,
  );

  if (tableAt === -1) {
    return <OrderedTermsList items={items} />;
  }

  return (
    <div className="grid gap-3">
      <OrderedTermsList items={items.slice(0, tableAt)} />
      <PrizeTable />
      {/* `start` takes a 1-based number: the marker's index is the number of
          clauses before it. */}
      <OrderedTermsList items={items.slice(tableAt + 1)} start={tableAt + 1} />
    </div>
  );
}

function OrderedTermsList({ items, start }) {
  return (
    <ol
      start={start}
      className="grid list-decimal gap-2 ps-7 text-sm leading-5 text-trunks marker:text-piccolo"
    >
      {items.map((item, index) => (
        <li key={index}>{termItem(item)}</li>
      ))}
    </ol>
  );
}

/**
 * A clause is a string, or an object carrying a link back into the site.
 *
 * The `typeof` guard is load-bearing. `String.prototype.link` is the legacy
 * DOM method named `link`, so `item.link` on a plain string clause is a
 * function and `if (item.link)` alone would send every string down the link
 * branch and empty the list — each clause becoming an empty `<a>` to `to`
 * of `undefined` (the current route). Legacy DOM methods are the reason the
 * guard checks the value is an OBJECT before reading its `.link`.
 */
function termItem(item) {
  if (typeof item === 'object' && item && item.link) {
    return (
      <>
        {item.before}
        <Link
          to={item.link.to}
          className="text-piccolo underline underline-offset-2 transition-colors hover:text-bulma"
        >
          {item.link.label}
        </Link>
        {item.after}
      </>
    );
  }
  return item;
}
