import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';
import { Sidebar, MobileSidebar } from './Sidebar';
import { SearchDialog } from './SearchDialog';
import { DepositDialog } from './DepositDialog';
import { RouteErrorBoundary } from './ErrorBoundary';
import { MobileBottomNav } from './MobileBottomNav';
import { useRecentlyPlayed } from '@/hooks/useRecentlyPlayed';

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const { pathname } = useLocation();

  /**
   * The badge on the sidebar's `Recents` chip.
   *
   * Fetched here rather than inside the sidebar because `SidebarNav` is
   * mounted TWICE at every width — the desktop column and the mobile drawer
   * are both in the tree, the drawer merely translated off-screen — so a hook
   * call down there is two requests per page load for every signed-in visitor.
   * One call up here feeds both.
   *
   * `null` until the list actually arrives, which is what leaves the disc
   * empty rather than flashing a `0` that is about to become a 7. The hook
   * answers `idle` with an empty list for a signed-out visitor, but the row
   * itself does not render then either.
   */
  const { games, status: recentsStatus } = useRecentlyPlayed();
  const recentsCount = recentsStatus === 'ready' ? games.length : null;

  // Close the slide-over on navigation and lock scroll while it is open.
  useEffect(() => setMenuOpen(false), [pathname]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [menuOpen]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="min-h-dvh bg-goku">
      {/* No skip link. It is the first focusable thing in the document, so it
          takes the first Tab after every load and route change and paints
          itself over the brand — and the reference does not ship one. `main`
          keeps its id, so `#main` still works as a target. */}
      <MobileSidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        recentsCount={recentsCount}
      />

      {/* Search is a dialog over the current page, not a route — the reference
          has no `/search`, and the field in the header opens this instead. */}
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />

      <MobileBottomNav
        onOpenSearch={() => setSearchOpen(true)}
        onOpenMenu={() => setMenuOpen(true)}
        onNavigate={() => setMenuOpen(false)}
        menuOpen={menuOpen}
      />

      {/* The header's Deposit button. Mounted only while it is open — unlike
          the search dialog it reads the wallet, and an always-mounted copy
          would fetch balances on every page load for a drawer nobody opened. */}
      {depositOpen && <DepositDialog open onClose={() => setDepositOpen(false)} />}

      {/* The sidebar is a full-height column that owns the brand, and the
          header starts to the right of it — the reference's shape, not a
          full-width bar with the nav hanging below it. */}
      <div className="mx-auto flex max-w-[1600px] overflow-x-clip">
        <Sidebar
          collapsed={railCollapsed}
          onToggle={() => setRailCollapsed((collapsed) => !collapsed)}
          recentsCount={recentsCount}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            onOpenSearch={() => setSearchOpen(true)}
            onOpenDeposit={() => setDepositOpen(true)}
          />
          {/* `md:pt-10` is the reference's gap between the header and the first
              block — it has none below `md`. No bottom padding: the footer is
              always last here and carries its own.

              `flex flex-col gap-8` is the reference's own content column, and
              the 32px it puts between EVERY section is the only thing spacing
              them. Sections therefore carry no trailing padding of their own —
              `Rail` had `pb-6`, `ThemeRail` `py-4` and `TrustSection` `mb-6`,
              which spaced the rails from each other but left the banner butted
              straight against the first rail's heading, since the banner had
              none. One gap on the parent cannot have that hole in it. */}
          <main
            id="main"
            className="flex min-w-0 flex-1 flex-col gap-8 px-4 pb-20 md:ps-8 md:pe-8 md:pt-10 md:pb-0"
          >
            {/* The boundary wraps the PAGE, not the shell.

                A component that throws while rendering takes its whole
                React tree down with it, and the shell around this outlet
                is the header carrying the balance and the deposit button.
                Scoped here, a page that throws leaves the player somewhere
                they can navigate out of; scoped at the root, it would
                leave them a white document.

                It does NOT catch failed requests — those are states, drawn
                by `QueryState` beside a page that still works. See the
                note in `ErrorBoundary.jsx`. */}
            <RouteErrorBoundary>
              <Outlet />
            </RouteErrorBoundary>
            <Footer />
          </main>
        </div>
      </div>
    </div>
  );
}
