/* bitcasino: the exchange kit's site glue — hash-game-exchange's components/shared primitives
 * (DialogShell, Select, Input, Pagination, EmptyPlaceholder, Notice, MenuPageLayout, Skeleton,
 * Switch, icons) and its BetBy sport art, answered with this app's own components and tokens.
 * Each keeps the prop shape the hash markup passes, so the exchange files stay as hash wrote them.
 */
import { NavLink } from 'react-router-dom';
import { Dialog } from '@/components/ui/Dialog';
import { Select as SiteSelect } from '@/components/ui/Select';
import { Pager } from '@/components/ui/Pager';
import { Switch as SiteSwitch } from '@/components/ui/Switch';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/cn';

/** hash `DialogShell`: mounted = open; closing (cross, backdrop, Escape) calls `onClose`. */
export function DialogShell({ title, onClose, children }) {
  return (
    <Dialog open onClose={onClose} title={title}>
      {children}
    </Dialog>
  );
}

/** hash `Select`: `value` is the selected OPTION and `onChange` receives an option. */
export function Select({ title, value, options, onChange }) {
  return (
    <SiteSelect
      aria-label={title}
      value={value?.value}
      options={options}
      onChange={(v) => onChange(options.find((o) => o.value === v))}
      className="w-full"
    />
  );
}

