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
 * the default is the 0.745:1 portrait every other rail uses. Both bake the
 * title into the art, as the reference thumbnails do, so a tile needs no
 * caption underneath and rows stay a uniform height.
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

  // Long titles wrap onto a second line first, then shrink — in that order, so
  // a two-word name never ends up set at half the size of its neighbours.
  const words = title.split(' ');
  const split = Math.ceil(words.length / 2);
  const lines =
    title.length > 10 && words.length > 1
      ? [words.slice(0, split).join(' '), words.slice(split).join(' ')]
      : [title];

  // Space Grotesk bold caps run about 0.66em per character at this tracking;
  // that is close enough to keep the longest line inside the tile's margins.
  const longest = Math.max(...lines.map((l) => l.length));
  const fontSize = Math.min(wide ? 64 : 52, Math.floor((W - 48) / (longest * 0.66)));
  const baseY = H - 96 - (lines.length - 1) * fontSize * 0.92;

  const titleSvg = lines
    .map(
      (line, i) =>
        `<text x="${W / 2}" y="${baseY + i * fontSize * 0.92}" text-anchor="middle" font-family="'Space Grotesk',system-ui,sans-serif" font-size="${fontSize}" font-weight="700" letter-spacing="1" fill="#fff">${escapeXml(line.toUpperCase())}</text>`,
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeXml(title)}">
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
    <linearGradient id="foot" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.foot}" stop-opacity="0"/>
      <stop offset="0.55" stop-color="${p.foot}" stop-opacity="0.85"/>
      <stop offset="1" stop-color="${p.foot}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  ${sparkles(slug, W, H)}
  <g transform="translate(${ex.toFixed(1)} ${ey.toFixed(1)}) scale(${scale})">${emblem}</g>
  <rect y="${H * 0.5}" width="${W}" height="${H * 0.5}" fill="url(#foot)"/>
  ${titleSvg}
  <text x="${W / 2}" y="${H - 52}" text-anchor="middle" font-family="'DM Sans',system-ui,sans-serif" font-size="24" font-weight="500" fill="#fff" opacity="0.62">${escapeXml(provider)}</text>
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

export function promoArt(title, slug) {
  const p = palette(slug);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 320" width="640" height="320" role="img" aria-label="${escapeXml(title)}">
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
