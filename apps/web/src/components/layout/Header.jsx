import { NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Logo } from './Logo';
import { cn } from '@/lib/cn';

/**
 * Top bar, 64px tall on the reference site.
 *
 * It starts to the right of the sidebar, which owns the logo and the collapse
 * toggle from `md` up — collapsing narrows that column to an icon rail rather
 * than removing it, so the toggle never leaves and the header needs no copy of
 * it. Below `md` the sidebar's brand block is gone, so the header carries the
 * logo and the hamburger instead.
 *
 * There is no horizontal nav — the reference puts every destination in the
 * sidebar, and duplicating it here is what made the header feel like a generic
 * template.
 *
 * The search field is a button, not an input. Typing happens in `SearchDialog`
 * — as on the reference, where pressing this pill opens the dialog with an
 * empty field rather than carrying the query up here. Below `sm` the pill does
 * not fit beside the brand, so it collapses to the icon on the right, which
 * opens the same dialog.
 *
 * The actions are the reference's two and nothing else: Login and Sign Up.
 * There is no theme toggle — the reference ships light only. The dark palette
 * still exists and `main.jsx` still applies whatever `lib/theme` has stored,
 * so setting `bc.theme` switches the app; it simply has no control in the UI.
 */
export function Header({ onOpenMenu, onOpenSearch }) {
  return (
    <header className="sticky top-0 z-40 w-full bg-goku">
      <div className="flex h-16 items-center px-4">
        {/* Brand block — mobile only; from `md` this lives in the sidebar. */}
        <div className="flex items-center gap-2 md:hidden">
          <button
            type="button"
            onClick={onOpenMenu}
            aria-label="Open navigation menu"
            className="grid size-10 place-items-center rounded-i-sm text-bulma hover:bg-heles"
          >
            <Icon name="menu" size={22} />
          </button>

          <NavLink to="/" aria-label="Home" className="flex shrink-0">
            <Logo />
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

        <div className="ms-auto flex items-center gap-1.5 ps-2">
          <button
            type="button"
            onClick={onOpenSearch}
            aria-label="Search"
            aria-haspopup="dialog"
            className="grid size-10 place-items-center rounded-i-sm text-trunks hover:bg-heles hover:text-bulma sm:hidden"
          >
            <Icon name="search" />
          </button>

          <Button as={NavLink} to="/login" variant="secondary" size="lg" className="max-sm:hidden">
            Login
          </Button>
          <Button as={NavLink} to="/register" variant="primary" size="lg">
            Sign Up
          </Button>
        </div>
      </div>
    </header>
  );
}
