import { cn } from '@/lib/cn';

/**
 * Inline icon set, authored for this project as plain geometric glyphs on a
 * 24x24 grid with a 1.75 stroke. Inline SVG keeps them themeable via
 * `currentColor` and avoids a runtime icon-font request.
 *
 * The keys of PATHS below are the complete set of valid `name` values.
 */
const PATHS = {
  'search': 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-4.2-4.2',
  'menu': 'M4 7h16M4 12h16M4 17h16',
  'close': 'M6 6l12 12M18 6L6 18',
  'user': 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0',
  'chevron-down': 'M6 9.5l6 6 6-6',
  'chevron-left': 'M14.5 6l-6 6 6 6',
  'chevron-right': 'M9.5 6l6 6-6 6',
  'star': 'M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9L12 3.5Z',
  'fire': 'M12 3s4.5 3.6 4.5 8a4.5 4.5 0 0 1-9 0c0-1.3.5-2.4 1.2-3.3.3 1.2 1 2 1.9 2.3C10.3 7.7 12 6 12 3Z',
  'dice': 'M5 7.5a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 19 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 16.5v-9ZM9 9.5h.01M15 9.5h.01M12 12h.01M9 14.5h.01M15 14.5h.01',
  'cards': 'M8.5 6.5A2 2 0 0 1 10.5 4.5h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-9ZM5.5 8v9.5a2 2 0 0 0 2 2H14',
  'roulette': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 3v5M12 16v5M3 12h5M16 12h5',
  'live': 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM7.5 7a7 7 0 0 0 0 10M16.5 7a7 7 0 0 1 0 10M4.5 4a11 11 0 0 0 0 16M19.5 4a11 11 0 0 1 0 16',
  'gift': 'M4.5 11h15v8.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V11ZM3.5 7.5h17V11h-17V7.5ZM12 7.5v13M12 7.5S10.5 3.5 8 3.5a2 2 0 0 0 0 4h4Zm0 0s1.5-4 4-4a2 2 0 0 1 0 4h-4Z',
  'trophy': 'M7 4.5h10v5a5 5 0 0 1-10 0v-5ZM7 6H4.5v1.5A3 3 0 0 0 7 10.5M17 6h2.5v1.5a3 3 0 0 1-2.5 3M12 14.5v3M8.5 20h7',
  'wallet': 'M4 8a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8ZM16 12.5h3.5M16 12.5h.01',
  'globe': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c2.5 2.4 3.8 5.5 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.5-3.8-9S9.5 5.4 12 3Z',
  'sun': 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  'moon': 'M20 14.2A8.5 8.5 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2Z',
  'shield': 'M12 3.5l7 2.5v5.5c0 4.4-2.9 7.6-7 9.5-4.1-1.9-7-5.1-7-9.5V6l7-2.5ZM9.2 12l2 2 3.6-3.6',
  'bolt': 'M13.5 3L6 13.5h5L10.5 21 18 10.5h-5L13.5 3Z',
  'lock': 'M6.5 10.5h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1ZM8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3',
  'plus': 'M12 5v14M5 12h14',
  'check': 'M5 12.5l4.5 4.5L19 7.5',
  'play': 'M8.5 5.5l10 6.5-10 6.5v-13Z',
  'grid': 'M4.5 4.5h6v6h-6v-6ZM13.5 4.5h6v6h-6v-6ZM4.5 13.5h6v6h-6v-6ZM13.5 13.5h6v6h-6v-6Z',
  'sparkle': 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3ZM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z',
  'chevron-up': 'M6 14.5l6-6 6 6',
  'menu-collapse':
    'M3 6H17M3 12H13M3 18H17M21 8L19.8462 8.87652C17.9487 10.318 17 11.0388 17 12C17 12.9612 17.9487 13.682 19.8462 15.1235L21 16',
  'headset': 'M5 14v-2a7 7 0 0 1 14 0v2M4 13.5h2.5v5H5a1 1 0 0 1-1-1v-4Zm16 0h-2.5v5H19a1 1 0 0 0 1-1v-4ZM17.5 18.5v.5a2.5 2.5 0 0 1-2.5 2.5h-2',
};

/**
 * Props: `name` (a key of PATHS), `size` in px — 20 by default, to match the
 * reference site's nav — plus any native svg attribute.
 */
export function Icon({ name, size = 20, className, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('shrink-0', className)}
      {...props}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
