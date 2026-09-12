import { NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Logo } from './Logo';
import { UserMenu, UserMenuSkeleton } from './UserMenu';
import { WalletMenu, WalletMenuSkeleton } from './WalletMenu';
import { RecentsLink } from './RecentsLink';
import { NotificationsMenu } from './NotificationsMenu';
import { useAuth } from '@/auth/AuthProvider';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';

/**
 * Top bar, 64px tall on the reference site.
 *
 * ## The three slots
 *
 * The reference's header is not a left group and a right group. It is
 * `flex items-center` over **three** children, read from its own DOM:
 *
 *   div.flex.flex-1.items-center             search  (grows)
 *   div.flex.items-center                    wallet  (natural width)
 *   div.flex.flex-1.items-center.justify-end actions (grows, content at end)
 *
 * Two equal `flex-1` slots either side is what parks the wallet control near
 * the middle of the bar with a wide gap before the actions — and gluing the
 * wallet onto the front of the actions cluster instead was the difference that
 * read most obviously as "not the reference" at a glance.
 *
 * ## The sidebar owns the brand
 *
 * From `md` up the logo and the collapse toggle live in the sidebar, and the
 * header starts to the right of it — collapsing narrows that column to an icon
 * rail rather than removing it, so the toggle never leaves and the header needs
 * no copy of it. Below `md` the sidebar's brand block is gone, so the header
 * carries the logo and the hamburger instead.
 *
 * There is no horizontal nav — the reference puts every destination in the
 * sidebar, and duplicating it here is what made the header feel like a generic
 * template.
 *
 * The search field is a button, not an input. Typing happens in `SearchDialog`
 * — as on the reference, where pressing this pill opens the dialog with an
 * empty field rather than carrying the query up here. Below `sm` the pill does
 * not fit beside the brand, so it collapses to the icon in the actions slot,
 * which opens the same dialog. (The reference drops header search entirely
 * below `md` because it has a bottom tab bar to put it in; this project has no
 * bottom bar, so the icon stays.)
 *
 * ## Signed in
 *
 * The actions are the reference's two while signed out — Login and Sign Up —
 * and its four while signed in: the wallet control in the middle slot, then
 * `Recents`, notifications and the account button at the end. Each is its own
 * component in this folder; they share their trigger shell and panel shape
 * through `HeaderMenu.jsx` and their dismissal through `hooks/usePopover`,
 * which is what keeps them one set of controls rather than four.
 *
 * The whole signed-in row is **40px tall on a 12px radius**, not the 44/8 the
 * page's own buttons use. That is measured off the reference, not chosen — see
 * `HeaderMenu.jsx`, and `docs/11-comparing-against-the-reference.md` for how to
 * re-read it.
 *
 * There is no theme toggle: the reference ships light only. The dark palette
 * still exists and `main.jsx` still applies whatever `lib/theme` has stored, so
 * setting `bc.theme` switches the app; it simply has no control in the UI.
 *
 * Three states, not two. Between them sits `loading` — the moment after a
 * reload when a stored refresh token is being exchanged and nobody yet knows
 * whether this is a signed-in player. Rendering the signed-out buttons through
 * it would show Login to somebody who is already logged in and then snatch it
 * away, so that moment gets skeletons the shape of the cluster instead.
 */
export function Header({ onOpenSearch, onOpenDeposit }) {
  const { status } = useAuth();
  const signedIn = status === 'authenticated';
  // Below 640 the brand gives way to its glyph cluster. The reference's phone
  // header carries four controls; this one carries six, because its search and
  // its nav trigger live in a bottom tab bar this project does not have — so
  // the 150px wordmark is the first thing that has to go.
  const compact = useMediaQuery('(max-width: 639px)');

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full shrink-0 items-center bg-goku px-4">
      {/* Slot 1 — brand (phones only) and the search pill. */}
      <div className="flex min-w-0 flex-1 items-center">
        <div className="flex items-center gap-2 md:hidden">
          <NavLink to="/" aria-label="Home" className="flex shrink-0">
            <Logo markOnly={compact} />
          </NavLink>
        </div>

        {/* Search — a 329x42 pill on a hairline, 12px glyph, 16px text. */}
        <button
          type="button"
          onClick={onOpenSearch}
          aria-haspopup="dialog"
          className={cn(
            'relative ms-2 hidden h-[42px] min-w-0 max-w-[329px] flex-1 items-center sm:flex md:ms-0',
            'cursor-pointer rounded-full border-[0.8px] border-hit bg-gohan',
            // `truncate` keeps the label on one line as the pill narrows,
            // the way a placeholder clips rather than wrapping.
            'ps-[37px] pe-4 truncate text-start text-base text-trunks transition-colors',
            'hover:bg-beerus/60 focus-visible:ring-2 focus-visible:ring-piccolo',
          )}
        >
          <Icon
            name="search"
            size={12}
            className="pointer-events-none absolute start-4 text-trunks"
          />
          Search for games and providers
        </button>
      </div>

      {/* Slot 2 — the wallet, on its own between the two growing slots. It
          carries no padding: the reference's wallet slot is exactly the width
          of the control, and the air either side comes from the `flex-1`
          slots, not from the wallet. */}
      {(status === 'loading' || signedIn) && (
        <div className="flex shrink-0 items-center">
          {signedIn ? <WalletMenu onOpenDeposit={onOpenDeposit} /> : <WalletMenuSkeleton />}
        </div>
      )}

      {/* Slot 3 — everything else, pushed to the end. */}
      <div className="flex flex-1 items-center justify-end gap-1.5">
        {status === 'loading' && <UserMenuSkeleton />}

        {signedIn && (
          <>
            <RecentsLink className="max-xl:hidden" />
            <NotificationsMenu />
            <UserMenu />
          </>
        )}

        {status === 'anonymous' && (
          <>
            <Button
              as={NavLink}
              to="/login"
              variant="secondary"
              size="lg"
              className="max-sm:hidden"
            >
              Login
            </Button>
            <Button as={NavLink} to="/register" variant="primary" size="lg">
              Sign Up
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
