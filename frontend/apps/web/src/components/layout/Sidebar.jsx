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
 * without that group, so the sheet is always the full-width form.
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
  { label: 'Live Exclusives', to: '/themes/live-exclusives', icon: 'live-exclusive' },
  /* `/themes/vip-prive`, not `/vip`. They are two different pages on the
     reference and this row is the first: the high-limit room, a grid of twenty
     Salon Prive tables. `/vip` is the account's own VIP standing, which the
     reference links as `VIP Club` from the footer — and which this site's
     footer links there too. */
  { label: 'VIP Prive', to: '/themes/vip-prive', icon: 'vip' },
  { label: 'Baccarat', to: '/categories/baccarat', icon: 'baccarat' },
  { label: 'Blackjack', to: '/categories/blackjack', icon: 'blackjack' },
  { label: 'Roulette', to: '/categories/roulette', icon: 'roulette' },
  { label: 'Game Shows', to: '/categories/game-shows', icon: 'game-shows' },
  { label: 'All Live Casino Games', to: '/categories/live-casino', icon: 'live' },
];

const GAMES = [
  { label: 'Slots', to: '/categories/video-slots', icon: 'slots' },
  /* Themes, not categories. Neither is a game type — one is five own-brand
     titles and the other is every slot with a feature — and the reference
     files both under `/themes/`. The spellings are its own: `Bitcasino`
     without the inner capital, and `Buy-in` with a lower-case `i`. */
  { label: 'Bitcasino Exclusives', to: '/themes/bitcasino-exclusives', icon: 'bitcasino-exclusive' },
  { label: 'Jackpots', to: '/categories/jackpots', icon: 'jackpots' },
  { label: 'Crash & Instant', to: '/categories/crash', icon: 'crash' },
  { label: 'Bonus Buy-in', to: '/themes/bonus-buy-in', icon: 'bonus-buy' },
  { label: 'Table Games', to: '/categories/table-games', icon: 'table-games' },
  { label: 'All Games', to: '/games', icon: 'all-games' },
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
 * ## Both halves navigate now
 *
 * `Recents` is a real link, to the same `/games/recent` the header's
 * `RecentsLink` points at — the reference wires both controls to one page, and
 * so does this. Its count comes from the same `useRecentlyPlayed` list that
 * page renders, so the badge can never disagree with what opening it shows.
 *
 * The star is the same shape, to `/games/favourite` — the reference's own
 * singular slug — and its count comes from `useFavourites`, the store the game
 * page's own star writes to. That is the one part of the row that used to be
 * inert: `docs/11` carried "no favourites feature" as a known gap, and the
 * badge was a literal `0` because there was no way to make it anything else.
 * Toggling a game now moves the badge and the page together.
 *
 * The rail drops the row outright, like the promo card above it: there is no
 * 56px form of two labelled pills, and the trailing hairline goes with it so
 * the collapsed column does not show two rules in a row.
 */
function PlayerShortcuts({ recentsCount, favouritesCount, onNavigate }) {
  const { status } = useAuth();

  if (status !== 'authenticated') return null;

  const pill = 'flex h-9 items-center gap-2 rounded-i-xs bg-gohan px-3 text-bulma/70';

  return (
    <>
      <div className="flex gap-2.5 px-3 pt-2 pb-4 group-data-[collapsed=true]/rail:hidden">
        <NavLink
          to="/games/favourite"
          onClick={onNavigate}
          className={cn(pill, 'transition-colors hover:bg-beerus')}
        >
          <span className="sr-only">Favourites</span>
          <Icon name="star" solid />
          <ShortcutBadge>{favouritesCount}</ShortcutBadge>
        </NavLink>

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

export function SidebarNav({ onNavigate, recentsCount, favouritesCount }) {
  const [liveOpen, setLiveOpen] = useState(true);
  const [gamesOpen, setGamesOpen] = useState(true);
  const [liveTip, liveHandlers] = useRailTip();
  const [gamesTip, gamesHandlers] = useRailTip();

  return (
    <>
      {/* The card is 3px taller than the artwork it holds, exactly as on the
          reference — `min-h` rather than a fixed height. The rail drops it
          outright; there is no 56px-wide form of a 232px banner. */}
      <div className="px-3 pb-2 group-data-[collapsed=true]/rail:hidden">
        {/* The card is the League artwork and its label says so, so it goes to
            the League page rather than to the promotions index — the same fix
            the home banner's first card needed. */}
        <Link
          to="/promotions/league-of-bitcasino"
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

      <PlayerShortcuts
        recentsCount={recentsCount}
        favouritesCount={favouritesCount}
        onNavigate={onNavigate}
      />

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
              {...liveHandlers}
              className={cn(ROW, 'rounded-xl text-bulma hover:bg-heles')}
            >
              <span className={ROW_LABEL}>Live Games</span>
              <span className="ms-auto grid size-6 place-items-center rounded-md group-data-[collapsed=true]/rail:hidden">
                <Icon
                  name="chevron-down"
                  size={16}
                  className={cn('text-bulma transition-transform', liveOpen && 'rotate-180')}
                />
              </span>
              <RailTip tip={liveTip}>Live Games</RailTip>
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

          <li className="rounded-xl bg-gohan">
            <button
              type="button"
              onClick={() => setGamesOpen((open) => !open)}
              aria-expanded={gamesOpen}
              {...gamesHandlers}
              className={cn(ROW, 'rounded-xl text-bulma hover:bg-heles')}
            >
              <span className={ROW_LABEL}>Games</span>
              <span className="ms-auto grid size-6 place-items-center rounded-md group-data-[collapsed=true]/rail:hidden">
                <Icon
                  name="chevron-down"
                  size={16}
                  className={cn('text-bulma transition-transform', gamesOpen && 'rotate-180')}
                />
              </span>
              <RailTip tip={gamesTip}>Games</RailTip>
            </button>

            {gamesOpen && (
              <ul className="flex flex-col gap-1 group-data-[collapsed=true]/rail:hidden">
                {GAMES.map((item) => (
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
export function Sidebar({ collapsed, onToggle, recentsCount, favouritesCount }) {
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
        <SidebarNav recentsCount={recentsCount} favouritesCount={favouritesCount} />
      </div>
      <SidebarFooter />
    </aside>
  );
}

/**
 * The below-`md` form of the column.
 *
 * This is **not** a slide-over drawer, which is what it was and what read as
 * obviously not the reference. Measured off bitcasino.io's own phone layout at
 * a 430px viewport, the mobile sidebar is a **full-width sheet that fills the
 * gap between the header and the bottom tab bar**:
 *
 * ```
 * fixed inset-x-0 top-(…,3.75rem) bottom-(…,3rem) z-40
 * overflow-y-auto overscroll-none bg-sidebar p-2 max-md:pb-6
 * ```
 *
 * Every part of that is load-bearing, and every part of it differed here:
 *
 * | | was | reference |
 * | --- | --- | --- |
 * | Width | a 256px drawer pinned to the start edge | the full viewport |
 * | Height | `inset-y-0`, over the header and the tab bar | `top-15 bottom-12`, between them |
 * | Scrim | `bg-zeno` at 40% | none at all |
 * | Layer | `z-50`, above the tab bar | `z-40`, below it |
 * | Brand row | a second logo and a close button | nothing — the header keeps the logo |
 * | Entrance | a 200ms `translate-x` slide | none; it is mounted, not moved |
 *
 * The reference mounts this on open and unmounts it on close — the node is
 * simply absent from the DOM otherwise, its `transform` is `none` at every
 * frame and there is no transition on it, so the early return below is the
 * behaviour rather than an optimisation.
 *
 * With no scrim and no close button there are three ways out, and they are the
 * reference's three: press `Menu` in the tab bar again (it toggles — see
 * `Layout`), follow any link in the sheet, or press Escape. The tab bar stays
 * above the sheet and stays live, which is the point of `z-40`, and is also
 * why this carries no `aria-modal` — nothing here is modal.
 *
 * The 4px where the sheet's top overlaps the 64px header is the reference's
 * own: it opens at 3.75rem under a `h-16` bar. Both surfaces are `goku`, and
 * the sheet's `p-2` starts its content below the bar regardless.
 *
 * Nothing inside changes. `SidebarNav` and `SidebarFooter` are the same
 * components the desktop column renders, with the same 40px rows and 36px
 * shortcut pills the reference measures at both widths — only the box they sit
 * in was wrong. Without `group/rail` above them, every `group-data-[collapsed]`
 * variant is inert, so the sheet always draws the full-width form.
 */
export function MobileSidebar({ open, onClose, recentsCount, favouritesCount }) {
  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed inset-x-0 top-15 bottom-12 z-40 md:hidden',
        'overflow-y-auto overscroll-none bg-goku p-2 pb-6',
      )}
    >
      {/* `min-h-full` on a flex column is what pins the footer to the bottom of
          a short sheet and lets a tall one scroll past it — the reference's own
          arrangement, and the reason the outer box owns the scroll rather than
          the link list. */}
      <div className="flex min-h-full w-full flex-col">
        <div className="no-scrollbar flex min-h-0 flex-1 flex-col">
          <SidebarNav
            onNavigate={onClose}
            recentsCount={recentsCount}
            favouritesCount={favouritesCount}
          />
        </div>
        <SidebarFooter />
      </div>
    </div>
  );
}
