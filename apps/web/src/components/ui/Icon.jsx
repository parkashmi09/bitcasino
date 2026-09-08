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
  /* A shafted arrow, not a chevron. The reference uses this on the tournament
     card's open control, where a bare chevron would read as "next in a row"
     rather than "go to this". */
  'arrow-right': 'M4.5 12h15m0 0-5.5-5.5M19.5 12 14 17.5',
  'star': 'M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9L12 3.5Z',
  'fire': 'M12 3s4.5 3.6 4.5 8a4.5 4.5 0 0 1-9 0c0-1.3.5-2.4 1.2-3.3.3 1.2 1 2 1.9 2.3C10.3 7.7 12 6 12 3Z',
  'dice': 'M5 7.5a2.5 2.5 0 0 1 2.5-2.5h9A2.5 2.5 0 0 1 19 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 16.5v-9ZM9 9.5h.01M15 9.5h.01M12 12h.01M9 14.5h.01M15 14.5h.01',
  'cards': 'M8.5 6.5A2 2 0 0 1 10.5 4.5h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-9ZM5.5 8v9.5a2 2 0 0 0 2 2H14',
  'roulette': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 3v5M12 16v5M3 12h5M16 12h5',
  'live': 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM7.5 7a7 7 0 0 0 0 10M16.5 7a7 7 0 0 1 0 10M4.5 4a11 11 0 0 0 0 16M19.5 4a11 11 0 0 1 0 16',
  'gift': 'M4.5 11h15v8.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V11ZM3.5 7.5h17V11h-17V7.5ZM12 7.5v13M12 7.5S10.5 3.5 8 3.5a2 2 0 0 0 0 4h4Zm0 0s1.5-4 4-4a2 2 0 0 1 0 4h-4Z',
  'trophy': 'M7 4.5h10v5a5 5 0 0 1-10 0v-5ZM7 6H4.5v1.5A3 3 0 0 0 7 10.5M17 6h2.5v1.5a3 3 0 0 1-2.5 3M12 14.5v3M8.5 20h7',
  /* The Deposit button's glyph, taken from the reference's own header. It is a
     FILLED shape, not a stroked one — the card slot on the right and the bar
     across the top are cut out of the body by the nonzero fill rule, so
     stroking it would draw the outline of a silhouette rather than a wallet.
     `SOLID` below is what keeps that from happening by accident. */
  'wallet':
    'M13.8975 2.25008C14.7372 2.25008 15.3474 2.24239 15.8721 2.37508L16.1201 2.44637C17.3402 2.83895 18.2806 3.78175 18.6172 4.96786L18.6641 5.15731C18.7376 5.51697 18.7475 5.92435 18.749 6.42391C19.4938 6.56418 20.2403 6.94254 20.7607 7.46297C21.2855 8.04546 21.5203 8.76471 21.6338 9.60848C21.6976 10.0834 21.7243 10.629 21.7373 11.2501H19C18.6354 11.2501 18.1995 11.2728 17.918 11.3272C17.19 11.5223 16.611 12.0672 16.3701 12.7745C16.2871 13.0846 16.25 13.5835 16.25 14.0001C16.25 14.4167 16.2871 14.9155 16.3701 15.2257C16.6109 15.933 17.19 16.4778 17.918 16.6729C18.1995 16.7274 18.6354 16.7501 19 16.7501H21.7373C21.7243 17.3712 21.6976 17.9168 21.6338 18.3917C21.5203 19.2355 21.2855 19.9547 20.7607 20.5372C20.1588 21.1391 19.2917 21.5129 18.3916 21.6339C17.5267 21.7501 16.4275 21.7501 15.0645 21.7501H8.93555C7.57249 21.7501 6.47331 21.7501 5.6084 21.6339C4.76457 21.5204 3.93115 21.1763 3.34863 20.6515C2.74678 20.0495 2.48722 19.2918 2.36621 18.3917C2.24997 17.5268 2.24997 16.4275 2.25 15.0645V5.00008C2.25012 3.48142 3.55407 2.25009 5.16211 2.25008H13.8975ZM21.75 15.2501H19C18.6148 15.2501 18.3721 15.2364 18.3721 15.2364C18.1575 15.25 17.7754 14.9499 17.7754 14.6944C17.7754 14.6206 17.75 14.5131 17.75 14.0001C17.75 13.4869 17.7563 13.3771 17.7754 13.3057C17.7755 13.1014 18.129 12.7638 18.3721 12.7638C18.457 12.7539 18.6148 12.7501 19 12.7501H21.75V15.2501ZM5.36133 4.08212C4.71534 4.08238 4.19172 4.60606 4.19141 5.25204C4.19141 5.89827 4.71515 6.42267 5.36133 6.42294H16.7979C16.7979 6.10667 16.7981 5.94828 16.7803 5.81551C16.66 4.92277 15.9572 4.2199 15.0645 4.09969C14.9317 4.08185 14.7733 4.08212 14.457 4.08212H5.36133Z',
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
  /* Paired chevrons, the reference's sort affordance — not a caret. */
  'sort': 'M8 10l4-4 4 4M8 14l4 4 4-4',
  'menu-collapse':
    'M3 6H17M3 12H13M3 18H17M21 8L19.8462 8.87652C17.9487 10.318 17 11.0388 17 12C17 12.9612 17.9487 13.682 19.8462 15.1235L21 16',
  /* Header cluster — the reference's notification bell and its `Recents`
     clock, both drawn on the same 24 grid as everything else here. */
  'bell': 'M12 3.5a6 6 0 0 0-6 6c0 3.1-.7 4.8-1.5 5.8-.5.7 0 1.7.9 1.7h13.2c.9 0 1.4-1 .9-1.7-.8-1-1.5-2.7-1.5-5.8a6 6 0 0 0-6-6ZM9.75 20a2.25 2.25 0 0 0 4.5 0',
  'clock': 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 7.25V12l3.25 2',
  /* `Recents`. The reference does not use a plain clock here — it uses the
     rotate-back history glyph, a circle broken at the top left with the arrow
     tick closing it, over clock hands. */
  'history': 'M3.5 12a8.5 8.5 0 1 0 2.8-6.3L3.5 8.2M3.5 3.5v4.7h4.7M12 7.5v4.6l3.6 1.8',
  /* The warning mark in a reward card's callout. FILLED, like the reference's
     — an outlined circle beside 16px body copy reads as a hairline ring and
     loses the colour that carries the meaning. The stem and the dot are cut
     back out of the disc, which needs the EVEN-ODD fill rule below; under the
     default nonzero rule they would fill solid and the glyph would be a plain
     orange dot. */
  /* The mark beside an unconfirmed email address on the account page. The
     reference draws this one OUTLINED and the callout's `alert` filled — two
     different marks for two different weights of warning, so both are here
     rather than one standing in for both. */
  'warning': 'M12 4.25 20.5 19.5h-17L12 4.25ZM12 10.25v4M12 17h.01',
  'alert':
    'M12 2.25a9.75 9.75 0 1 0 0 19.5 9.75 9.75 0 0 0 0-19.5ZM11 6.75a1 1 0 1 1 2 0v6a1 1 0 1 1-2 0v-6ZM12 15.9a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z',
  'headset': 'M5 14v-2a7 7 0 0 1 14 0v2M4 13.5h2.5v5H5a1 1 0 0 1-1-1v-4Zm16 0h-2.5v5H19a1 1 0 0 0 1-1v-4ZM17.5 18.5v.5a2.5 2.5 0 0 1-2.5 2.5h-2',
  // The refer page: copy the invite link, share it, and the face on its empty
  // state. Same 24x24 grid and 1.75 stroke as everything above.
  'copy': 'M9 9.5a2 2 0 0 1 2-2h6.5a2 2 0 0 1 2 2V16a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V9.5ZM15 7.5V8a2 2 0 0 0-2-2H6.5a2 2 0 0 0-2 2v6.5a2 2 0 0 0 2 2H7',
  'share': 'M12 15.5V4M8.5 7.5 12 4l3.5 3.5M5 13.5v5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-5',
  'frown': 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM9 10h.01M15 10h.01M9 15.5a4 4 0 0 1 6 0',
  /* The wallet drawer's three actions. Deposit reuses `wallet` above; these
     two are Buy and Withdraw, drawn on the same grid at the same stroke so
     the segmented control reads as one set rather than three borrowed marks.
     `send` keeps the fold line in the paper plane — without it the shape
     reads as a plain triangle once it is down at 18px. */
  'card': 'M3 8.5A2.5 2.5 0 0 1 5.5 6h13A2.5 2.5 0 0 1 21 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 15.5v-7ZM3 10.5h18M6.5 14.5h3',
  'send': 'M20.5 3.5 3.5 10.2l6.4 2.6 3.6 6.2 7-16.5ZM9.9 12.8 20.5 3.5',
  /* The corner brackets of the deposit panel's QR frame. Four L-shapes on the
     24 grid, so the frame scales with `size` like every other glyph here. */
  'qr': 'M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15M8.5 8.5h3v3h-3v-3ZM12.5 12.5h3v3h-3v-3Z',
};

