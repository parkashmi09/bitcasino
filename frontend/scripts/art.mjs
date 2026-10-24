/**
 * Original vector art for every placeholder image the UI references.
 *
 * Nothing here is derived from the reference site's artwork, which is licensed
 * to its operator and its game studios. Each drawing is generated from a hash
 * of the item's slug, so output is stable across runs but varied across items.
 *
 * Art direction follows the reference site's *technique*: a dark base so the
 * baked-in title stays legible at 140px wide, a single saturated accent, and a
 * category-specific emblem instead of a generic shape.
 */

/** FNV-1a — small, fast, and stable across runs. */
export function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const escapeXml = (s) =>
  String(s).replace(/[<>&'"]/g, (c) =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c],
  );

/**
 * Tile palette. Hue is quantised into a casino-ish set (violets, teals, reds,
 * ambers) rather than the full wheel, which is what stops a wall of generated
 * tiles from reading as a random hue soup.
 */
const HUES = [268, 258, 288, 316, 344, 12, 32, 190, 172, 210];

export function palette(slug) {
  const h = hash(slug);
  const hue = HUES[h % HUES.length];
  const accentHue = (hue + 150 + (h % 60)) % 360;
  return {
    /** Deep base, top of the tile. */
    base: `hsl(${hue} 58% 20%)`,
    /** Near-black foot, so the title always has contrast. */
    foot: `hsl(${hue} 62% 7%)`,
    /** Mid glow behind the emblem. */
    glow: `hsl(${hue} 78% 46%)`,
    /** Saturated emblem colour. */
    accent: `hsl(${accentHue} 88% 62%)`,
    accentDeep: `hsl(${accentHue} 78% 44%)`,
    gold: '#FFB319',
  };
}

/* ------------------------------------------------------------- emblems --- */

/**
 * Category emblems, drawn on a 200x200 grid centred at (100, 100) so the
 * caller can place them with a single transform regardless of tile size.
 */
const EMBLEMS = {
  // Pyramid of pegs with a ball dropping through — the "originals" motif.
  originals: (p) => {
    let pegs = '';
    for (let row = 0; row < 5; row++) {
      for (let i = 0; i <= row; i++) {
        const x = 100 + (i - row / 2) * 30;
        const y = 46 + row * 27;
        pegs += `<circle cx="${x.toFixed(1)}" cy="${y}" r="5" fill="${p.accent}" opacity="0.9"/>`;
      }
    }
    return `${pegs}
    <circle cx="70" cy="40" r="15" fill="#fff"/>
    <circle cx="65" cy="35" r="5" fill="#fff" opacity="0.6"/>
    <path d="M70 40 L104 96 L88 158" stroke="${p.gold}" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.7" stroke-dasharray="10 9"/>`;
  },

  // Roulette wheel quadrant plus a chip stack.
  'live-casino': (p) => `
    <circle cx="88" cy="94" r="62" fill="none" stroke="${p.accent}" stroke-width="9"/>
    <circle cx="88" cy="94" r="34" fill="none" stroke="#fff" stroke-width="4" opacity="0.5"/>
    <path d="M88 32 A62 62 0 0 1 150 94 L88 94 Z" fill="${p.gold}" opacity="0.9"/>
    <circle cx="88" cy="94" r="10" fill="#fff"/>
    <g>
      <ellipse cx="148" cy="150" rx="34" ry="12" fill="${p.accentDeep}"/>
      <ellipse cx="148" cy="140" rx="34" ry="12" fill="${p.accent}"/>
      <ellipse cx="148" cy="130" rx="34" ry="12" fill="#fff" opacity="0.92"/>
    </g>`,

  // Three slot reels with symbols.
  'video-slots': (p) => `
    <rect x="18" y="34" width="52" height="132" rx="10" fill="#000" opacity="0.45"/>
    <rect x="74" y="34" width="52" height="132" rx="10" fill="#000" opacity="0.45"/>
    <rect x="130" y="34" width="52" height="132" rx="10" fill="#000" opacity="0.45"/>
    <circle cx="44" cy="76" r="17" fill="${p.gold}"/>
    <path d="M100 60 l9 18 20 3-14.5 14 3.5 20-18-9.5-18 9.5 3.5-20L71 81l20-3 9-18Z" fill="${p.accent}"/>
    <path d="M156 60 l16 28h-32l16-28Z" fill="#fff" opacity="0.9"/>
    <rect x="18" y="100" width="164" height="4" fill="${p.accent}" opacity="0.55"/>
    <circle cx="44" cy="134" r="13" fill="#fff" opacity="0.55"/>
    <circle cx="100" cy="134" r="13" fill="${p.gold}" opacity="0.7"/>
    <circle cx="156" cy="134" r="13" fill="${p.accent}" opacity="0.75"/>`,

  // Fanned playing cards over a chip.
  'table-games': (p) => `
    <g transform="rotate(-18 100 110)">
      <rect x="34" y="46" width="70" height="100" rx="10" fill="#fff" opacity="0.85"/>
      <path d="M69 74 l12 14-12 14-12-14 12-14Z" fill="${p.accentDeep}"/>
    </g>
    <g transform="rotate(10 100 110)">
      <rect x="82" y="40" width="70" height="100" rx="10" fill="#fff"/>
      <path d="M117 62c9 0 15 7 15 15 0 12-15 24-15 24s-15-12-15-24c0-8 6-15 15-15Z" fill="${p.accent}"/>
    </g>
    <ellipse cx="100" cy="168" rx="46" ry="14" fill="${p.gold}" opacity="0.9"/>`,

  // Rocket trail climbing off the top-right — crash games.
  crash: (p) => `
    <path d="M14 176 C 62 172 104 138 134 76" stroke="${p.accent}" stroke-width="10" fill="none" stroke-linecap="round"/>
    <path d="M14 176 C 62 172 104 138 134 76 L134 176 Z" fill="${p.accent}" opacity="0.18"/>
    <g transform="rotate(38 148 58)">
      <path d="M148 26c14 12 20 28 20 44 0 8-8 14-20 14s-20-6-20-14c0-16 6-32 20-44Z" fill="#fff"/>
      <circle cx="148" cy="58" r="8" fill="${p.accentDeep}"/>
      <path d="M132 78l-10 20 18-8Zm32 0l10 20-18-8Z" fill="${p.gold}"/>
    </g>
    <circle cx="42" cy="60" r="4" fill="#fff" opacity="0.6"/>
    <circle cx="66" cy="34" r="3" fill="#fff" opacity="0.4"/>`,

  // Prize wheel with alternating segments.
  'game-shows': (p) => {
    const segs = Array.from({ length: 8 }, (_, i) => {
      const a0 = (i * Math.PI) / 4;
      const a1 = ((i + 1) * Math.PI) / 4;
      const R = 66;
      const x0 = 100 + R * Math.cos(a0);
      const y0 = 104 + R * Math.sin(a0);
      const x1 = 100 + R * Math.cos(a1);
      const y1 = 104 + R * Math.sin(a1);
      const fill = i % 2 ? p.accent : p.gold;
      return `<path d="M100 104 L${x0.toFixed(1)} ${y0.toFixed(1)} A66 66 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${fill}" opacity="${i % 2 ? 0.95 : 0.85}"/>`;
    }).join('');
    return `${segs}
    <circle cx="100" cy="104" r="66" fill="none" stroke="#fff" stroke-width="5" opacity="0.85"/>
    <circle cx="100" cy="104" r="16" fill="#fff"/>
    <path d="M100 24l12 20h-24l12-20Z" fill="#fff"/>`;
  },

  // Coin stack under a crown.
  jackpots: (p) => `
    <path d="M46 74l18 22 36-44 36 44 18-22v50H46V74Z" fill="${p.gold}"/>
    <circle cx="46" cy="70" r="9" fill="#fff"/>
    <circle cx="154" cy="70" r="9" fill="#fff"/>
    <circle cx="100" cy="46" r="10" fill="#fff"/>
    <g>
      <ellipse cx="100" cy="170" rx="52" ry="16" fill="${p.accentDeep}"/>
      <ellipse cx="100" cy="158" rx="52" ry="16" fill="${p.accent}"/>
      <ellipse cx="100" cy="146" rx="52" ry="16" fill="${p.gold}"/>
      <ellipse cx="100" cy="146" rx="30" ry="9" fill="#fff" opacity="0.35"/>
    </g>`,
};

/**
 * Each category draws from a small set of on-theme emblems rather than one.
 * A rail of twelve slot games all showing the identical reel drawing reads as
 * a placeholder grid; rotating through siblings makes the row read as a
 * catalogue, which is the effect the reference gets from real art.
 */
const VARIANTS = {
  originals: ['originals', 'crash', 'game-shows'],
  'live-casino': ['live-casino', 'table-games', 'game-shows'],
  'video-slots': ['video-slots', 'jackpots', 'table-games'],
  'table-games': ['table-games', 'live-casino', 'jackpots'],
  crash: ['crash', 'originals', 'video-slots'],
  'game-shows': ['game-shows', 'live-casino', 'originals'],
  jackpots: ['jackpots', 'game-shows', 'video-slots'],
};

/** Sparkle plus-signs scattered from the hash — the reference uses these too. */
function sparkles(slug, w, h, count = 5) {
  const n = hash(slug + ':sparkle');
  return Array.from({ length: count }, (_, i) => {
    const x = 20 + ((n >> (i * 3)) % (w - 40));
    const y = 20 + ((n >> (i * 4)) % Math.round(h * 0.62));
    const s = 5 + ((n >> (i * 2)) % 7);
    const o = (0.15 + ((n >> i) % 30) / 100).toFixed(2);
    return `<path d="M${x} ${y - s}v${s * 2}M${x - s} ${y}h${s * 2}" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity="${o}"/>`;
  }).join('');
}

/* --------------------------------------------------------- game thumbs --- */

/**
 * Game tile. `wide` produces the featured 1.3:1 variant used by the first rail;
 * the default is the 0.745:1 portrait every other rail uses.
 *
 * Artwork only — no title, no studio, no foot scrim. The reference's own
 * thumbnails carry none of the three either: it sets the caption over the
 * image in the DOM, and `GameCard` now does the same. Baking it in here would
 * print it twice, and would leave a real captured thumbnail (the five under
 * `images/originals/`) as the only untitled tile in the grid.
 */
export function gameThumb(title, slug, category, provider, { wide = false } = {}) {
  const p = palette(slug);
  const W = wide ? 732 : 420;
  const H = 564;
  const options = VARIANTS[category] ?? VARIANTS['video-slots'];
  const emblem = EMBLEMS[options[hash(slug + ':emblem') % options.length]](p);

  // Emblem is authored on a 200x200 grid; scale it to fill the upper two thirds.
  const scale = wide ? 1.85 : 1.5;
  const ex = W / 2 - 100 * scale;
  const ey = H * 0.34 - 100 * scale;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(title)} by ${escapeXml(provider)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${p.base}"/>
      <stop offset="0.55" stop-color="${p.base}"/>
      <stop offset="1" stop-color="${p.foot}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.34" r="0.6">
      <stop offset="0" stop-color="${p.glow}" stop-opacity="0.85"/>
      <stop offset="1" stop-color="${p.glow}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${sparkles(slug, W, H)}
  <g transform="translate(${ex.toFixed(1)} ${ey.toFixed(1)}) scale(${scale})">${emblem}</g>
</svg>
`;
}

/* -------------------------------------------------------- provider mark --- */

/**
 * Studio wordmark. The reference renders these as flat greyscale lockups in a
 * single row, so the mark is monochrome and inherits nothing from the tile
 * palette — colour would fight the row.
 */
export function providerLogo(name, slug) {
  const h = hash(slug);
  const upper = name.toUpperCase();
  // Two lockup shapes, chosen by hash, so the row does not look mechanical.
  const stacked = h % 2 === 0 && name.includes(' ');
  const [first, ...rest] = name.split(' ');

  const glyph = `<g fill="#8A8A8A">
    <circle cx="13" cy="20" r="5"/>
    <circle cx="25" cy="12" r="3.2" opacity="0.7"/>
    <circle cx="25" cy="28" r="3.2" opacity="0.7"/>
  </g>`;

  // The wordmark has to hold its own at 128px wide, so it is sized to fill the
  // viewBox rather than sitting in it — a tight box is what keeps these legible
  // once `object-contain` scales the row to a common height.
  const body = stacked
    ? `<text x="36" y="20" font-family="'Space Grotesk',system-ui,sans-serif" font-size="19" font-weight="700" letter-spacing="0.3" fill="#6E6E6E">${escapeXml(first.toUpperCase())}</text>
  <text x="37" y="33" font-family="'DM Sans',system-ui,sans-serif" font-size="9" font-weight="500" letter-spacing="3.4" fill="#9A9A9A">${escapeXml(rest.join(' ').toUpperCase())}</text>`
    : `<text x="36" y="27" font-family="'Space Grotesk',system-ui,sans-serif" font-size="${upper.length > 12 ? 16 : 20}" font-weight="700" letter-spacing="0.3" fill="#6E6E6E">${escapeXml(upper)}</text>`;

  // Roughly 11px per character at the sizes above, plus the glyph column.
  const width = Math.round(
    36 + (stacked ? first.length * 11.5 : upper.length * (upper.length > 12 ? 9.5 : 12)) + 8,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 40" width="${width}" height="40" role="img" aria-label="${escapeXml(name)}">
  ${glyph}
  ${body}
</svg>
`;
}

/* ----------------------------------------------------------- promo art --- */

/**
 * The picture on a promotion card.
 *
 * Rendered at **700x290**, which is the size the reference requests for both
 * places one of these appears: the row on `/promotions` and the 343x142 rail
 * beside a detail page. Both are the same 2.41:1 crop, so one file serves
 * both and neither needs `object-cover` to save it.
 *
 * The drawing itself is still laid out in the 640x320 grid it was written in;
 * the `viewBox` takes a 265-tall band out of the middle of that composition
 * rather than restating every coordinate. Everything with a subject in it —
 * the coin at cy 96, the sweep at y 250 — sits inside the band.
 */
export function promoArt(title, slug) {
  const p = palette(slug);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 27 640 265" width="700" height="290" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="p" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.base}"/><stop offset="1" stop-color="${p.foot}"/>
    </linearGradient>
    <radialGradient id="pg" cx="0.76" cy="0.28" r="0.6">
      <stop offset="0" stop-color="${p.glow}" stop-opacity="0.9"/>
      <stop offset="1" stop-color="${p.glow}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="640" height="320" fill="url(#p)"/>
  <rect width="640" height="320" fill="url(#pg)"/>
  <circle cx="486" cy="96" r="72" fill="${p.gold}" opacity="0.92"/>
  <circle cx="486" cy="96" r="46" fill="none" stroke="#fff" stroke-width="6" opacity="0.55"/>
  <path d="M470 70h22a16 16 0 0 1 0 32h-22V70Zm0 32h26a17 17 0 0 1 0 34h-26v-34Z" fill="${p.foot}" opacity="0.8"/>
  <path d="M-20 250 C 120 200 220 300 360 250 S 600 200 680 246 V320 H-20 Z" fill="${p.accent}" opacity="0.35"/>
  ${sparkles(slug, 640, 320, 6)}
</svg>
`;
}

/* ----------------------------------------------------------- theme art --- */

/** Landscape collection tile with the label baked in. */
export function themeArt(label, slug) {
  const p = palette(slug);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270" width="480" height="270" role="img" aria-label="${escapeXml(label)}">
  <defs>
    <linearGradient id="t" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="${p.base}"/><stop offset="1" stop-color="${p.foot}"/>
    </linearGradient>
    <radialGradient id="tg" cx="0.5" cy="0.35" r="0.62">
      <stop offset="0" stop-color="${p.glow}" stop-opacity="0.8"/>
      <stop offset="1" stop-color="${p.glow}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="tf" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.foot}" stop-opacity="0"/><stop offset="1" stop-color="${p.foot}"/>
    </linearGradient>
  </defs>
  <rect width="480" height="270" fill="url(#t)"/>
  <rect width="480" height="270" fill="url(#tg)"/>
  <g transform="translate(140 -6) scale(1)">${EMBLEMS['game-shows'](p)}</g>
  ${sparkles(slug, 480, 270, 5)}
  <rect y="130" width="480" height="140" fill="url(#tf)"/>
  <text x="240" y="222" text-anchor="middle" font-family="'Space Grotesk',system-ui,sans-serif" font-size="34" font-weight="700" letter-spacing="0.5" fill="#fff">${escapeXml(label.toUpperCase())}</text>
</svg>
`;
}

/* ----------------------------------------------------------- hero art --- */

/**
 * Above-the-fold illustration. The reference pairs a character cut-out with an
 * orange disc and a purple sweep; this is the same composition built from
 * original abstract shapes — a coin, a sweep, a disc and sparkles.
 */
export const HERO_ART = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 580" width="800" height="580" role="img" aria-label="Crypto casino illustration">
  <defs>
    <linearGradient id="disc" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#FFB067"/><stop offset="1" stop-color="#F2590D"/>
    </linearGradient>
    <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#8B5CF6"/><stop offset="1" stop-color="#5B21B6"/>
    </linearGradient>
    <linearGradient id="coin" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#FFD980"/><stop offset="0.5" stop-color="#F0A32A"/><stop offset="1" stop-color="#C77A0B"/>
    </linearGradient>
    <linearGradient id="tower" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#A78BFA"/><stop offset="1" stop-color="#6D28D9"/>
    </linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7C3AED" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#7C3AED" stop-opacity="0"/>
    </linearGradient>
  </defs>

  <!-- Orange disc, clipped by the frame on the end side. -->
  <circle cx="676" cy="278" r="212" fill="url(#disc)" opacity="0.92"/>
  <circle cx="676" cy="278" r="212" fill="#fff" opacity="0.08"/>

  <!-- Purple sweep across the foot. -->
  <path d="M92 580 C 150 430 330 470 430 400 C 520 338 610 372 800 336 V580 Z" fill="url(#sweep)"/>
  <path d="M92 580 C 150 430 330 470 430 400 C 520 338 610 372 800 336 V580 Z" fill="url(#fade)"/>

  <!-- Stylised chip tower rising out of the sweep. -->
  <g>
    <ellipse cx="404" cy="470" rx="132" ry="42" fill="#4C1D95" opacity="0.55"/>
    <rect x="272" y="300" width="264" height="170" fill="url(#tower)"/>
    <ellipse cx="404" cy="300" rx="132" ry="42" fill="#C4B5FD"/>
    <ellipse cx="404" cy="300" rx="82" ry="26" fill="#7C3AED" opacity="0.55"/>
    <path d="M272 300v170" stroke="#fff" stroke-width="3" opacity="0.25"/>
    <path d="M536 300v170" stroke="#000" stroke-width="3" opacity="0.15"/>
  </g>

  <!-- Coin held above the tower, with a radiating burst. -->
  <g>
    ${Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2;
      const x1 = 404 + Math.cos(a) * 104;
      const y1 = 178 + Math.sin(a) * 104;
      const x2 = 404 + Math.cos(a) * 142;
      const y2 = 178 + Math.sin(a) * 142;
      return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="#8B5CF6" stroke-width="11" stroke-linecap="round"/>`;
    }).join('\n    ')}
    <circle cx="404" cy="178" r="86" fill="url(#coin)"/>
    <circle cx="404" cy="178" r="70" fill="none" stroke="#fff" stroke-width="5" opacity="0.45"/>
    <path d="M378 132h30a22 22 0 0 1 0 44h-30v-44Zm0 44h36a23 23 0 0 1 0 46h-36v-46Z" fill="#fff" opacity="0.95"/>
    <path d="M392 118v18M414 118v18M392 222v18M414 222v18" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity="0.95"/>
  </g>

  <!-- Sparkles. -->
  <g stroke="#7C3AED" stroke-width="7" stroke-linecap="round">
    <path d="M690 108v40M670 128h40"/>
    <path d="M596 470v26M583 483h26" opacity="0.8"/>
  </g>
  <g stroke="#F2590D" stroke-width="6" stroke-linecap="round" opacity="0.85">
    <path d="M754 452v30M739 467h30"/>
    <path d="M214 250v22M203 261h22"/>
  </g>
</svg>
`;

/* ---------------------------------------------------------- banner art --- */

/**
 * Portrait card art for the signed-in home banner, at the reference's own
 * 496x514 card box.
 *
 * The reference's three cards are one full-bleed image each, with the heading
 * and blurb laid over the bottom of it — so the art has to do two jobs at
 * once. It carries the subject in the upper two thirds, then hands the lower
 * third over to colour dark enough for white 32px copy to sit on it unaided.
 * That is why the foot here is a scrim baked into the image rather than an
 * overlay in the component: the card renders the art as a `background-image`,
 * and a separate scrim element would need its own stacking context over it.
 *
 * `emblem` picks the motif; everything else is derived from the slug hash, so
 * the three cards differ from each other but never re-roll between runs.
 */
export function bannerArt(title, slug, emblem = 'game-shows') {
  const p = palette(slug);
  const W = 496;
  const H = 514;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="bb" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${p.base}"/><stop offset="1" stop-color="${p.foot}"/>
    </linearGradient>
    <radialGradient id="bg" cx="0.5" cy="0.3" r="0.7">
      <stop offset="0" stop-color="${p.glow}" stop-opacity="0.85"/>
      <stop offset="1" stop-color="${p.glow}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bs" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.foot}" stop-opacity="0"/>
      <stop offset="0.45" stop-color="${p.foot}" stop-opacity="0.72"/>
      <stop offset="1" stop-color="${p.foot}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bb)"/>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Accent sweep across the shoulder of the card, clipped by the frame. -->
  <path d="M-40 319 C 120 257 260 380 536 288 V514 H-40 Z" fill="${p.accent}" opacity="0.28"/>

  <g transform="translate(148 44) scale(1.08)">${EMBLEMS[emblem](p)}</g>
  ${sparkles(slug, W, H, 7)}

  <!-- Copy sits in the bottom 48%; this is what keeps it legible. -->
  <rect y="267" width="${W}" height="247" fill="url(#bs)"/>
</svg>
`;
}

/* ------------------------------------------------------- sidebar promo --- */

/** 232x75 banner card pinned above the sidebar navigation. */
export const SIDEBAR_PROMO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 464 150" width="464" height="150" role="img" aria-label="Loyalty league promotion">
  <defs>
    <linearGradient id="sp" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#F2590D"/><stop offset="0.62" stop-color="#B4380E"/><stop offset="1" stop-color="#6D28D9"/>
    </linearGradient>
  </defs>
  <rect width="464" height="150" fill="url(#sp)"/>
  <circle cx="378" cy="42" r="76" fill="#fff" opacity="0.12"/>
  <circle cx="66" cy="132" r="58" fill="#000" opacity="0.14"/>
  <g>
    <ellipse cx="356" cy="112" rx="62" ry="20" fill="#4C1D95" opacity="0.75"/>
    <circle cx="356" cy="66" r="42" fill="#FFD980"/>
    <circle cx="356" cy="66" r="30" fill="none" stroke="#B4380E" stroke-width="5" opacity="0.55"/>
    <path d="M344 46h14a10 10 0 0 1 0 20h-14V46Zm0 20h17a11 11 0 0 1 0 22h-17V66Z" fill="#B4380E"/>
  </g>
  <text x="28" y="58" font-family="'Space Grotesk',system-ui,sans-serif" font-size="26" font-weight="700" fill="#fff">LEAGUE</text>
  <text x="28" y="90" font-family="'DM Sans',system-ui,sans-serif" font-size="17" font-weight="500" fill="#fff" opacity="0.9">Climb the ranks</text>
  <rect x="28" y="104" width="120" height="6" rx="3" fill="#fff" opacity="0.35"/>
  <rect x="28" y="104" width="74" height="6" rx="3" fill="#fff"/>
</svg>
`;

/* ---------------------------------------------------------------- icons --- */

export const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" width="28" height="28">
  <rect width="28" height="28" rx="8" fill="#F2590D"/>
  <path d="M9 8.5h6.2a3.6 3.6 0 0 1 0 7.2H9V8.5Zm0 7.2h6.8a3.9 3.9 0 0 1 0 7.8H9v-7.8Z" fill="#fff" opacity="0.95"/>
  <circle cx="19.5" cy="9" r="2.2" fill="#FFB319"/>
</svg>
`;

/* ------------------------------------------------------ tournament art --- */

/**
 * Tier colours for the tournament plaque.
 *
 * These do NOT come from `palette()`. Every other piece of art here derives its
 * colour from a hash of the slug, which is what keeps a catalogue of a hundred
 * games from repeating itself. A tournament tier is the opposite problem: gold
 * has to look like gold and bronze like bronze, and two tournaments of the same
 * tier have to match. So the ramp is named, not hashed.
 */
const TIERS = {
  gold: { lo: '#7A4B04', mid: '#FFC53D', hi: '#FFF1C4', ribbon: '#B3231C' },
  silver: { lo: '#4A5560', mid: '#D6DEE6', hi: '#FFFFFF', ribbon: '#B3231C' },
  bronze: { lo: '#5C2F12', mid: '#C97B3F', hi: '#F3C79A', ribbon: '#B3231C' },
};

/**
 * The wide banner across the top of a tournament card — 546x182 in the layout,
 * drawn at 3x so it stays sharp on a retina panel.
 *
 * The reference's own art is a photographed metal plaque on a dark smoky field
 * with a red ribbon sashed across it, the tier name embossed into the plate.
 * This is that composition in vector: a radial haze, a bevelled plate built
 * from three stops of the tier ramp, the ribbon, and the title cut out of the
 * plate in the display face.
 *
 * `finished` is NOT handled here. The reference greys its finished art with a
 * CSS `grayscale(1)` filter on the same image rather than shipping a second
 * file, so one asset serves both states and the card decides.
 */
export function tournamentArt(title, slug, tier = 'silver') {
  const t = TIERS[tier] ?? TIERS.silver;
  const W = 1638;
  const H = 546;
  const label = escapeXml(title.replace(/\s*#\d+$/, '').toUpperCase());

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(title)}">
  <defs>
    <linearGradient id="plate" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.hi}"/>
      <stop offset="0.42" stop-color="${t.mid}"/>
      <stop offset="0.58" stop-color="${t.lo}"/>
      <stop offset="1" stop-color="${t.mid}"/>
    </linearGradient>
    <linearGradient id="ribbon" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${t.ribbon}"/>
      <stop offset="1" stop-color="#7C120E"/>
    </linearGradient>
    <radialGradient id="haze" cx="0.5" cy="0.5" r="0.62">
      <stop offset="0" stop-color="#2B4B87" stop-opacity="0.85"/>
      <stop offset="0.62" stop-color="#4A1C6B" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#05070C" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#05070C"/>
  <rect width="${W}" height="${H}" fill="url(#haze)"/>

  <!-- Sash first, so the plate lands on top of it and it reads as passing
       behind the plaque. It crosses the LOWER third rather than the middle:
       through the centre it cuts the engraved title in half and the whole
       banner reads as struck through. -->
  <path d="M64 470 L1574 300 l0 118 L64 588 Z" fill="url(#ribbon)"/>

  <g transform="translate(${W / 2} ${H / 2})">
    <rect x="-500" y="-118" width="1000" height="236" rx="14" fill="url(#plate)"/>
    <rect x="-500" y="-118" width="1000" height="236" rx="14" fill="none" stroke="${t.hi}" stroke-width="5" opacity="0.55"/>
    <rect x="-464" y="-86" width="928" height="172" rx="8" fill="none" stroke="${t.lo}" stroke-width="4" opacity="0.5"/>
    <text x="0" y="30" text-anchor="middle" font-family="'Space Grotesk',system-ui,sans-serif" font-size="${plateFontSize(label)}" font-weight="700" letter-spacing="6" fill="${t.lo}" opacity="0.9">${label}</text>
  </g>

  <!-- The sash again, clipped below the plate's foot, so it crosses in front
       on the way out and the plaque looks threaded onto it. -->
  <path d="M64 470 L1574 300 l0 118 L64 588 Z" fill="url(#ribbon)" clip-path="inset(72% 0 0 0)"/>
</svg>
`;
}

/**
 * Fit the engraved title inside the plate's 928px inner border.
 *
 * `Space Grotesk` bold averages ~0.62em per glyph, and the tracking adds a
 * flat 6px on top of every one. Solving that for the width the plate has is
 * cheaper and more reliable than measuring text in a build script with no DOM
 * — and the failure it prevents is not subtle: at a flat 104px, anything
 * longer than `GOLD CHALLENGE` runs straight through the bevel and off the
 * plate.
 */
function plateFontSize(label) {
  const perGlyph = 880 / Math.max(label.length, 1);
  return Math.round(Math.min(104, Math.max(44, (perGlyph - 6) / 0.62)));
}

/* ------------------------------------------------------ originals tiles --- */

/**
 * The in-house games' artwork.
 *
 * These twenty are the one part of the catalogue that is *ours* — a
 * `PLAY_*` socket event against casino-service rather than a provider iframe —
 * so unlike a licensed slot they need art that this repository can actually
 * ship. Until now the seeder pointed every one of them at
 * `/images/categories/originals.png`, which is the 64x64 sidebar nav icon: one
 * blurry pinwheel, repeated twenty-one times down the Originals page.
 *
 * ## The art direction is measured, not guessed
 *
 * ## Five of the twenty are not drawn at all
 *
 * The reference's Originals provider page (`/providers/bitcasino-originals`)
 * lists exactly six games — Plinko, Baccarat, Dice, Hilo, Blackjack, Roulette
 * — and nothing else on its CDN answers to any of the other names. Five of the
 * six are games this platform also deals, so those five ship the *real*
 * artwork, fetched at both crops by `scripts/fetch-originals.mjs`, and
 * `ORIGINAL_ART` in `generate-assets.mjs` skips them. Baccarat is captured too
 * but unused: there is no baccarat original here. The remaining fifteen are
 * drawn, and everything below exists to make them sit beside the five without
 * the seam showing.
 *
 * ## The art direction is measured, not guessed
 *
 * Decoding the captured PNGs and reading fixed points gives the ground
 * exactly, and it is the same in all five: an almost flat near-black violet
 * (`#170533` at the corners, `#15042F` along the foot) under a wide bloom on
 * the top edge peaking at `#2B0F58`, and a softer one behind the subject. See
 * `GROUND`. The subject is always a single object floating in the upper two
 * thirds, modelled in two colours — violet `#6A10F9` and orange `#FFA100` —
 * with white speculars, a white ribbon orbiting it, and a scatter of white
 * motes. `SUBJECT_DEFS`, `ribbon` and `motes` are that composition; each
 * emblem only draws the object.
 *
 * ## Why both ratios
 *
 * The portrait tile is the 420x564 the category grid lays out; the wide one is
 * the 732x564 the home page's featured rail reads (`data/homeRails.js`), and
 * the Originals rail is the featured rail. Each emblem is authored once on the
 * same 200x200 grid every other emblem here uses and rendered into both boxes,
 * rather than letting the grid centre-crop a third of the drawing away.
 *
 * Neither carries text. The reference captions its tiles in the DOM over the
 * image, not in the image, and `GameCard` does the same — which is also the
 * only arrangement under which a captured thumbnail and a drawn one can carry
 * the same caption.
 */

/** uid -> title. Mirrors `IN_HOUSE_TITLES` in `backend/scripts/seed-data.js`. */
export const ORIGINALS = Object.freeze({
  crash: 'Crash', classic_dice: 'Classic Dice', hash_dice: 'Hash Dice', limbo: 'Limbo',
  keno: 'Keno', single_keno: 'Single Keno', hilo: 'Hi-Lo', highlow: 'High Low',
  wheel: 'Wheel', magic_wheel: 'Magic Wheel', plinko: 'Plinko', mine: 'Mines',
  tower: 'Tower', diamond: 'Diamonds', goal: 'Goal', roulette: 'Roulette',
  blackjack: 'Blackjack', videopoker: 'Video Poker', three_card_monte: 'Three Card Monte',
  snake_and_ladders: 'Snakes and Ladders',
});

/**
 * The in-house games the reference has real artwork for, and where it lives.
 *
 * Keys are our uid; values are the path under `heathmont.imgix.net` that its
 * own Originals page loads. `scripts/fetch-originals.mjs` pulls both crops,
 * `generate-assets.mjs` skips drawing these, and `inHouseRow` in
 * `backend/scripts/seed-data.js` mirrors the key list so it can point at
 * `.avif` instead of `.svg`.
 *
 * `baccarat` is captured but has no key here: the reference deals one and this
 * platform does not, so there is no tile for it to fill. It is kept under
 * `images/originals/` as the sixth sample the drawn tiles are measured
 * against — see `GROUND` — and nothing references it.
 *
 * Nothing else on that CDN answers: every other in-house name, in every
 * spelling, 403s. So this map is five entries and will stay five until the
 * reference ships more.
 */
export const CAPTURED_ORIGINALS = Object.freeze({
  plinko: 'casino-onetouch/plinko.png',
  blackjack: 'casino-onetouch/blackjack.png',
  hilo: 'casino-onetouch/hilo.png',
  classic_dice: 'casino-onetouch/dice.png',
  roulette: 'bitcasino/images/roullete-originals-thumbnail-card+lg.png',
});

/**
 * The ground, re-sampled off the five captured tiles pixel by pixel.
 *
 * An earlier pass read these as a `#4A1C82 → #16052A` ramp, which is roughly
 * three stops too bright — it measured the bloom, not the ground, and the
 * result was a wall of mid-violet tiles beside a reference that is nearly
 * black. Decoding the PNGs and reading fixed points gives the real thing, and
 * it is the same in all five to within two levels:
 *
 *   corner (0,0) #170533   top centre #2B0F58   left edge, mid #1D083E
 *   bottom, anywhere across the width #15042F
 *
 * So: an almost flat near-black violet, lifted only by a wide bloom sitting on
 * the top edge and a softer one behind the subject. The contrast in these
 * tiles is carried entirely by the object, which is why a brighter ground
 * flattened them.
 */
const GROUND = `
    <linearGradient id="og" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#170533"/>
      <stop offset="0.55" stop-color="#170533"/>
      <stop offset="0.78" stop-color="#160531"/>
      <stop offset="1" stop-color="#15042F"/>
    </linearGradient>
    <radialGradient id="obloom" cx="0.5" cy="0" r="0.62">
      <stop offset="0" stop-color="#5B27B2" stop-opacity="0.42"/>
      <stop offset="0.55" stop-color="#4A1C82" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#4A1C82" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="oglow" cx="0.5" cy="0.36" r="0.6">
      <stop offset="0" stop-color="#5B27B2" stop-opacity="0.5"/>
      <stop offset="0.6" stop-color="#3A1272" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#3A1272" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ohalo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#8B45E8" stop-opacity="0.5"/>
      <stop offset="0.62" stop-color="#6A2FD8" stop-opacity="0.16"/>
      <stop offset="1" stop-color="#6A2FD8" stop-opacity="0"/>
    </radialGradient>`;

/** The two-colour model every subject is built from, plus its speculars. */
const SUBJECT_DEFS = `
    <linearGradient id="vio" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#C4A2FF"/><stop offset="0.45" stop-color="#8B5CF6"/><stop offset="1" stop-color="#6A10F9"/>
    </linearGradient>
    <linearGradient id="vioD" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#6A2FD8"/><stop offset="1" stop-color="#2E0B68"/>
    </linearGradient>
    <linearGradient id="org" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#FFD07A"/><stop offset="0.42" stop-color="#FFA100"/><stop offset="1" stop-color="#EE7407"/>
    </linearGradient>
    <linearGradient id="orgD" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="#F08B00"/><stop offset="1" stop-color="#A94A05"/>
    </linearGradient>
    <linearGradient id="wht" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset="0.62" stop-color="#F3EEFF"/><stop offset="1" stop-color="#CBBBF0"/>
    </linearGradient>
    <linearGradient id="swoosh" gradientUnits="userSpaceOnUse" x1="6" y1="26" x2="196" y2="188">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.15"/>
      <stop offset="0.38" stop-color="#FFFFFF" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0.35"/>
    </linearGradient>`;

/**
 * The white ribbon that orbits every subject.
 *
 * Drawn as a closed tapered band between two offsets of the same ellipse
 * rather than a stroked arc: the reference's ribbon is thick through the
 * middle and comes to a point at both ends, which a uniform `stroke-width`
 * cannot do. Each subject calls it twice — once before the object and once
 * after — so the band passes behind and then in front, which is what reads as
 * an orbit rather than a circle drawn on top.
 */
function ribbon({ cx = 100, cy = 104, rx = 96, ry = 58, from = 150, to = 476, part = [0, 1], w = 7, rot = -19, steps = 36 }) {
  const outer = [];
  const inner = [];
  for (let i = 0; i <= steps; i++) {
    // `part` is the slice of the whole orbit this pass draws. The taper is a
    // function of position along the ORBIT, not along the slice, so the two
    // passes meet at full width instead of pinching to a point at the seam.
    const t = part[0] + (part[1] - part[0]) * (i / steps);
    const a = ((from + (to - from) * t) * Math.PI) / 180;
    // Thin at both ends, fullest at 55% along — the taper the reference draws.
    const half = w * Math.sin(Math.PI * t) ** 0.55 + 0.35;
    const px = cx + rx * Math.cos(a);
    const py = cy + ry * Math.sin(a);
    let nx = Math.cos(a) / rx;
    let ny = Math.sin(a) / ry;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    outer.push(`${(px + nx * half).toFixed(1)} ${(py + ny * half).toFixed(1)}`);
    inner.push(`${(px - nx * half).toFixed(1)} ${(py - ny * half).toFixed(1)}`);
  }
  const d = `M${outer.join('L')}L${inner.reverse().join('L')}Z`;
  return `<path d="${d}" fill="url(#swoosh)" transform="rotate(${rot} ${cx} ${cy})"/>`;
}

/** The dust the ribbon throws off: hashed white motes, plus one four-point star. */
function motes(slug) {
  const h = hash(slug + ':mote');
  const dots = Array.from({ length: 9 }, (_, i) => {
    const a = ((h >> (i * 2)) % 360) * (Math.PI / 180);
    const r = 74 + ((h >> (i + 3)) % 46);
    const x = 100 + Math.cos(a) * r * 1.15;
    const y = 104 + Math.sin(a) * r * 0.72;
    const s = 1.6 + ((h >> i) % 5) * 0.7;
    const o = (0.3 + ((h >> (i + 5)) % 55) / 100).toFixed(2);
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.toFixed(1)}" fill="#fff" opacity="${o}"/>`;
  }).join('');
  const sx = h % 2 ? 168 : 36;
  return `${dots}${star(sx, 44, 13, 0.95)}`;
}

/** A four-point sparkle with concave sides — the reference's own star shape. */
function star(x, y, s, o = 1) {
  const k = s * 0.17;
  return `<path d="M${x} ${y - s}Q${x + k} ${y - k} ${x + s} ${y}Q${x + k} ${y + k} ${x} ${y + s}Q${x - k} ${y + k} ${x - s} ${y}Q${x - k} ${y - k} ${x} ${y - s}Z" fill="#fff" opacity="${o}"/>`;
}

/* -- solids the emblems are assembled from, all on the 200x200 grid -------- */

/**
 * An isometric die, pipped on all three visible faces.
 *
 * Each face is a parallelogram spanned by two edge vectors, so a pip given in
 * face coordinates (u, v in -0.5..0.5) is placed by the same two lines of
 * arithmetic whichever face it is on — and lands on the face's own plane,
 * which is what stops the pips reading as dots floating over a cube.
 */
function die(cx, cy, s, { faces = 'white', top = 3, left = 2, right = 4 } = {}) {
  const h = s * 0.52;
  const H = s * 1.12;
  const skin =
    faces === 'violet'
      ? { top: 'url(#vio)', left: '#5B0FD6', right: '#42099E', pip: '#F4EDFF' }
      : { top: '#FDFCFF', left: '#E3D9F6', right: '#C7B9E8', pip: '#2E0B68' };

  const SPOTS = {
    1: [[0, 0]],
    2: [[-0.26, -0.26], [0.26, 0.26]],
    3: [[-0.28, -0.28], [0, 0], [0.28, 0.28]],
    4: [[-0.26, -0.26], [0.26, -0.26], [-0.26, 0.26], [0.26, 0.26]],
    5: [[-0.28, -0.28], [0.28, -0.28], [0, 0], [-0.28, 0.28], [0.28, 0.28]],
    6: [[-0.28, -0.3], [0.28, -0.3], [-0.28, 0], [0.28, 0], [-0.28, 0.3], [0.28, 0.3]],
  };

  // face: centre plus the two edge vectors that span it.
  const pips = (value, c, e1, e2, rx, ry) =>
    (SPOTS[value] ?? SPOTS[1])
      .map(([u, v]) => {
        const x = c[0] + u * e1[0] + v * e2[0];
        const y = c[1] + u * e1[1] + v * e2[1];
        return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="${skin.pip}"/>`;
      })
      .join('');

  return `
    <path d="M${cx} ${cy - h} L${cx + s} ${cy - h / 2} L${cx} ${cy} L${cx - s} ${cy - h / 2} Z" fill="${skin.top}"/>
    <path d="M${cx - s} ${cy - h / 2} L${cx} ${cy} L${cx} ${cy + H} L${cx - s} ${cy + H - h / 2} Z" fill="${skin.left}"/>
    <path d="M${cx + s} ${cy - h / 2} L${cx} ${cy} L${cx} ${cy + H} L${cx + s} ${cy + H - h / 2} Z" fill="${skin.right}"/>
    ${pips(top, [cx, cy - h / 2], [s, h / 2], [s, -h / 2], s * 0.1, s * 0.075)}
    ${pips(left, [cx - s / 2, cy - h / 4 + H / 2], [s, h / 2], [0, H], s * 0.1, s * 0.1)}
    ${pips(right, [cx + s / 2, cy - h / 4 + H / 2], [-s, h / 2], [0, H], s * 0.1, s * 0.1)}`;
}

/** A playing card, face up on `mark` or blank. */
function card(x, y, w, h, rot, fill, mark = '') {
  return `<g transform="rotate(${rot} ${x + w / 2} ${y + h / 2})">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${(w * 0.13).toFixed(1)}" fill="${fill}"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h * 0.42}" rx="${(w * 0.13).toFixed(1)}" fill="#fff" opacity="0.14"/>
      ${mark}
    </g>`;
}

/** The back of a face-down card: an inset frame with a lozenge in it. */
function cardBack(x, y, w, h) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return `<rect x="${x + 7}" y="${y + 7}" width="${w - 14}" height="${h - 14}" rx="7" fill="none" stroke="#fff" stroke-width="2.5" opacity="0.45"/>
      <path d="M${cx} ${cy - 15}l11 15-11 15-11-15 11-15Z" fill="#fff" opacity="0.55"/>`;
}

/** A chip, seen at the same three-quarter tilt the reference gives its chips. */
function chip(cx, cy, r, face = 'url(#org)', rim = 'url(#orgD)') {
  const ry = r * 0.62;
  return `
    <ellipse cx="${cx}" cy="${(cy + r * 0.2).toFixed(1)}" rx="${r}" ry="${ry.toFixed(1)}" fill="${rim}"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${ry.toFixed(1)}" fill="${face}"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${(r * 0.56).toFixed(1)}" ry="${(ry * 0.56).toFixed(1)}" fill="#fff" opacity="0.9"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${(r * 0.34).toFixed(1)}" ry="${(ry * 0.34).toFixed(1)}" fill="${face}"/>`;
}

/** A sphere with a specular — the ball in Plinko, Goal, Keno and Roulette. */
function ball(cx, cy, r, grad = 'url(#wht)') {
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${grad}"/>
    <ellipse cx="${(cx - r * 0.3).toFixed(1)}" cy="${(cy - r * 0.36).toFixed(1)}" rx="${(r * 0.34).toFixed(1)}" ry="${(r * 0.26).toFixed(1)}" fill="#fff" opacity="0.75" transform="rotate(-28 ${cx} ${cy})"/>`;
}

/** A coin lying at the stack's tilt, used by Hi-Lo and the wheels' rims. */
function coin(cx, cy, rx, ry, face = 'url(#org)') {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${face}"/>`;
}

/**
 * One object per game, drawn on the 200x200 grid centred at (100, 104).
 *
 * Every one of them is the same idea as the captured six: a single subject,
 * modelled in violet and orange with white speculars, sitting square in the
 * middle with nothing else in the frame. Two games that are variants of each
 * other (`hilo`/`highlow`, `keno`/`single_keno`, `wheel`/`magic_wheel`,
 * `classic_dice`/`hash_dice`) are deliberately drawn as different objects
 * rather than recoloured copies, because a rail showing two near-identical
 * tiles is the problem this set exists to fix.
 */
const ORIGINAL_EMBLEMS = {
  // Rocket climbing its own multiplier curve.
  crash: () => `
    <path d="M18 180 C 62 176 106 150 134 96" stroke="url(#orgD)" stroke-width="15" fill="none" stroke-linecap="round" opacity="0.35"/>
    <path d="M18 180 C 62 176 106 150 134 96" stroke="url(#org)" stroke-width="9" fill="none" stroke-linecap="round"/>
    <g transform="rotate(44 138 74)">
      <path d="M138 16c19 19 28 42 28 63 0 16-12 26-28 26s-28-10-28-26c0-21 9-44 28-63Z" fill="url(#wht)"/>
      <circle cx="138" cy="64" r="13" fill="url(#vio)"/>
      <circle cx="134" cy="60" r="4.4" fill="#fff" opacity="0.9"/>
      <path d="M110 84l-19 33 27-13Zm56 0l19 33-27-13Z" fill="url(#org)"/>
      <path d="M126 106h24l-12 30Z" fill="url(#orgD)"/>
    </g>`,

  // Two dice mid-throw, one white and one violet -- the reference's own pairing.
  classic_dice: () => `
    ${die(70, 118, 34, { faces: 'violet', top: 3, left: 5, right: 2 })}
    ${die(128, 72, 40, { faces: 'white', top: 5, left: 3, right: 6 })}`,

  // One die over the hash it is drawn from.
  hash_dice: () => `
    <g opacity="0.85">
      <path d="M56 74h96M50 106h96" stroke="url(#org)" stroke-width="7" stroke-linecap="round"/>
      <path d="M86 56l-12 72M122 56l-12 72" stroke="url(#org)" stroke-width="7" stroke-linecap="round"/>
    </g>
    ${die(106, 112, 40, { faces: 'white', top: 2, left: 4, right: 5 })}
    <circle cx="46" cy="142" r="5" fill="#fff" opacity="0.6"/>`,

  // A multiplier plate thrown up an orange chevron.
  limbo: () => `
    <path d="M100 24l44 46h-26v34h-36V70H56l44-46Z" fill="url(#org)"/>
    <g transform="rotate(-8 100 140)">
      <rect x="42" y="110" width="116" height="60" rx="18" fill="url(#vio)"/>
      <rect x="42" y="110" width="116" height="26" rx="14" fill="#fff" opacity="0.16"/>
      <path d="M78 128l44 34M122 128l-44 34" stroke="#fff" stroke-width="9" stroke-linecap="round"/>
    </g>
    <circle cx="152" cy="102" r="4.5" fill="#fff" opacity="0.7"/>`,

  // A draw of three balls.
  keno: () => `
    ${ball(70, 128, 32, 'url(#vio)')}
    ${ball(134, 118, 28, 'url(#org)')}
    ${ball(104, 68, 25, 'url(#wht)')}
    <circle cx="70" cy="128" r="17" fill="#fff" opacity="0.22"/>
    <circle cx="134" cy="118" r="15" fill="#fff" opacity="0.25"/>
    <circle cx="104" cy="68" r="13" fill="url(#vio)" opacity="0.35"/>`,

  // One ball, over the card it was drawn against.
  single_keno: () => `
    <g transform="rotate(-12 96 116)">
      <rect x="46" y="66" width="104" height="104" rx="16" fill="url(#vio)"/>
      ${Array.from({ length: 9 }, (_, i) => {
        const x = 62 + (i % 3) * 32;
        const y = 82 + Math.floor(i / 3) * 32;
        return `<rect x="${x}" y="${y}" width="20" height="20" rx="6" fill="#fff" opacity="${i === 4 ? 0.9 : 0.28}"/>`;
      }).join('')}
    </g>
    ${ball(132, 74, 30, 'url(#org)')}`,

  // A stack of coins between the two calls.
  hilo: () => `
    <path d="M18 84l22-28 22 28H48v30H32V84H18Z" fill="url(#org)"/>
    <path d="M138 148l22 28 22-28h-14v-30h-16v30h-14Z" fill="url(#vio)"/>
    <g>
      ${coin(100, 148, 46, 17, 'url(#vioD)')}
      ${coin(100, 134, 46, 17, 'url(#vio)')}
      ${coin(100, 120, 46, 17, 'url(#orgD)')}
      ${coin(100, 106, 46, 17, 'url(#org)')}
      ${coin(100, 106, 27, 9, '#fff')}
    </g>`,

  // The same call, made on a card.
  highlow: () => `
    ${card(64, 52, 78, 108, 8, 'url(#wht)', `
      <path d="M103 74l20 24h-13v22h-14V98H83l20-24Z" fill="url(#org)"/>
      <path d="M103 148l-20-24h13v-16h14v16h13l-20 24Z" fill="url(#vio)" opacity="0.9"/>`)}
    ${chip(150, 140, 28)}`,

  // Prize wheel, straight on, with its pointer.
  wheel: () => {
    const segs = Array.from({ length: 10 }, (_, i) => {
      const a0 = (i * Math.PI) / 5 - Math.PI / 2;
      const a1 = ((i + 1) * Math.PI) / 5 - Math.PI / 2;
      const R = 68;
      return `<path d="M100 106 L${(100 + R * Math.cos(a0)).toFixed(1)} ${(106 + R * Math.sin(a0)).toFixed(1)} A${R} ${R} 0 0 1 ${(100 + R * Math.cos(a1)).toFixed(1)} ${(106 + R * Math.sin(a1)).toFixed(1)} Z" fill="${i % 2 ? 'url(#vio)' : 'url(#org)'}"/>`;
    }).join('');
    return `
    <circle cx="100" cy="112" r="72" fill="#2A0B55" opacity="0.5"/>
    ${segs}
    <circle cx="100" cy="106" r="68" fill="none" stroke="#fff" stroke-width="6" opacity="0.9"/>
    <circle cx="100" cy="106" r="15" fill="#fff"/>
    <circle cx="100" cy="106" r="7" fill="url(#vio)"/>
    <path d="M100 22l14 24h-28l14-24Z" fill="#fff"/>`;
  },

  // The same wheel, tilted and lit -- the "magic" is the star on its hub.
  magic_wheel: () => {
    const segs = Array.from({ length: 8 }, (_, i) => {
      const a0 = (i * Math.PI) / 4 - Math.PI / 2;
      const a1 = ((i + 1) * Math.PI) / 4 - Math.PI / 2;
      const R = 66;
      return `<path d="M100 106 L${(100 + R * Math.cos(a0)).toFixed(1)} ${(106 + R * 0.62 * Math.sin(a0)).toFixed(1)} A${R} ${(R * 0.62).toFixed(1)} 0 0 1 ${(100 + R * Math.cos(a1)).toFixed(1)} ${(106 + R * 0.62 * Math.sin(a1)).toFixed(1)} Z" fill="${i % 2 ? 'url(#vio)' : 'url(#org)'}"/>`;
    }).join('');
    return `
    <ellipse cx="100" cy="120" rx="70" ry="45" fill="#2A0B55" opacity="0.55"/>
    ${segs}
    <ellipse cx="100" cy="106" rx="66" ry="41" fill="none" stroke="#fff" stroke-width="6" opacity="0.85"/>
    <ellipse cx="100" cy="106" rx="14" ry="9" fill="#fff"/>
    ${star(100, 46, 20, 0.95)}
    ${star(154, 70, 10, 0.8)}`;
  },

  // Ball dropping through the pegs, tracing the path it took.
  plinko: () => {
    let pegs = '';
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < row + 4; i++) {
        const x = 100 + (i - (row + 3) / 2) * 30;
        const y = 72 + row * 32;
        pegs += `<circle cx="${x.toFixed(1)}" cy="${(y + 4).toFixed(1)}" r="7.5" fill="url(#orgD)"/><circle cx="${x.toFixed(1)}" cy="${y}" r="7.5" fill="url(#org)"/>`;
      }
    }
    return `
    ${pegs}
    <circle cx="118" cy="36" r="5" fill="#fff" opacity="0.45"/>
    <circle cx="126" cy="50" r="6.5" fill="#fff" opacity="0.6"/>
    ${ball(138, 158, 29)}`;
  },

  // The bomb, and the gem you were digging for.
  mine: () => `
    <path d="M128 52l10-10 8 8-10 10Z" fill="url(#org)"/>
    <path d="M118 66c8-14 18-20 26-14" stroke="url(#org)" stroke-width="7" fill="none" stroke-linecap="round"/>
    ${star(150, 40, 12, 0.95)}
    <circle cx="92" cy="116" r="50" fill="url(#vioD)"/>
    <circle cx="92" cy="116" r="50" fill="url(#vio)" opacity="0.55"/>
    <ellipse cx="74" cy="98" rx="16" ry="11" fill="#fff" opacity="0.55" transform="rotate(-30 74 98)"/>
    <path d="M146 128l18-26 18 26-18 28Z" fill="url(#org)"/>
    <path d="M146 128h36l-18 13Z" fill="#fff" opacity="0.5"/>`,

  // Blocks stacked as far as they went, star on the top one.
  tower: () => {
    const rows = [0, 1, 2, 3]
      .map((i) => {
        const y = 146 - i * 30;
        const w = 116 - i * 14;
        const x = 100 - w / 2;
        const fill = i % 2 ? 'url(#vio)' : 'url(#org)';
        return `<rect x="${x}" y="${y}" width="${w}" height="24" rx="8" fill="${fill}"/>
      <rect x="${x}" y="${y}" width="${w}" height="9" rx="4.5" fill="#fff" opacity="0.22"/>`;
      })
      .join('');
    return `
    <ellipse cx="100" cy="176" rx="72" ry="14" fill="#2A0B55" opacity="0.5"/>
    ${rows}
    ${star(100, 36, 18, 0.95)}`;
  },

  // One cut gem, big, with two chips of it alongside.
  diamond: () => `
    <path d="M100 40l46 34-46 92-46-92 46-34Z" fill="url(#vio)"/>
    <path d="M100 40l46 34-46 26-46-26 46-34Z" fill="url(#wht)" opacity="0.92"/>
    <path d="M54 74h92l-46 92-46-92Z" fill="url(#vio)" opacity="0.35"/>
    <path d="M100 40v26M76 56l24 44M124 56l-24 44" stroke="#fff" stroke-width="3" opacity="0.6" fill="none"/>
    <path d="M158 120l14-18 14 18-14 22Z" fill="url(#org)"/>
    <path d="M24 134l12-16 12 16-12 20Z" fill="url(#org)" opacity="0.85"/>`,

  // The ball, and the net it went into.
  goal: () => `
    <g stroke="#fff" stroke-width="2.5" opacity="0.3">
      <path d="M46 150V70M74 150V70M102 150V70M130 150V70M158 150V70"/>
      <path d="M24 94h158M24 120h158"/>
    </g>
    <path d="M22 152V68h160v84" fill="none" stroke="url(#org)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
    ${ball(112, 136, 40)}
    <path d="M106 102l15 11-6 18h-18l-6-18 15-11Z" fill="url(#vio)"/>
    <path d="M75 118l11 13-7 15M137 118l-11 13 7 15" stroke="url(#vio)" stroke-width="5" fill="none" stroke-linecap="round"/>`,

  // The wheel at its three-quarter tilt, with the ball still running.
  roulette: () => {
    const spokes = Array.from({ length: 12 }, (_, i) => {
      const a = (i * Math.PI) / 6;
      return `<path d="M${(100 + Math.cos(a) * 26).toFixed(1)} ${(106 + Math.sin(a) * 16).toFixed(1)} L${(100 + Math.cos(a) * 62).toFixed(1)} ${(106 + Math.sin(a) * 38).toFixed(1)}" stroke="#fff" stroke-width="2.5" opacity="0.45"/>`;
    }).join('');
    return `
    <ellipse cx="100" cy="120" rx="78" ry="50" fill="url(#vioD)"/>
    <ellipse cx="100" cy="106" rx="78" ry="50" fill="url(#vio)"/>
    <ellipse cx="100" cy="106" rx="64" ry="40" fill="url(#org)"/>
    <ellipse cx="100" cy="106" rx="52" ry="32" fill="#33115F"/>
    ${spokes}
    <ellipse cx="100" cy="106" rx="26" ry="16" fill="url(#org)"/>
    <path d="M80 98l40 16M80 114l40-16" stroke="#FFE3B0" stroke-width="4" stroke-linecap="round"/>
    ${ball(152, 84, 15)}`;
  },

  // The pair you want, over the chip you put on it.
  blackjack: () => `
    ${card(50, 46, 76, 106, -14, 'url(#org)', '<path d="M88 74l16 26H72l16-26Zm0 56l-16-26h32l-16 26Z" fill="#fff" opacity="0.85"/>')}
    ${card(88, 42, 76, 106, 12, 'url(#vio)', '<path d="M126 72c10 0 17 8 17 17 0 13-17 27-17 27s-17-14-17-27c0-9 7-17 17-17Z" fill="#fff" opacity="0.9"/>')}
    ${chip(142, 150, 30)}`,

  // A dealt hand, fanned.
  videopoker: () => `
    ${card(34, 70, 62, 88, -26, 'url(#vio)', '<circle cx="65" cy="114" r="14" fill="#fff" opacity="0.85"/>')}
    ${card(70, 56, 62, 88, -8, 'url(#wht)', '<path d="M101 86l13 22H88l13-22Z" fill="url(#org)"/>')}
    ${card(102, 62, 62, 88, 10, 'url(#vio)', '<path d="M133 86c9 0 15 7 15 15 0 11-15 24-15 24s-15-13-15-24c0-8 6-15 15-15Z" fill="#fff" opacity="0.9"/>')}
    ${chip(62, 160, 26)}`,

  // Three cards down, the middle one lifted.
  three_card_monte: () => `
    <ellipse cx="100" cy="172" rx="40" ry="10" fill="#12042A" opacity="0.55"/>
    ${card(14, 96, 58, 84, -10, 'url(#vio)', cardBack(14, 96, 58, 84))}
    ${card(128, 96, 58, 84, 10, 'url(#vio)', cardBack(128, 96, 58, 84))}
    ${card(70, 30, 60, 86, -3, 'url(#wht)', '<path d="M100 58l15 23H85l15-23Zm0 50l-15-23h30l-15 23Z" fill="url(#org)"/>')}`,

  // The ladder up and the snake down.
  snake_and_ladders: () => `
    <g transform="rotate(-13 70 112)">
      <path d="M46 178V44M92 178V44" stroke="url(#org)" stroke-width="11" stroke-linecap="round"/>
      <path d="M46 64h46M46 94h46M46 124h46M46 154h46" stroke="url(#orgD)" stroke-width="9" stroke-linecap="round"/>
    </g>
    <path d="M104 178c46 2 60-24 40-44s-24-34 4-46" fill="none" stroke="url(#vioD)" stroke-width="26" stroke-linecap="round"/>
    <path d="M104 178c46 2 60-24 40-44s-24-34 4-46" fill="none" stroke="url(#vio)" stroke-width="19" stroke-linecap="round"/>
    <path d="M96 172c-10 2-18 6-24 12l22 2Z" fill="url(#vioD)"/>
    <g transform="rotate(-16 152 84)">
      <path d="M128 84c0-16 12-26 28-26s26 10 26 22c0 10-8 16-20 16h-34Z" fill="url(#vio)"/>
      <ellipse cx="146" cy="70" rx="11" ry="6" fill="#fff" opacity="0.4"/>
      <circle cx="164" cy="74" r="4.6" fill="#fff"/>
      <circle cx="165" cy="74" r="2" fill="#2E0B68"/>
      <path d="M182 90l16 6-16 4 8-5Z" fill="url(#org)"/>
    </g>`,
};

/**
 * One originals tile.
 *
 * `wide` draws the 732x564 featured crop; the default is the 420x564 portrait
 * the category grid lays out. Neither carries text — `GameCard` sets the title
 * over the tile, exactly as the reference does, so the five captured
 * thumbnails and the fifteen drawn ones caption identically.
 *
 * The framing follows the captured five: the subject sits in the upper two
 * thirds and the foot is left empty, which is what leaves room for the
 * caption. On the wide crop the subject centres, because the reference's own
 * wide art is a top-anchored crop of the same drawing.
 *
 * @param {string} uid The in-house game id, e.g. `classic_dice`.
 * @param {{wide?: boolean}} [options]
 */
export function originalArt(uid, { wide = false } = {}) {
  const title = ORIGINALS[uid] ?? uid;
  const draw = ORIGINAL_EMBLEMS[uid] ?? ORIGINAL_EMBLEMS.diamond;
  const W = wide ? 732 : 420;
  const H = 564;

  const scale = wide ? 2.9 : 2.16;
  const cy = wide ? H * 0.5 : H * 0.4;
  const ex = W / 2 - 100 * scale;
  const ey = cy - 104 * scale;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(title)}">
  <defs>${GROUND}${SUBJECT_DEFS}</defs>
  <rect width="${W}" height="${H}" fill="url(#og)"/>
  <rect width="${W}" height="${H}" fill="url(#oglow)"/>
  <rect width="${W}" height="${H}" fill="url(#obloom)"/>
  <g transform="translate(${ex.toFixed(1)} ${ey.toFixed(1)}) scale(${scale})">
    <ellipse cx="100" cy="104" rx="118" ry="96" fill="url(#ohalo)"/>
    ${ribbon({ rx: 122, ry: 78, from: 196, to: 300, w: 1.8 })}
    ${ribbon({ part: [0, 0.62], w: 5.6 })}
    ${draw()}
    ${ribbon({ part: [0.62, 1], w: 5.6 })}
    ${motes(uid)}
  </g>
</svg>
`;
}
