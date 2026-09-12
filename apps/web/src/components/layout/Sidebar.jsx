import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { NavIcon } from '@/components/ui/NavIcon';
import { Logo } from './Logo';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/cn';

/**
 * Navigation column.
 *
 * The reference runs this as a full-height column that owns the brand: the
 * logo and the collapse toggle sit in a 60px block at the top of the sidebar,
 * not in the page header, and the header starts to the right of it. Below `md`
 * that block hides and the logo moves into the header instead — which is why
 * `Header` carries a mobile-only copy.
 *
 * Everything below the brand block scrolls: a promo card, a hairline, then the
 * link groups. Locale and support are pinned to the bottom.
 *
 * ## Collapsing
 *
 * The menu button does not hide the column — it narrows it to an icon rail, as
 * on the reference: 256px → 56px over 200ms linear, labels gone, icons kept.
 * The rail carries `group/rail` and `data-collapsed`, so every piece below
 * styles its own collapsed form through `group-data-[collapsed=true]/rail:`
 * rather than threading a prop down. `MobileSidebar` renders the same nav
 * without that group, so the drawer is always the full-width form.
 *
 * Each link is `{ label, to, icon }`, where `icon` is a NavIcon name.
 */

const PRIMARY = [
  { label: 'Originals', to: '/categories/originals', icon: 'originals' },
  { label: 'New Releases', to: '/games/new', icon: 'new-releases' },
  { label: 'Live RTP', to: '/games/live-rtp', icon: 'live-rtp' },
  { label: 'Promotions', to: '/promotions', icon: 'promotions' },
  { label: 'Tournaments', to: '/tournaments', icon: 'tournaments' },
  { label: 'Providers', to: '/providers', icon: 'providers' },
];

const LIVE_GROUP = [
  { label: 'Live Casino', to: '/categories/live-casino', icon: 'live-casino' },
  { label: 'VIP', to: '/vip', icon: 'vip' },
  { label: 'Table Games', to: '/categories/table-games', icon: 'table-games' },
  { label: 'Slots', to: '/categories/video-slots', icon: 'slots' },
  { label: 'Crash & Instant', to: '/categories/crash', icon: 'crash' },
  { label: 'Game Shows', to: '/categories/game-shows', icon: 'game-shows' },
  { label: 'Jackpots', to: '/categories/jackpots', icon: 'jackpots' },
];

/**
 * Shape shared by every row in the column: a 40px pill that becomes a 32px
 * icon square on the rail. The reference animates `width,height,padding` at
 * the Tailwind default 150ms while the column itself takes 200ms — the row
 * finishes settling before the column does, which is what stops the icons
 * from drifting during the slide.
 */
const ROW = cn(
  'flex h-10 w-full items-center gap-2 overflow-hidden rounded-i-md px-2 text-sm font-medium',
  'transition-[width,height,padding,background-color,color]',
  'group-data-[collapsed=true]/rail:size-8 group-data-[collapsed=true]/rail:justify-center',
  'group-data-[collapsed=true]/rail:p-0',
);

/** Label text, dropped the moment the rail collapses. */
const ROW_LABEL = 'truncate group-data-[collapsed=true]/rail:hidden';

/**
 * The rule between the column's blocks.
 *
 * It fades rather than running flat, which is measurable in a capture of the
 * reference: across the 232px it is `hit` (`#E9E9E9`) at the start and a clean
 * linear ramp to the column background by the end. This was a flat `bg-hit`,
 * which reads as a harder division than the reference draws — the fade is what
 * keeps the promo card and the shortcuts row feeling like one column rather
 * than three boxed sections.
 */
const HAIRLINE = 'mx-3 h-px bg-linear-to-r from-hit to-transparent';

/**
 * The reference replaces each label with a tooltip once the column is a rail.
 * It portals a Radix tooltip to the body; we get the same result from a fixed
 * span positioned off the row's own box, which keeps it clear of the scroll
 * container without a portal. The `group-data` guard means it never fires in
 * the expanded column or the mobile drawer.
 */
