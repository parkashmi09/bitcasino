'use strict';

/**
 * A branded 3:4 tile for a game no reference lobby has art for (`fix-game-artwork.js --brand`).
 *
 * The site's own tokens (frontend/src/index.css): layer greys #1E2121 / #232626 / #323738,
 * brand green #24EE89 (button #2CD97D, alt #9FE871). No wordmark: the site name is set at
 * runtime by the owner, so the card carries the game instead: a "CATEGORY" label, the game's
 * name, the provider and a PLAY chip. Each game gets its own stripe angle and glow position
 * from its name, so a row of them does not read as one image repeated.
 *
 * SVG rasterised with the frontend's sharp (the backend ships no image library). Text is
 * sharp/pango text in a system sans (the site's Averta is woff2, which pango cannot load).
 */

const path = require('node:path');

const FRONTEND = path.join(__dirname, '..', '..', '..', 'frontend');

const W = 600;
const H = 800;
const C = { bg: '#1E2121', s1: '#232626', s2: '#323738', text: '#FFFFFF', muted: '#B3BEC1', brand: '#24EE89', brandHi: '#9FE871', brandLo: '#2CD97D' };
const SANS = process.platform === 'darwin' ? 'Helvetica' : 'Sans';

let sharp = null;
function loadSharp() {
  if (sharp) return sharp;
  try {
    sharp = require(require.resolve('sharp', { paths: [FRONTEND] }));
  } catch {
    throw new Error('Branded art needs sharp from the frontend: run `npm install` in frontend/ first');
  }
  return sharp;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function seed(s) {
  let h = 2166136261;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** The name in at most four lines, and the font size that fits them in the card. */
function layoutName(name) {
  const words = String(name).toUpperCase().split(/\s+/).filter(Boolean);
  for (const size of [72, 62, 54, 48, 42, 36, 31]) {
    const perLine = Math.floor(480 / (size * 0.64));
    const lines = [];
    for (const w of words) {
      const last = lines[lines.length - 1];
      if (last && `${last} ${w}`.length <= perLine) lines[lines.length - 1] = `${last} ${w}`;
      else lines.push(w);
    }
    if (lines.length <= 4 && lines.every((l) => l.length <= perLine)) return { lines, size };
  }
  return { lines: [String(name).toUpperCase().slice(0, 40)], size: 28 };
}

const PROVIDER_NAMES = {
  pragmaticplaylive: 'Pragmatic Play Live',
  'evolution gaming': 'Evolution',
  platipus2: 'Platipus',
  pgsoft: 'PG Soft',
  'sevenmojos slots': '7Mojos',
  vivogaming: 'Vivo Gaming',
  xprogaming: 'XPro Gaming',
  iconic21: 'ICONIC21',
};

const CATEGORY_LABEL = { slots: 'SLOTS', live: 'LIVE CASINO', table: 'TABLE GAME', instant: 'INSTANT', other: 'CASINO' };

/** The card without its words. Exported for tests; `brandedArt` adds the text layers. */
function brandedSvg({ name, provider }) {
  const r = seed(`${provider}/${name}`);
  const angle = 20 + (r % 50);
  const gx = 20 + (r % 60);
  const gy = 25 + ((r >> 8) % 40);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="glow" cx="${gx}%" cy="${gy}%" r="75%">
      <stop offset="0" stop-color="${C.brand}" stop-opacity="0.24"/>
      <stop offset="0.5" stop-color="${C.brandLo}" stop-opacity="0.06"/>
      <stop offset="1" stop-color="${C.bg}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="green" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.brandHi}"/><stop offset="1" stop-color="${C.brand}"/>
    </linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bg}" stop-opacity="0"/><stop offset="1" stop-color="${C.bg}" stop-opacity="0.95"/>
    </linearGradient>
    <pattern id="stripes" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})">
      <rect width="24" height="24" fill="none"/><rect width="2" height="24" fill="${C.text}" opacity="0.035"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" rx="28" fill="${C.s1}"/>
  <rect width="${W}" height="${H}" rx="28" fill="url(#stripes)"/>
  <rect width="${W}" height="${H}" rx="28" fill="url(#glow)"/>
  <rect y="${H - 280}" width="${W}" height="280" fill="url(#fade)"/>
  <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="26" fill="none" stroke="${C.s2}" stroke-width="4"/>
  <rect x="${W / 2 - 50}" y="196" width="100" height="4" rx="2" fill="${C.brand}"/>
  <rect x="${W / 2 - 100}" y="${H - 92}" width="200" height="52" rx="26" fill="url(#green)"/>
</svg>`;
}

async function textLayer(markup, font) {
  const input = await loadSharp()({ text: { text: markup, font, rgba: true, align: 'centre', dpi: 72 } }).png().toBuffer();
  const { width, height } = await loadSharp()(input).metadata();
  return { input, width, height };
}

const span = (text, color, spacing = 0) =>
  `<span foreground="${color}"${spacing ? ` letter_spacing="${spacing * 1024}"` : ''}>${esc(text)}</span>`;

/** `{ bytes, size }` like a downloaded image: a 600x800 PNG. */
async function brandedArt({ name, provider, category }) {
  const { lines, size } = layoutName(name);
  const prov = PROVIDER_NAMES[String(provider).toLowerCase()] || String(provider);
  const [mark, label, title, by, play] = await Promise.all([
    textLayer(span(String(name).trim()[0]?.toUpperCase() || '?', `${C.text}0a`), `${SANS} Bold 440`),
    textLayer(span(CATEGORY_LABEL[category] || 'CASINO', C.brand, 6), `${SANS} Bold 22`),
    textLayer(span(lines.join('\n'), C.text), `${SANS} Bold ${size}`),
    textLayer(span(prov.toUpperCase(), C.muted, 3), `${SANS} Bold 22`),
    textLayer(span('PLAY', '#000000', 4), `${SANS} Bold 22`),
  ]);
  const centre = (layer, top) => ({ input: layer.input, top: Math.max(0, Math.round(top)), left: Math.max(0, Math.round((W - layer.width) / 2)) });
  const titleTop = 420 - title.height / 2;
  const bytes = await loadSharp()(Buffer.from(brandedSvg({ name, provider })))
    .composite([
      centre(mark, H * 0.55 - mark.height / 2),
      centre(label, 150 - label.height / 2),
      centre(title, titleTop),
      centre(by, H - 128 - by.height),
      centre(play, H - 66 - play.height / 2),
    ])
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toBuffer();
  return { bytes, size: { type: 'png', width: W, height: H } };
}

module.exports = { brandedArt, brandedSvg, layoutName };
