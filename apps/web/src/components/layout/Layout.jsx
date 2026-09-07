import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';
import { Sidebar, MobileSidebar } from './Sidebar';
import { SearchDialog } from './SearchDialog';

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const { pathname } = useLocation();

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
      <MobileSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      {/* Search is a dialog over the current page, not a route — the reference
          has no `/search`, and the field in the header opens this instead. */}
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />

      {/* The sidebar is a full-height column that owns the brand, and the
          header starts to the right of it — the reference's shape, not a
          full-width bar with the nav hanging below it. */}
      <div className="mx-auto flex max-w-[1600px] overflow-x-clip">
        <Sidebar
          collapsed={railCollapsed}
          onToggle={() => setRailCollapsed((collapsed) => !collapsed)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <Header
            onOpenMenu={() => setMenuOpen(true)}
            onOpenSearch={() => setSearchOpen(true)}
          />
          {/* `md:pt-10` is the reference's gap between the header and the first
              block — it has none below `md`. No bottom padding: the footer is
              always last here and carries its own. */}
          <main id="main" className="min-w-0 flex-1 px-4 md:ps-8 md:pe-8 md:pt-10">
            <Outlet />
            <Footer />
          </main>
        </div>
      </div>
    </div>
  );
}