/** hash `Input`: `onChange` receives the value, not the event. */
export function Input({ value, onChange, type = 'text', placeholder, required = false }) {
  return (
    <div className="input">
      <input type={type} value={value} placeholder={placeholder} required={required} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function Pagination({ page, pages, onChange }) {
  return (
    <div className="pt-4">
      <Pager page={page} totalPages={pages} onChange={onChange} />
    </div>
  );
}

export function EmptyPlaceholder({ children }) {
  return <div className="py-10 text-center text-sm text-trunks">{children}</div>;
}

export function Notice({ type = 'info', className = '', children }) {
  return (
    <div
      role="status"
      className={cn(
        'rounded-i-md px-4 py-3 text-sm',
        type === 'warning' ? 'bg-krillin/10 text-bulma' : 'bg-gohan text-trunks',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** hash `MenuPageLayout`: heading row, a menu column and the pane (desktop only). */
export function MenuPageLayout({ title, menu, children }) {
  return (
    <div className="flex flex-wrap gap-x-4">
      <div className="w-full pb-4 pt-3 text-lg font-bold leading-8 text-bulma">{title}</div>
      <nav className="h-fit w-60 flex-none self-start rounded-i-md bg-gohan p-2">
        {menu.map((row) => (
          <NavLink
            key={row.key}
            to={row.href}
            end
            replace
            className={({ isActive }) =>
              cn(
                'flex h-10 items-center rounded-i-sm px-4 text-sm font-medium',
                isActive ? 'bg-jiren text-piccolo' : 'text-trunks hover:bg-heles hover:text-bulma',
              )
            }
          >
            {row.title}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Skeleton({ as: Tag = 'div', className, radius, ...rest }) {
  return <Tag className={cn('animate-pulse bg-beerus', radius === 0 ? '' : 'rounded-i-sm', className)} {...rest} />;
}

export function Switch({ value, onChange, label }) {
  return <SiteSwitch checked={Boolean(value)} onChange={onChange} label={label} />;
}

/* ─── Icons: filled glyphs on a 32-unit box, coloured by the call site's `fill-*` ─── */

const Svg = ({ className, children, ...rest }) => (
  <svg viewBox="0 0 32 32" className={className} aria-hidden="true" {...rest}>
    {children}
  </svg>
);

/* A chevron drawn pointing LEFT; every call site rotates it (hash's convention). */
export const IconArrow = (p) => (
  <Svg {...p}>
    <path d="M19.7 5.6 9.3 16l10.4 10.4 3-3L15.3 16l7.4-7.4-3-3Z" />
  </Svg>
);

export const IconClose = (p) => (
  <Svg {...p}>
    <path d="M7.4 7.2a1.8 1.8 0 0 1 2.6 0l6 6 6-6a1.8 1.8 0 1 1 2.6 2.6l-6 6 6 6a1.8 1.8 0 1 1-2.6 2.6l-6-6-6 6a1.8 1.8 0 1 1-2.6-2.6l6-6-6-6a1.8 1.8 0 0 1 0-2.6Z" />
  </Svg>
);

export const IconCheck = (p) => (
  <Svg {...p}>
    <path d="M27.8 7.8a2.2 2.2 0 0 1 0 3.1L14.9 24.2a2.2 2.2 0 0 1-3.1 0l-7.6-7.8a2.2 2.2 0 1 1 3.1-3.2l6 6.2L24.7 7.8a2.2 2.2 0 0 1 3.1 0Z" />
  </Svg>
);

export const IconInform = (p) => (
  <Svg {...p}>
    <path d="M16 4a12 12 0 1 1 0 24 12 12 0 0 1 0-24Zm0 16.3a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8Zm0-11.6c-.9 0-1.7.8-1.6 1.7l.3 7.9h2.6l.3-7.9c.1-.9-.7-1.7-1.6-1.7Z" />
  </Svg>
);

/* The rail's and lobby's chrome marks, by the name hash's markup asks for (BetBy's filenames).
   Drawn with this site's own Icon set where it has the glyph. */
const CHROME = {
  'ic-home': 'grid',
  'ic-navbar-mybets': 'history',
  'ic-stat': 'sort',
};

export function BetbyIcon({ name, className = '', ...rest }) {
  if (name === 'ic-live') {
    return (
      <span className={cn('inline-flex', className)} {...rest}>
        <Svg>
          <circle cx="16" cy="16" r="4.5" />
          <path d="M9.6 9.6a1.2 1.2 0 0 1 0 1.7 6.6 6.6 0 0 0 0 9.4 1.2 1.2 0 1 1-1.7 1.7 9 9 0 0 1 0-12.8 1.2 1.2 0 0 1 1.7 0Zm12.8 0a1.2 1.2 0 0 1 1.7 0 9 9 0 0 1 0 12.8 1.2 1.2 0 1 1-1.7-1.7 6.6 6.6 0 0 0 0-9.4 1.2 1.2 0 0 1 0-1.7Z" />
        </Svg>
      </span>
    );
  }
  const icon = CHROME[name];
  if (!icon) return null;
  return (
    <span className={cn('inline-flex text-current [&_svg]:fill-none', className)} {...rest}>
      <Icon name={icon} size={24} />
    </span>
  );
}

/* Sport art for the three lobby boards; every other sport falls through to the drawn glyphs in
   icons.jsx (hash's own), then to nothing. */
const SPORT_ART = {
  cricket: (
    <path d="M23.6 3.3a1.6 1.6 0 0 1 2.3 0l2.8 2.8a1.6 1.6 0 0 1 0 2.3L15.4 21.7l-5.1-5.1L23.6 3.3ZM8.9 18l5.1 5.1-2.6 2.6a2 2 0 0 1-2.8 0l-2.3-2.3a2 2 0 0 1 0-2.8L8.9 18Zm-4.3 6.8 2.6 2.6-1.8 1.8a1.8 1.8 0 0 1-2.6-2.6l1.8-1.8ZM24 19a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z" />
  ),
  soccer: (
    <path d="M16 3a13 13 0 1 1 0 26 13 13 0 0 1 0-26Zm0 6.2-4.8 3.5 1.8 5.6h6l1.8-5.6L16 9.2Zm-2-3.4a10.4 10.4 0 0 0-6.6 4.3l1.2 3.5 3.4-.1L16 7.8l2-2V5.8a10.4 10.4 0 0 0-4 0Zm10.6 4.3a10.4 10.4 0 0 0-4.6-3.9l-.1 2.1L23.4 15l3-1.1a10.4 10.4 0 0 0-1.8-3.8ZM5.6 14.1a10.4 10.4 0 0 0 1.7 7.7l2.5-.4 1.4-3.7-2.4-3.1-3.2-.5Zm20.8.3-3.2 1-1.4 4 2.1 2.9a10.4 10.4 0 0 0 2.5-7.9Zm-12.5 6.3-2.1 2.6 1 3.3a10.4 10.4 0 0 0 6.2 0l1-3.3-2-2.6h-4.1Z" />
  ),
  tennis: (
    <path d="M16 3a13 13 0 1 1 0 26 13 13 0 0 1 0-26Zm-9.9 9.5A10.4 10.4 0 0 0 6 19.8a10.6 10.6 0 0 1 5.2-3.7A8 8 0 0 0 6.1 12.5Zm19.8 0a8 8 0 0 0-5.1 3.6 10.6 10.6 0 0 1 5.2 3.7 10.4 10.4 0 0 0-.1-7.3ZM16 5.6a10.3 10.3 0 0 0-8.2 4 10.6 10.6 0 0 1 6.6 7.9 10.6 10.6 0 0 1-5.6 8.3A10.4 10.4 0 0 0 16 26.4c2.6 0 5-1 6.9-2.6a10.6 10.6 0 0 1-5.4-8.3 10.6 10.6 0 0 1 6.7-6 10.4 10.4 0 0 0-8.2-3.9Z" />
  ),
};

export const hasSportIcon = (sport) => Boolean(SPORT_ART[sport]);

export function SportIcon({ sport, className = '', ...rest }) {
  const art = SPORT_ART[sport];
  if (!art) return null;
  return (
    <span className={cn('inline-flex', className)} {...rest}>
      <Svg>{art}</Svg>
    </span>
  );
}
