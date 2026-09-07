/**
 * Generates every placeholder image the UI references.
 *
 * All output is original, deterministic vector art produced from a hash of
 * each item's slug — nothing here is derived from the reference site's
 * artwork, which is licensed to its operator and its game studios. Replace
 * these files with your own art (or a real CDN) when you have it.
 *
 * The drawings themselves live in ./art.mjs; this file is the pipeline that
 * reads the catalog, writes the files, and encodes the PNG app icons.
 *
 * Run: npm run assets:gen
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';
import {
  FAVICON,
  HERO_ART,
  SIDEBAR_PROMO,
  gameThumb,
  promoArt,
  providerLogo,
  themeArt,
} from './art.mjs';

const PUBLIC = path.resolve(import.meta.dirname, '../apps/web/public');

/* ------------------------------------------------- minimal PNG encoder --- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode an RGBA pixel buffer as a PNG. */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10-12: compression, filter, interlace — all 0.

  // Each scanline is prefixed with filter type 0 (None).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = y * (width * 4 + 1);
    raw[dst] = 0;
    rgba.copy(raw, dst + 1, src, src + width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle, used for antialiased edges. */
function roundedRectSdf(px, py, halfW, halfH, radius) {
  const qx = Math.abs(px) - halfW + radius;
  const qy = Math.abs(py) - halfH + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Brand tile: orange rounded square with a white disc, matching favicon.svg. */
function appIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const half = size / 2;
  const radius = size * 0.2857; // 8/28, same ratio as the SVG mark
  const brand = [0xf2, 0x59, 0x0d];
  const dot = [0xff, 0xb3, 0x19];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - half;
      const py = y + 0.5 - half;
      const i = (y * size + x) * 4;

      // Background coverage, antialiased over one pixel.
      const cov = Math.min(Math.max(0.5 - roundedRectSdf(px, py, half, half, radius), 0), 1);

      // White disc slightly left of centre, accent dot upper right.
      const dWhite = Math.hypot(px + size * 0.04, py) - size * 0.26;
      const covWhite = Math.min(Math.max(0.5 - dWhite, 0), 1);
      const dDot = Math.hypot(px - size * 0.2, py + size * 0.18) - size * 0.08;
      const covDot = Math.min(Math.max(0.5 - dDot, 0), 1);

      let r = brand[0], g = brand[1], b = brand[2];
      r = r * (1 - covWhite) + 255 * covWhite;
      g = g * (1 - covWhite) + 255 * covWhite;
      b = b * (1 - covWhite) + 255 * covWhite;
      r = r * (1 - covDot) + dot[0] * covDot;
      g = g * (1 - covDot) + dot[1] * covDot;
      b = b * (1 - covDot) + dot[2] * covDot;

      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = Math.round(cov * 255);
    }
  }
  return encodePng(size, size, rgba);
}

/* -------------------------------------------------------------- manifest */

const MANIFEST = {
  name: 'YourBrand Casino UI',
  short_name: 'YourBrand',
  description: 'A React and Tailwind study of modern casino UI patterns.',
  start_url: '/',
  display: 'standalone',
  background_color: '#FFFFFF',
  theme_color: '#F2590D',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
  ],
};
/* ------------------------------------------------------------------- run */

// The catalog is the single source of truth for what needs generating — it is
// plain ESM, so Node can import it directly and no list is duplicated here.
const catalogUrl = new URL('../apps/web/src/data/catalog.js', import.meta.url);
let catalog;
try {
  catalog = await import(catalogUrl.href);
} catch (err) {
  console.error(
    'Could not load the catalog module. Underlying error:\n',
    err.message,
  );
  process.exit(1);
}
const { GAMES, PROVIDERS, PROMOTIONS, THEMES } = catalog;

for (const dir of ['images/games', 'images/providers', 'images/promos', 'images/themes', 'icons']) {
  await mkdir(path.join(PUBLIC, dir), { recursive: true });
}

let count = 0;

// Every game gets both aspect ratios: rails render the portrait tile, and the
// featured rail renders the wide one. Generating both keeps any rail able to
// switch presentation without a regeneration step.
for (const game of GAMES) {
  const dir = path.join(PUBLIC, 'images/games');
  await writeFile(
    path.join(dir, `${game.slug}.svg`),
    gameThumb(game.title, game.slug, game.category, game.provider),
  );
  await writeFile(
    path.join(dir, `${game.slug}-wide.svg`),
    gameThumb(game.title, game.slug, game.category, game.provider, { wide: true }),
  );
  count += 2;
}

for (const provider of PROVIDERS) {
  await writeFile(path.join(PUBLIC, 'images/providers', `${provider.slug}.svg`), providerLogo(provider.name, provider.slug));
  count++;
}

for (const theme of THEMES) {
  const slug = theme.art.split('/').pop().replace('.svg', '');
  await writeFile(path.join(PUBLIC, 'images/themes', `${slug}.svg`), themeArt(theme.label, slug));
  count++;
}

for (const promo of PROMOTIONS) {
  const slug = promo.art.split('/').pop().replace('.svg', '');
  await writeFile(path.join(PUBLIC, 'images/promos', `${slug}.svg`), promoArt(promo.title, slug));
  count++;
}

await writeFile(path.join(PUBLIC, 'images/hero.svg'), HERO_ART);
await writeFile(path.join(PUBLIC, 'images/sidebar-promo.svg'), SIDEBAR_PROMO);
count += 2;

await writeFile(path.join(PUBLIC, 'favicon.svg'), FAVICON);
await writeFile(path.join(PUBLIC, 'manifest.webmanifest'), JSON.stringify(MANIFEST, null, 2) + '\n');

for (const [name, size] of [['apple-touch-icon', 180], ['icon-192', 192], ['icon-512', 512]]) {
  await writeFile(path.join(PUBLIC, 'icons', `${name}.png`), appIcon(size));
  count++;
}

console.log(`Generated ${count} asset files under apps/web/public`);