/**
 * Props: `name` (a key of PATHS), `size` in px — 20 by default, to match the
 * reference site's nav — plus any native svg attribute.
 *
 * `solid` fills the glyph with `currentColor` instead of stroking it, for the
 * few places the reference uses a filled shape — the play triangle on a game
 * tile's hover veil.
 *
 * Names in `SOLID` are filled whether or not the caller asks, because they are
 * authored as silhouettes: stroking one traces the edge of the shape instead of
 * drawing the object, which is wrong everywhere rather than a style choice. A
 * caller cannot pass `solid={false}` to get a broken outline, and nothing has
 * to remember to pass `solid` at each site.
 */
const SOLID = new Set(['wallet', 'alert']);

/**
 * Filled glyphs whose holes are cut by the EVEN-ODD rule rather than by
 * winding direction. Kept separate from `SOLID` because it is not the same
 * property: `wallet` is authored nonzero on purpose (see its comment), and
 * switching the rule for everyone would fill in its card slot and its bar.
 */
const EVENODD = new Set(['alert']);

export function Icon({ name, size = 20, solid = false, className, ...props }) {
  const filled = solid || SOLID.has(name);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      fillRule={EVENODD.has(name) ? 'evenodd' : undefined}
      stroke={filled ? 'none' : 'currentColor'}
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
