import { NavLink } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

const NAV_ITEMS = [
  { label: 'Slots', to: '/categories/video-slots', icon: 'slots' },
  { label: 'Live', to: '/categories/live-casino', icon: 'live' },
  { label: 'Originals', to: '/categories/originals', icon: 'originals' },
];

function NavItem({ item, onNavigate }) {
  return (
    <NavLink
      to={item.to}
      end
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full py-2 text-bulma',
          isActive && 'bg-piccolo/10 text-piccolo',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon name={item.icon} size={20} strokeWidth={1.5} />
          <span className={cn('whitespace-nowrap text-xs', isActive && 'text-piccolo')}>
            {item.label}
          </span>
        </>
      )}
    </NavLink>
  );
}

export function MobileBottomNav({ onOpenSearch, onOpenMenu, onNavigate, menuOpen }) {
  return (
    <nav
      aria-label="Mobile navigation"
      role="tablist"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-hit bg-goku/95 px-3.5 pt-2.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-md md:hidden"
    >
      <div className="grid grid-flow-col auto-cols-fr items-center gap-2">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.to} item={item} onNavigate={onNavigate} />
        ))}
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label="Search"
          className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full py-2 text-bulma"
        >
          <Icon name="search" size={20} strokeWidth={1.5} />
          <span className="whitespace-nowrap text-xs">Search</span>
        </button>
        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Menu"
          className={cn(
            'flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full py-2 text-bulma',
            menuOpen && 'bg-piccolo/10 text-piccolo',
          )}
        >
          <Icon name="menu" size={20} />
          <span className="whitespace-nowrap text-xs">Menu</span>
        </button>
      </div>
    </nav>
  );
}