function useRailTip() {
  const [tip, setTip] = useState(null);

  const handlers = {
    onMouseEnter: (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setTip({ top: rect.top + rect.height / 2, left: rect.right + 10 });
    },
    onMouseLeave: () => setTip(null),
    onBlur: () => setTip(null),
  };

  return [tip, handlers];
}

function RailTip({ tip, children }) {
  if (!tip) return null;

  return (
    <span
      style={{ top: tip.top, left: tip.left }}
      className={cn(
        'pointer-events-none fixed z-50 hidden -translate-y-1/2 whitespace-nowrap',
        'rounded-md bg-goku px-3 py-1.5 text-xs text-bulma',
        'group-data-[collapsed=true]/rail:block',
      )}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Player shortcuts — the `[★ 0] [Recents n]` row a session adds to the column
 * ---------------------------------------------------------------------- */

/** White disc holding the count. Empty, not `0`, until the number is known. */
function ShortcutBadge({ children }) {
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-goku text-xs font-medium text-bulma">
      {children}
    </span>
  );
}

/**
 * The two pills a signed-in session adds between the promo card and the links.
 *
 * Measured off the reference's own signed-in column (the capture was at 125%
 * browser zoom, so every figure below is the raster divided by 1.25):
 *
 * | | |
 * | --- | --- |
 * | Row | the column's full 232px, two pills, 10px between them |
 * | Pill | 36px tall, `gohan` fill, ~5px radius — tighter than the 12px on the promo card and the Live Games group |
 * | Favourites | content-sized: solid star, then the disc |
 * | Recents | takes the rest: history glyph, label, disc pushed to the end |
 * | Disc | 20px, `goku`, the count in `bulma` |
 * | Icons + label | `bulma` at 70%, which is the measured `#4A4A4A` over `gohan` |
 *
 * The small radius is the load-bearing one: at 12px these read as two more
 * cards stacked under the promo banner, and the reference clearly wants them
 * to read as controls sitting on top of it.
 *
 * Note the labels are lighter than the links below them, which measure pure
 * `bulma`. The row is a shortcut strip, and it says so by not competing with
 * the navigation proper.
 *
 * ## One half navigates, one half does not
 *
 * `Recents` is a real link, to the same `/games/recent` the header's
 * `RecentsLink` points at — the reference wires both controls to one page, and
 * so does this. Its count comes from the same `useRecentlyPlayed` list that
 * page renders, so the badge can never disagree with what opening it shows.
 *
 * The star has nowhere to go: there is no favourites feature, which is the
 * half of this row `docs/11` has carried as a known gap. It is therefore a
 * plain element with no role, no tab stop and no hover — a number you can read
 * rather than a control that swallows the click, which is the same call the
 * account tab bar makes for `Tournaments`. Its `0` is a literal, and a true
 * one: with no way to favourite a game, nobody has any.
 *
 * The rail drops the row outright, like the promo card above it: there is no
 * 56px form of two labelled pills, and the trailing hairline goes with it so
 * the collapsed column does not show two rules in a row.
 */
function PlayerShortcuts({ recentsCount, onNavigate }) {
  const { status } = useAuth();

  if (status !== 'authenticated') return null;

  const pill = 'flex h-9 items-center gap-2 rounded-i-xs bg-gohan px-3 text-bulma/70';

  return (
    <>
      <div className="flex gap-2.5 px-3 pt-2 pb-4 group-data-[collapsed=true]/rail:hidden">
        <div className={pill}>
          <span className="sr-only">Favourites</span>
          <Icon name="star" solid />
          <ShortcutBadge>0</ShortcutBadge>
        </div>

        <NavLink
          to="/games/recent"
          onClick={onNavigate}
          className={cn(pill, 'min-w-0 flex-1 transition-colors hover:bg-beerus')}
        >
          <Icon name="history" />
          <span className="flex-1 truncate text-sm font-medium">Recents</span>
          <ShortcutBadge>{recentsCount}</ShortcutBadge>
        </NavLink>
      </div>

      <div className={cn(HAIRLINE, 'group-data-[collapsed=true]/rail:hidden')} />
    </>
  );
}

function NavItem({ item, onNavigate }) {
  const [tip, handlers] = useRailTip();

  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      {...handlers}
      className={({ isActive }) =>
        cn(ROW, isActive ? 'bg-jiren text-piccolo' : 'text-bulma hover:bg-heles')
      }
    >
      <NavIcon name={item.icon} />
      <span className={ROW_LABEL}>{item.label}</span>
      <RailTip tip={tip}>{item.label}</RailTip>
    </NavLink>
  );
}

