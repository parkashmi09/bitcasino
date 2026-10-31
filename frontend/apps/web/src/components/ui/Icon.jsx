import { cn } from '@/lib/cn';

/**
 * Inline icon set, authored for this project as plain geometric glyphs on a
 * 24x24 grid with a 1.75 stroke. Inline SVG keeps them themeable via
 * `currentColor` and avoids a runtime icon-font request.
 *
 * The keys of PATHS below are the complete set of valid `name` values.
 */
const PATHS = {
  'search': 'M17 17L21 21M19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19C15.4183 19 19 15.4183 19 11Z',
  'menu': 'M4 5h16M4 12h16M4 19h16',
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
  'slots': 'M22 16.5C22 19.5376 19.5376 22 16.5 22C13.4624 22 11 19.5376 11 16.5C11 13.4624 13.4624 11 16.5 11C19.5376 11 22 13.4624 22 16.5ZM10.5 11C9.62217 10.37 8.55171 10 7.39646 10C4.41608 10 2 12.4624 2 15.5C2 18.5376 4.41608 21 7.39646 21C8.08877 21 8.75062 20.8671 9.35882 20.6251M16 13C14.1631 11.1035 11.7291 7.13692 13.7946 4M16 2C14.9847 2.59904 14.2703 3.27752 13.7946 4M13.7946 4C11.4006 4.5 6.09142 6.5 7.13408 12',
  'originals': 'M12 21C15.7497 21 17.6246 21 18.9389 20.0451C19.3634 19.7367 19.7367 19.3634 20.0451 18.9389C21 17.6246 21 15.7497 21 12C21 8.25027 21 6.3754 20.0451 5.06107C19.7367 4.6366 19.3634 4.26331 18.9389 3.95492C17.6246 3 15.7497 3 12 3C8.25027 3 6.3754 3 5.06107 3.95491C4.6366 4.26331 4.26331 4.6366 3.95492 5.06107C3 6.3754 3 8.25027 3 12C3 15.7497 3 17.6246 3.95491 18.9389C4.26331 19.3634 4.6366 19.3634 5.06107 20.0451C6.3754 21 8.25027 21 12 21ZM8.25 8H8M8.5 8C8.5 8.27614 8.27614 8.5 8 8.5C7.72386 8.5 7.5 8.27614 7.5 8C7.5 7.72386 7.72386 7.5 8 7.5C8.27614 7.5 8.5 7.72386 8.5 8ZM16.25 16H16M16.5 16C16.5 16.2761 16.2761 16.5 16 16.5C15.7239 16.5 15.5 16 15.5 16C15.5 15.7239 15.7239 15.5 16 15.5C16.2761 15.5 16.5 15.7239 16.5 16Z',
  'cards': 'M8.5 6.5A2 2 0 0 1 10.5 4.5h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-9ZM5.5 8v9.5a2 2 0 0 0 2 2H14',
  'roulette': 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 3v5M12 16v5M3 12h5M16 12h5',
  'live': 'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM7.5 7a7 7 0 0 0 0 10M16.5 7a7 7 0 0 1 0 10M4.5 4a11 11 0 0 0 0 16M19.5 4a11 11 0 0 1 0 16',
'gift': 'M4 11V15C4 18.2998 4 19.9497 5.02513 20.9749C6.05025 22 7.70017 22 11 22H13C16.2998 22 17.9497 22 18.9749 20.9749C20 19.9497 20 18.2998 20 15V11M3 9C3 8.25231 3 7.87846 3.20096 7.6C3.33261 7.41758 3.52197 7.26609 3.75 7.16077C4.09808 7 4.56538 7 5.5 7H18.5C19.4346 7 19.9019 7 20.25 7.16077C20.478 7.26609 20.6674 7.41758 20.799 7.6C21 7.87846 21 8.25231 21 9C21 9.74769 21 10.1215 20.799 10.4C20.6674 10.5824 20.478 10.7339 20.25 10.8392C19.9019 11 19.4346 11 18.5 11H5.5C4.56538 11 4.09808 11 3.75 10.8392C3.52197 10.7339 3.33261 10.5824 3.20096 10.4C3 10.1215 3 9.74769 3 9ZM6 3.78571C6 2.79949 6.79949 2 7.78571 2H8.14286C10.2731 2 12 3.7269 12 5.85714V7H9.21429C7.43908 7 6 5.56091 6 3.78571ZM18 3.78571C18 2.79949 17.2005 2 16.2143 2H15.8571C13.7269 2 12 3.7269 12 5.85714V7H14.7857C16.5609 7 18 5.56091 18 3.78571ZM12 11L12 22',
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
  /* The filter toggle on a game list's heading row below `md`: two rails, a
     knob on each, the top knob left and the bottom one right.

     Copied verbatim from the reference's own button — `aria-label="Filters"`,
     read off `bitcasino.io/categories/live-casino` in a phone context, which
     is the only state that renders it. It is therefore on a 32 grid at a
     1-unit stroke, not this file's 24 at 1.75, and it keeps them: see `GRID`
     below for why rescaling a traced glyph is not free. */
  'filters':
    'M14 12.5C14 13.6046 13.1046 14.5 12 14.5C10.8954 14.5 10 13.6046 10 12.5M14 12.5C14 11.3954 13.1046 10.5 12 10.5C10.8954 10.5 10 11.3954 10 12.5M14 12.5H25.5M10 12.5H6.5M18 20.5C18 19.3954 18.8954 18.5 20 18.5C21.1046 18.5 22 19.3954 22 20.5M18 20.5C18 21.6046 18.8954 22.5 20 22.5C21.1046 22.5 22 21.6046 22 20.5M18 20.5L6.5 20.5M22 20.5H25.5',
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
  /* A speech bubble with its tail at the start edge, and three dots. Drawn on
     the same 24 grid at the same 1.75 stroke as the rest — the reference has
     no chat control to copy, so this matches the SET rather than a source. */
  'chat': 'M6 4.5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-5.5L8 19.5V15.5H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2ZM8.5 10h.01M12 10h.01M15.5 10h.01',
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
  /* The wallet drawer's home rows, drawn on the same 24 grid at the same
     1.75 stroke so they read as one set — a medal for `My Rewards`, a gear
     for `Wallet settings`, and circled `?`/`i` for `Help Centre`/`FAQ`. */
'medal': 'M8.5 2V10.5M15.5 2V10.5M17.9162 2.01166H6.0838C5.17286 2.01166 3.96696 1.85424 3.34398 2.69602C3 3.1608 3 3.83334 3 5.17844C3 6.32524 3 6.89864 3.23194 7.38174C3.62807 8.20684 4.51377 8.56526 5.27291 8.95504L8.98131 10.8591C10.4626 11.6197 11.2033 12 12 12C12.7967 12 13.5374 11.6197 15.0187 10.8591L18.7271 8.95504C19.4862 8.56526 20.3719 8.20684 20.7681 7.38174C21 6.89864 21 6.32524 21 5.17844C21 3.83334 21 3.1608 20.656 2.69602C20.033 1.85424 18.8271 2.01166 17.9162 2.01166ZM10.5292 13.6376C11.2478 13.2125 11.6071 13 12 13C12.3929 13 12.7522 13.2125 13.4708 13.6376L14.4708 14.2292C15.2167 14.6704 15.5896 14.891 15.7948 15.26C16 15.6289 16 16.0789 16 16.979V18.021C16 18.9211 16 19.3711 15.7948 19.74C15.5896 20.109 15.2167 20.3296 14.4708 20.7708L13.4708 21.3624C12.7522 21.7875 12.3929 22 12 22C11.6071 22 11.2478 21.7875 10.5292 21.3624L9.52922 20.7708C8.78332 20.3296 8.41037 20.109 8.20519 19.74C8 19.3711 8 18.9211 8 18.021V16.979C8 16.0789 8 15.6289 8.20519 15.26C8.41037 14.891 8.78332 14.6704 9.52922 14.2292L10.5292 13.6376Z',
'cog': 'M21.3175 7.14139L20.8239 6.28479C20.4506 5.63696 20.264 5.31305 19.9464 5.18388C19.6288 5.05472 19.2696 5.15664 18.5513 5.36048L17.3311 5.70418C16.8725 5.80994 16.3913 5.74994 15.9726 5.53479L15.6357 5.34042C15.2766 5.11043 15.0004 4.77133 14.8475 4.37274L14.5136 3.37536C14.294 2.71534 14.1842 2.38533 13.9228 2.19657C13.6615 2.00781 13.3143 2.00781 12.6199 2.00781H11.5051C10.8108 2.00781 10.4636 2.00781 10.2022 2.19657C9.94085 2.38533 9.83106 2.71534 9.61149 3.37536L9.27753 4.37274C9.12465 4.77133 8.84845 5.11043 8.48937 5.34042L8.15249 5.53479C7.73374 5.74994 7.25259 5.80994 6.79398 5.70418L5.57375 5.36048C4.85541 5.15664 4.49625 5.05472 4.17867 5.18388C3.86109 5.31305 3.67445 5.63696 3.30115 6.28479L2.80757 7.14139C2.45766 7.74864 2.2827 8.05227 2.31666 8.37549C2.35061 8.69871 2.58483 8.95918 3.05326 9.48012L4.0843 10.6328C4.3363 10.9518 4.51521 11.5078 4.51521 12.0077C4.51521 12.5078 4.33636 13.0636 4.08433 13.3827L3.05326 14.5354C2.58483 15.0564 2.35062 15.3168 2.31666 15.6401C2.2827 15.9633 2.45766 16.2669 2.80757 16.8741L3.30114 17.7307C3.67443 18.3785 3.86109 18.7025 4.17867 18.8316C4.49625 18.9608 4.85542 18.8589 5.57377 18.655L6.79394 18.3113C7.25263 18.2055 7.73387 18.2656 8.15267 18.4808L8.4895 18.6752C8.84851 18.9052 9.12464 19.2442 9.2775 19.6428L9.61149 20.6403C9.83106 21.3003 9.94085 21.6303 10.2022 21.8191C10.4636 22.0078 10.8108 22.0078 11.5051 22.0078H12.6199C13.3143 22.0078 13.6615 22.0078 13.9228 21.8191C14.1842 21.6303 14.294 21.3003 14.5136 20.6403L14.8476 19.6428C15.0004 19.2442 15.2765 18.9052 15.6356 18.6752L15.9724 18.4808C16.3912 18.2656 16.8724 18.2055 17.3311 18.3113L18.5513 18.655C19.2696 18.8589 19.6288 18.9608 19.9464 18.8316C20.264 18.7025 20.4506 18.3785 20.8239 17.7307L21.3175 16.8741C21.6674 16.2669 21.8423 15.9633 21.8084 15.6401C21.7744 15.3168 21.5402 15.0564 21.0718 14.5354L20.0407 13.3827C19.7887 13.0636 19.6098 12.5078 19.6098 12.0077C19.6098 11.5078 19.7888 10.9518 20.0407 10.6328L21.0718 9.48012C21.5402 8.95918 21.7744 8.69871 21.8084 8.37549C21.8423 8.05227 21.6674 7.74864 21.3175 7.14139ZM15.5195 12C15.5195 13.933 13.9525 15.5 12.0195 15.5C10.0865 15.5 8.51953 13.933 8.51953 12C8.51953 10.067 10.0865 8.5 12.0195 8.5C13.9525 8.5 15.5195 10.067 15.5195 12Z',
'info': 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 11v4.5M12 8h.01',
'help': 'M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12ZM17 12C17 14.7614 14.7614 17 12 17C9.23858 17 7 14.7614 7 12C7 9.23858 9.23858 7 12 7C14.7614 7 17 9.23858 17 12ZM12 7V3M12 17V21M17 12H21M7 12H3M14.8965 3.47625C15.63 2.57541 16.7478 2 18 2C20.2091 2 22 3.79086 22 6C22 7.25222 21.4246 8.37005 20.5238 9.1035M20.5238 14.8965C21.4246 15.63 22 16.7478 22 18C22 20.2091 20.2091 22 18 22C16.7478 22 15.63 21.4246 14.8965 20.5238M9.1035 20.5238C8.37005 21.4246 7.25222 22 6 22C3.79086 22 2 20.2091 2 18C2 16.7478 2.57541 15.63 3.47625 14.8965M3.47625 9.1035C2.57541 8.37005 2 7.25222 2 6C2 3.79086 3.79086 2 6 2C7.25222 2 8.37005 2.57541 9.1035 3.47625',
  /* Game-page toolbar, all four traced from the reference's own play page at
     its 1.5 stroke. */
  'heart':
    'M10.4107 19.9677C7.58942 17.858 2 13.0348 2 8.69444C2 5.82563 4.10526 3.5 7 3.5C8.5 3.5 10 4 12 6C14 4 15.5 3.5 17 3.5C19.8947 3.5 22 5.82563 22 8.69444C22 13.0348 16.4106 17.858 13.5893 19.9677C12.6399 20.6776 11.3601 20.6776 10.4107 19.9677Z',
  'video':
    'M18.8906 12.846C18.5371 14.189 16.8667 15.138 13.5257 17.0361C10.296 18.8709 8.6812 19.7884 7.37983 19.4196C6.8418 19.2671 6.35159 18.9776 5.95624 18.5787C5 17.6139 5 15.7426 5 12C5 8.2574 5 6.3861 5.95624 5.42132C6.35159 5.02245 6.8418 4.73288 7.37983 4.58042C8.6812 4.21165 10.296 5.12907 13.5257 6.96393C16.8667 8.86197 18.5371 9.811 18.8906 11.154C19.0365 11.7084 19.0365 12.2916 18.8906 12.846Z',
  /* The Fun-mode mark. Same 24 grid and 1.5 stroke as the Real eye above — a
     plain circle with a mouth tick rather than a full face, at the size the
     switch prints them. */
  'smile':
    'M4.75 12a7.25 7.25 0 1 0 14.5 0 7.25 7.25 0 0 0-14.5 0ZM8.75 13.5a4.6 4.6 0 0 0 6.5 0M9.25 9.75v.5M14.75 9.75v.5',
  /* Expand/shrink: the reference's diagonal pairs for the play-page toolbar,
     drawn for a 1.5 unit stroke on the same 24 grid. `shrink` is `expand`
     flipped about the centre — the two glyphs share the toolbar buttons and
     swap as the panel expands and restores. */
  'expand':
    'M16.4999 3.26621C17.3443 3.25421 20.1408 2.67328 20.7337 3.26621C21.3266 3.85913 20.7457 6.65559 20.7337 7.5M20.5059 3.49097L13.5021 10.4961M3.26636 16.5001C3.25436 17.3445 2.67343 20.141 3.26636 20.7339C3.85928 21.3268 6.65574 20.7459 7.50015 20.7339M10.502 13.4976L3.49824 20.5027',
  'shrink':
    'M7.5 3.26621C6.6557 3.25421 3.85919 2.67328 3.26626 3.26621C2.67333 3.85913 3.25426 6.65559 3.26626 7.5M10.4979 3.49097L3.49388 10.4961M20.7336 16.5001C20.7456 17.3445 21.3266 20.141 20.7336 20.7339C20.1407 21.3268 17.3443 20.7459 16.4998 20.7339M13.4979 13.4976L20.5018 20.5027',
  /* Four corner brackets — the toolbar's fullscreen control. */
  'maximize':
    'M15.5 21C16.8956 21 17.5933 21 18.1611 20.8278C19.4395 20.44 20.44 19.4395 20.8278 18.1611C21 17.5933 21 16.8956 21 15.5M21 8.5C21 7.10444 21 6.40666 20.8278 5.83886C20.44 4.56046 19.4395 3.56004 18.1611 3.17224C17.5933 3 16.8956 3 15.5 3M8.5 21C7.10444 21 6.40666 21 5.83886 20.8278C4.56046 20.44 3.56004 19.4395 3.17224 18.1611C3 17.5933 3 16.8956 3 15.5M3 8.5C3 7.10444 3 6.40666 3.17224 5.83886C3.56004 4.56046 4.56046 3.56004 5.83886 3.17224C6.40666 3 7.10444 3 8.5 3',
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

/**
 * Glyphs authored on a grid other than this file's 24, with the stroke that
 * grid was drawn for.
 *
 * Only traced icons belong here. A path copied from the reference is a set of
 * exact numbers, and rescaling them to 24 means either rounding every
 * coordinate — which moves the shape — or carrying three decimal places that
 * nobody can check against the source. Keeping the original grid keeps the
 * path byte-identical to what was read off the page, so it stays verifiable.
 *
 * The stroke travels with the grid: 1 unit on a 32 grid and 1.75 on a 24 are
 * both drawn at the same weight once the glyph is scaled to its box, so a
 * traced path on this project's default stroke would come out a third heavier
 * than the reference draws it.
 */
const GRID = { filters: 32 };
/* The traced game-page glyphs keep the reference's 1.5 stroke; everything
   authored here is 1.75. */
const STROKE = {
  filters: 1,
  heart: 1.5,
  video: 1.5,
  smile: 1.5,
  expand: 1.5,
  shrink: 1.5,
  maximize: 1.5,
};

export function Icon({ name, size = 20, solid = false, className, ...props }) {
  const filled = solid || SOLID.has(name);
  const grid = GRID[name] ?? 24;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${grid} ${grid}`}
      fill={filled ? 'currentColor' : 'none'}
      fillRule={EVENODD.has(name) ? 'evenodd' : undefined}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={STROKE[name] ?? 1.75}
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
