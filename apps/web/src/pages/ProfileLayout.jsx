import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/cn';

/**
 * The account area's shell: one tab bar over whatever route is showing.
 *
 * The reference reaches this from three places — the header bell, the account
 * menu's rows, and the tabs themselves — and every one of them lands on a page
 * under `/profile` with this bar across the top. Measured off
 * `bitcasino.io/profile/notifications`, at a 1536px viewport:
 *
 *   bar          `<ul>`, flex, 16px gap, 14px padding-bottom, 50px tall
 *   position     y=104 — the header's 64px plus `main`'s own `md:pt-10`, so
 *                the bar is the first thing in the column with no padding of
 *                its own
 *   tab          14px/1.3, weight 400, 14px padding-bottom
 *   resting      `trunks`
 *   active       `bulma`, over a 2px `piccolo` bar pinned to the tab's bottom
 *                and exactly as wide as the label
 *
 * The bar SCROLLS sideways rather than wrapping. Nine tabs measure ~690px on
 * the reference, so they do not fit a phone, and the reference's own `<ul>`
 * carries `overflow-x: auto` for it. `.no-scrollbar` is this project's
 * existing utility for the same trick on the game rails.
 *
 * ## Not every tab leads somewhere yet
 *
 * Every tab now has a page. The inert form is kept below — a `span` with
 * `aria-disabled` and no tab stop, painting exactly as the reference draws a
 * live tab — because that is the rule this project uses for a destination that
 * does not exist yet, and the account menu's rows follow it too. A tab with no
 * `to` renders that way; today nothing does.
 *
 * An inert tab also gets no hover bar. The bar is the reference's affordance
 * for "this goes somewhere", and growing it under a tab that does not navigate
 * invites the click and then swallows it.
 *
 * Two tabs leave `/profile` and this bar behind, exactly as the reference has
 * them: `Loyalty` goes to `/loyalty`, and `Tournaments` to `/tournaments` —
 * the same page the sidebar link and the account menu's own Tournaments row
 * open, which is what the reference's tab points at. The other seven are
 * siblings under `/profile`.
 *
 * ## `Transactions` is a TENTH tab, and the reference has nine
 *
 * A deliberate divergence, recorded in `docs/11`. Phase 6 built the
 * transactions screen over `GET /user/history`, and a page nothing links to
 * is a page nobody finds. The reference reaches its own money history from
 * inside the wallet drawer; this build has the drawer too, but the page is
 * account-shaped — it is the player's record rather than a step in a deposit
 * — so it sits with the rest of the account.
 *
 * Placed after `Security` rather than at the end, because the bar reads
 * roughly outward from the account itself and `Refer a Friend` is the tail of
 * that order on the reference.
 */
const TABS = [
  { label: 'Loyalty', to: '/loyalty' },
  { label: 'Rewards', to: '/profile/rewards' },
  { label: 'Tournaments', to: '/tournaments' },
  { label: 'Boosts', to: '/profile/boosts' },
  { label: 'Account', to: '/profile/account' },
  { label: 'Security', to: '/profile/security' },
  { label: 'Transactions', to: '/profile/transactions' },
  { label: 'Settings', to: '/profile/settings' },
  { label: 'Notifications', to: '/profile/notifications' },
  { label: 'Refer a Friend', to: '/profile/refer-a-friend' },
];

export function ProfileLayout() {
  return (
    // `main` carries the 40px top padding from `md` up and none below it, so
    // the bar supplies its own 16px on a phone rather than sitting flush
    // against the header.
    <div className="flex min-w-0 flex-col pt-4 md:pt-0">
      <nav aria-label="Account">
        <ul className="no-scrollbar flex gap-4 overflow-x-auto pb-3.5">
          {TABS.map((tab) => (
            <li key={tab.label} className="shrink-0">
              <ProfileTab {...tab} />
            </li>
          ))}
        </ul>
      </nav>

      {/* No width cap here, and no top padding: the bar's own 14px is the
          whole gap, so the page's heading lands at y=154.

          The cap used to live here at 750px, which is what the reference gives
          Notifications. It is NOT what it gives every account page — Rewards
          is a grid of ~380px cards running the full width of `main`, and a
          750px parent would have squeezed it to two columns at any viewport.
          So the column width belongs to the page that knows its own content;
          `Notifications` carries the 750px itself. */}
      <Outlet />
    </div>
  );
}

/**
 * One tab.
 *
 * The underline is an absolutely-positioned bar rather than a `border-bottom`,
 * because it has to sit at the bottom of the 14px padding — under the label,
 * not under the text box — and be exactly the label's width, which a border on
 * the padded element would not be.
 *
 * ## It animates, and that is the whole effect
 *
 * The reference's tab rule, read from its own stylesheet:
 *
 *   .tabLink              color: var(--tab-link-color, rgb(var(--trunks)));
 *                         transition: color 0.2s; cursor: pointer;
 *   .tabLink::after       content: ""; background: rgb(var(--piccolo));
 *                         width: 100%; height: 0.125rem; bottom: 0; left: 0;
 *                         right: 0; margin: 0 auto; transform: scaleX(0);
 *                         transition: transform 0.2s;
 *   .tabLink:hover::after transform: scaleX(1);
 *   .active               color: rgb(var(--bulma));
 *   .active::after        transform: scaleX(1);
 *
 * So the bar is on EVERY tab all the time, flattened to nothing, and both
 * hovering a tab and switching to it grow the same bar from the centre over
 * 200ms. Rendering the bar only when active — which this did — pops it in on
 * one tab and out on another with no motion at all, and left hover with
 * nothing to show; that missing 200ms is what reads as "the effect is not
 * there".
 *
 * **Hover moves the bar and nothing else.** The label stays `trunks`; only
 * `.active` takes `bulma`. That is measured, not assumed: in a capture of the
 * reference caught a frame or two into a hover on Settings, the bar under it
 * is `rgb(242,89,13)` — `piccolo`, the same orange as the active tab's — at
 * ~17% coverage, i.e. mid-grow, while the label's darkest pixel is
 * `rgb(126,117,114)`, identical to every unhovered tab beside it. Had the
 * colour been transitioning on the same 200ms clock it would have been ~17% of
 * the way to `bulma` and visibly darker than its neighbours. It was not.
 *
 * Square ends, not rounded: the `::after` sets no radius.
 */
function ProfileTab({ label, to }) {
  // 22px of label over 14px of padding is the reference's 36px tab, which is
  // what makes the bar 50px and puts the page heading at y=154.
  const shape = 'relative block whitespace-nowrap pb-3.5 text-sm leading-[22px]';

  if (!to) {
    return (
      <span aria-disabled="true" className={cn(shape, 'text-trunks')}>
        {label}
      </span>
    );
  }

  return (
    <NavLink to={to} className={cn(shape, 'group cursor-pointer')}>
      {({ isActive }) => (
        <>
          {/* The transition belongs on the element that owns the `color`, not
              on the link above it. No hover variant here — see above. */}
          <span
            className={cn(
              'transition-colors duration-200',
              isActive ? 'text-bulma' : 'text-trunks',
            )}
          >
            {label}
          </span>
          {/* `group-hover` rather than a `hover:` on this span: the bar is
              painted under the label, so the pointer is never actually over it
              — the hover target is the whole link. */}
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-x-0 bottom-0 h-0.5 bg-piccolo',
              'origin-center transition-transform duration-200',
              isActive ? 'scale-x-100' : 'scale-x-0 group-hover:scale-x-100',
            )}
          />
        </>
      )}
    </NavLink>
  );
}