/**
 * Brand block at the top of the column — 60px tall, `p-3 pt-4 pb-3`, which
 * puts the 150x32 logo at 12,16 and the 32px toggle at the end of the same
 * 232px row. Hidden below `md`, where the header carries the logo.
 *
 * On the rail the row turns into a column — mark above toggle, 12px apart,
 * exactly as the reference restacks it — so the block grows to 104px and the
 * toggle stays reachable without the header having to grow a second copy.
 */
function SidebarHeader({ collapsed, onToggle }) {
  return (
    <div className="flex flex-col gap-2 p-3 pt-4 pb-3">
      <div
        className={cn(
          'flex items-center justify-between',
          'group-data-[collapsed=true]/rail:flex-col group-data-[collapsed=true]/rail:justify-center',
          'group-data-[collapsed=true]/rail:gap-3',
        )}
      >
        <NavLink to="/" aria-label="Home" className="flex h-8 shrink-0 items-center">
          <Logo markOnly={collapsed} />
        </NavLink>
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!collapsed}
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-gohan text-bulma transition-colors hover:bg-beerus/60"
        >
          <Icon name="menu-collapse" size={16} />
        </button>
      </div>
    </div>
  );
}

export function SidebarNav({ onNavigate, recentsCount }) {
  const [liveOpen, setLiveOpen] = useState(true);
  const [tip, handlers] = useRailTip();

  return (
    <>
      {/* The card is 3px taller than the artwork it holds, exactly as on the
          reference — `min-h` rather than a fixed height. The rail drops it
          outright; there is no 56px-wide form of a 232px banner. */}
      <div className="px-3 pb-2 group-data-[collapsed=true]/rail:hidden">
        <Link
          to="/promotions"
          onClick={onNavigate}
          className="relative block min-h-[78px] overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-piccolo"
        >
          <img
            src="/images/sidebar-promo.avif"
            alt="League — climb the ranks"
            width={232}
            height={75}
            className="size-full object-cover"
          />
        </Link>
      </div>

      <div className={HAIRLINE} />

      <PlayerShortcuts recentsCount={recentsCount} onNavigate={onNavigate} />

      <nav aria-label="Main" className="p-2 px-3">
        <ul className="flex w-full flex-col gap-3 font-medium">
          <li>
            <ul className="flex flex-col gap-1">
              {PRIMARY.map((item) => (
                <li key={item.to}>
                  <NavItem item={item} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </li>

          {/* Grouped section on a raised surface, collapsible like the
              reference. No padding on the box — the buttons inside carry it,
              so the group spans the full 232px column. On the rail the surface
              shrinks to the trigger's own 32px square and the children go, but
              `liveOpen` is untouched, so re-expanding restores the group as it
              was left. */}
          <li className="rounded-xl bg-gohan">
            <button
              type="button"
              onClick={() => setLiveOpen((open) => !open)}
              aria-expanded={liveOpen}
              {...handlers}
              className={cn(ROW, 'rounded-xl text-bulma hover:bg-heles')}
            >
              <NavIcon name="live-games" />
              <span className={ROW_LABEL}>Live Games</span>
              <span className="ms-auto grid size-6 place-items-center rounded-md group-data-[collapsed=true]/rail:hidden">
                <Icon
                  name="chevron-down"
                  size={16}
                  className={cn('text-bulma transition-transform', liveOpen && 'rotate-180')}
                />
              </span>
              <RailTip tip={tip}>Live Games</RailTip>
            </button>

            {liveOpen && (
              <ul className="flex flex-col gap-1 group-data-[collapsed=true]/rail:hidden">
                {LIVE_GROUP.map((item) => (
                  <li key={item.to}>
                    <NavItem item={item} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        </ul>
      </nav>
    </>
  );
}

/** Locale and support, pinned below the scrolling link list. */
function SidebarFooter() {
  const [localeTip, localeHandlers] = useRailTip();
  const [supportTip, supportHandlers] = useRailTip();

  return (
    <div className="flex flex-col gap-2 p-2 px-3">
      <button
        type="button"
        {...localeHandlers}
        className={cn(ROW, 'rounded-xl bg-hit p-2 text-bulma hover:bg-beerus')}
      >
        <img
          src="/images/ui/flag-en.svg"
          alt=""
          width={20}
          height={20}
          className="size-5 shrink-0 rounded-sm object-cover"
        />
        <span className={cn(ROW_LABEL, 'flex-1 text-start')}>English</span>
        <Icon
          name="chevron-down"
          size={16}
          className="ms-auto text-trunks group-data-[collapsed=true]/rail:hidden"
        />
        <RailTip tip={localeTip}>English</RailTip>
      </button>

      <button
        type="button"
        {...supportHandlers}
        className={cn(ROW, 'rounded-xl bg-hit p-2 text-bulma hover:bg-beerus')}
      >
        <Icon name="headset" size={16} className="mx-0.5 shrink-0 text-trunks" />
        <span className={cn(ROW_LABEL, 'flex-1 text-start')}>Support</span>
        <span className="ms-auto inline-flex items-center gap-1.5 text-xs text-trunks group-data-[collapsed=true]/rail:hidden">
          Chat
          <span className="size-2 rounded-full bg-roshi" />
        </span>
        <RailTip tip={supportTip}>Support</RailTip>
      </button>
    </div>
  );
}

/**
 * Persistent full-height column from `md`, mirroring the reference.
 *
 * Collapsing narrows it to the reference's 56px icon rail rather than removing
 * it. The width is the only animated property — everything inside is laid out
 * against it, so one 200ms linear tween carries the whole column and the page
 * content reflowing beside it.
 */
export function Sidebar({ collapsed, onToggle, recentsCount }) {
  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'group/rail sticky top-0 hidden h-dvh shrink-0 flex-col overflow-hidden bg-goku md:flex',
        'transition-[width] duration-200 ease-linear',
        collapsed ? 'w-14' : 'w-64',
      )}
    >
      <SidebarHeader collapsed={collapsed} onToggle={onToggle} />
      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto group-data-[collapsed=true]/rail:overflow-hidden">
        <SidebarNav recentsCount={recentsCount} />
      </div>
      <SidebarFooter />
    </aside>
  );
}

/** Slide-over variant used below the `md` breakpoint. */
export function MobileSidebar({ open, onClose, recentsCount }) {
  return (
    <div
      className={cn('fixed inset-0 z-50 md:hidden', !open && 'pointer-events-none')}
      aria-hidden={!open}
    >
      <div
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-zeno transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className={cn(
          'absolute inset-y-0 start-0 flex w-64 max-w-[calc(100vw-10px)] flex-col bg-goku shadow-xl',
          'transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between px-3">
          <Logo />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="grid size-10 place-items-center rounded-i-sm text-bulma hover:bg-heles"
          >
            <Icon name="close" size={22} />
          </button>
        </div>
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
          <SidebarNav onNavigate={onClose} recentsCount={recentsCount} />
        </div>
        <SidebarFooter />
      </div>
    </div>
  );
}
