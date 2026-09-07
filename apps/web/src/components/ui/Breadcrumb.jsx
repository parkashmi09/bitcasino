import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Logo } from '@/components/layout/Logo';

/**
 * Trail under a game list.
 *
 * The reference puts this *below* the grid rather than above it, opens it with
 * the brand mark instead of a "Home" label, and leaves the last crumb as plain
 * text. `items` is `[{ label, to }]`, outermost first; the final entry is the
 * current page and is rendered unlinked whether or not it carries a `to`.
 */
export function Breadcrumb({ items }) {
  return (
    <nav aria-label="Breadcrumb" className="mt-8 flex flex-wrap items-center gap-1 text-sm">
      <Link to="/" aria-label="Home" className="flex items-center text-trunks hover:text-piccolo">
        <Logo markOnly className="[&>svg]:h-6 [&>svg]:w-auto" />
      </Link>

      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={item.label} className="flex items-center gap-1">
            <Icon name="chevron-right" size={16} className="text-trunks" />
            {last || !item.to ? (
              <span className="text-bulma">{item.label}</span>
            ) : (
              <Link to={item.to} className="text-trunks hover:text-piccolo">
                {item.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
