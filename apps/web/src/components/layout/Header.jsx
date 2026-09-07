import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Logo } from './Logo';
import { cn } from '@/lib/cn';
import { useTheme } from '@/hooks/useTheme';

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
 */
export function Header({ onOpenMenu }) {
  const { theme, toggle } = useTheme();
  // Below `sm` the pill does not fit beside the brand, so it collapses to an
  // icon that reveals a full-width field on its own row.
  const [searchOpen, setSearchOpen] = useState(false);

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
        <label className="relative ms-2 hidden h-[42px] min-w-0 max-w-[329px] flex-1 items-center sm:flex md:ms-0">
          <span className="sr-only">Search for games and providers</span>
          <Icon
            name="search"
            size={12}
            className="pointer-events-none absolute start-4 text-trunks"
          />
          <input
            type="search"
            placeholder="Search for games and providers"
            className={cn(
              'h-[42px] w-full rounded-full border-[0.8px] border-hit bg-gohan',
              'ps-[37px] pe-4 text-base text-bulma',
              'placeholder:text-trunks outline-none transition-colors',
              'hover:bg-beerus/60 focus-visible:ring-2 focus-visible:ring-piccolo',
            )}
          />
        </label>

        <div className="ms-auto flex items-center gap-1.5 ps-2">
          <button
            type="button"
            onClick={() => setSearchOpen((open) => !open)}
            aria-label="Search"
            aria-expanded={searchOpen}
            className="grid size-10 place-items-center rounded-i-sm text-trunks hover:bg-heles hover:text-bulma sm:hidden"
          >
            <Icon name="search" />
          </button>

          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            className="grid size-10 shrink-0 place-items-center rounded-i-sm text-trunks hover:bg-heles hover:text-bulma"
          >
            <Icon name={theme === 'light' ? 'moon' : 'sun'} />
          </button>

          <Button as={NavLink} to="/login" variant="secondary" size="lg" className="max-sm:hidden">
            Login
          </Button>
          <Button as={NavLink} to="/register" variant="primary" size="lg">
            Sign Up
          </Button>
        </div>
      </div>

      {searchOpen && (
        <div className="px-4 pb-3 sm:hidden">
          <label className="relative flex h-11 items-center">
            <span className="sr-only">Search for games and providers</span>
            <Icon
              name="search"
              size={12}
              className="pointer-events-none absolute start-4 text-trunks"
            />
            <input
              type="search"
              autoFocus
              placeholder="Search for games and providers"
              className="h-[42px] w-full rounded-full border-[0.8px] border-hit bg-gohan ps-[37px] pe-4 text-base text-bulma placeholder:text-trunks outline-none focus-visible:ring-2 focus-visible:ring-piccolo"
            />
          </label>
        </div>
      )}
    </header>
  );
}
