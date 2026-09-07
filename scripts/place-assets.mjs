/**
 * Copies the captured reference assets out of `asset/` (the raw scrape,
 * mirrored per origin host) into `apps/web/public/`, flattened into the layout
 * the app actually serves from.
 *
 * Re-runnable: it overwrites, never deletes, and prints a summary. The
 * generated manifest (apps/web/src/data/assets.generated.js) is what the
 * catalog and components import, so nothing hard-codes a scrape path.
 *
 *   node scripts/place-assets.mjs
 */
import { copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'asset');
const PUB = join(ROOT, 'apps', 'web', 'public');

const HM = join(SRC, 'heathmont.imgix.net');
const HUB = join(SRC, 'hub88.imgix.net');
const CG = join(SRC, 'cdn.coingaming.io');

let copied = 0;
const missing = [];

const slugify = (value) =>
  value
    .replace(/[+_]/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

/** Copy one file, creating the destination directory. Returns the public URL. */
function place(from, toRel) {
  try {
    statSync(from);
  } catch {
    missing.push(relative(ROOT, from));
    return null;
  }
  const to = join(PUB, toRel);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied += 1;
  return '/' + toRel.split(/[\\/]/).join('/');
}

/** Copy every file in `dir` into `toDir`, slugifying the basename. */
function placeDir(dir, toDir, rename = slugify) {
  const out = {};
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    missing.push(relative(ROOT, dir) + '/');
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    const key = rename(basename(entry.name, ext));
    const url = place(join(dir, entry.name), join(toDir, key + ext));
    if (url) out[key] = url;
  }
  return out;
}

// --- brand ----------------------------------------------------------------
const brand = {
  logoFull: place(join(HM, 'cms/media/bitcasino_logo_full.svg'), 'images/brand/logo-full.svg'),
  logoIcon: place(join(HM, 'cms/media/bitcasino_logo_icon.svg'), 'images/brand/logo-icon.svg'),
  sideMenu: place(join(HM, 'cms/media/bc-sidemenu-lob-1.png'), 'images/brand/side-menu.png'),
  favicon32: place(join(HM, 'bitcasino/favicon/bc-32x32.png'), 'icons/favicon-32.png'),
  notFound: place(join(HM, 'bitcasino/images/404-girl.svg'), 'images/brand/404.svg'),
};

// --- navigation / category icons ------------------------------------------
// cms/icons carries the lobby nav artwork; strip the `icon_` prefix and the
// `_png` suffix the CMS bakes into those filenames.
const navIcons = placeDir(join(HM, 'cms/icons'), 'images/categories', (name) =>
  slugify(name.replace(/^icon[-_]?/i, '').replace(/[-_]?png$/i, '')),
);
Object.assign(navIcons, placeDir(join(HM, 'luxury/icons'), 'images/categories'));

// --- providers -------------------------------------------------------------
const providers = placeDir(join(HM, 'bitcasino/images/providers/new-icons'), 'images/providers');

// --- footer: payment rails, socials, awards --------------------------------
const FOOTER = join(HM, 'bitcasino/images/icons/footer/footer');
const CRYPTO = ['btc', 'eth', 'ltc', 'xrp', 'trx', 'usdc', 'tether', 'matic', 'doge', 'bnb'];
const SOCIAL = ['telegram-new', 'youtube', 'tiktok', 'bitcointalk'];
const AWARDS = ['crm-award-2020', 'egr-award-2021', 'sm-award-2020'];
const RENAME = { 'telegram-new': 'telegram', tether: 'usdt' };

const footer = { crypto: {}, social: {}, awards: {} };
for (const entry of readdirSync(FOOTER, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const ext = extname(entry.name).toLowerCase();
  const key = slugify(basename(entry.name, ext));
  const bucket = CRYPTO.includes(key)
    ? 'crypto'
    : SOCIAL.includes(key)
      ? 'social'
      : AWARDS.includes(key)
        ? 'awards'
        : null;
  if (!bucket) continue;
  const name = RENAME[key] ?? key;
  const url = place(join(FOOTER, entry.name), `images/footer/${bucket}/${name}${ext}`);
  if (url) footer[bucket][name] = url;
}
// A few payment/award icons live outside that folder on the CDN.
footer.crypto.ada = place(join(HM, 'bitcasino/images/icons/cardano.svg'), 'images/footer/crypto/ada.svg');
footer.crypto.ton = place(join(HM, 'bitcasino/images/icons/ton.png'), 'images/footer/crypto/ton.png');
footer.awards['innovation-2022'] = place(
  join(HM, 'bitcasino/images/footer/bc-innovation-casino-2022.png'),
  'images/footer/awards/innovation-2022.png',
);
footer.awards['crypto-operator-2023'] = place(
  join(HM, 'bitcasino/images/promotions/2023/crypto-operator-bc-2023.png'),
  'images/footer/awards/crypto-operator-2023.png',
);

// --- misc UI art -----------------------------------------------------------
const ui = {
  playTriangle: place(join(HM, 'bitcasino/images/icons/play-triangle.svg'), 'images/ui/play-triangle.svg'),
  quotes: place(join(CG, 'bitcasino/images/icons/quotes.svg'), 'images/ui/quotes.svg'),
  crown: place(join(HM, 'cms/icons/crown.png'), 'images/ui/crown.png'),
  flagEn: place(join(HM, 'cms/icons/en.svg'), 'images/ui/flag-en.svg'),
  heroBanner: place(join(HM, 'bitcasino/images/promotions/2024/main-page.png'), 'images/hero/main-banner.png'),
};

// --- in-house "originals" tiles -------------------------------------------
const originals = placeDir(join(HM, '2026'), 'images/originals');

// --- game thumbnails -------------------------------------------------------
// The scrape mirrors the same artwork under several studio folders and under
// both the space- and plus-encoded variants of one path. Flatten to a single
// slug per image; first writer wins, so the roots are ordered best-first.
const THUMB_ROOTS = [
  HUB,
  join(HM, '8.io new thumbs vol2'),
  join(HM, '8.io+new+thumbs+vol2'),
  join(HM, '8io new thumbs'),
  join(HM, '8io+new+thumbs'),
  join(HM, 'newthumbnails'),
  join(HM, 'thumbnails'),
  join(HM, 'casino-evolution'),
  join(HM, 'casino-hub88'),
  join(HM, 'casino-onetouch'),
  join(HM, 'casino-playngo'),
  join(HM, 'casino-pragmatic'),
];

// The same title reaches us spelled several ways: hub88 runs the words
// together (`hsg_fistofdestruction`), the CMS uses CamelCase and often appends
// the studio (`FistofDestruction`, `AviatorSpribe`). Strip the studio, then
// compare on letters alone so every spelling collapses to one entry.
const STUDIO_SUFFIXES = [
  ...Object.keys(providers),
  'avatar-ux',
  'hacksaw',
  'one-touch',
  'pragmatic',
  'evolution',
  'netent',
  'spribe',
];

/** `hsg_fistofdestruction.jpg`, `FistofDestruction.png` -> `fistof-destruction`. */
function thumbKey(file) {
  let s = basename(file, extname(file));
  // hub88 studio prefix is always lowercase, so this cannot eat `SicBo_`.
  s = s.replace(/^[a-z]{2,5}_(?=[a-z0-9])/, '');
  // Split camelCase, but not `40K` — a digit run and its trailing capital are
  // one token (`Emberfall40KSlotmill` -> `Emberfall40K-Slotmill`).
  s = s.replace(/([a-z])([A-Z])/g, '$1-$2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2');
  s = s
    .replace(/[+_\s]+/g, '-')
    .toLowerCase()
    .replace(/-[0-9a-f]{12,}$/, '') // cache-busting hash
    .replace(/^\d+-\d*x?\d*-/, '') // `01-2x3-` sequence prefix
    .replace(/-?\d{2,4}x\d{2,4}(?=-|$)/g, '') // `490x368` render size
    .replace(/-\d-\d(?=-|$)/g, '') // `_3_4` aspect ratio, never digits inside a title
    .replace(/-?(thumbnails?|thumbs?\d*|no-logo|v\d)(?=-|$)/g, '');
  for (const studio of STUDIO_SUFFIXES) {
    if (s.endsWith(`-${studio}`)) {
      s = s.slice(0, -studio.length - 1);
      break;
    }
  }
  return s.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

// Collect every candidate first, then keep one file per title. Among spellings
// prefer the one with the most word breaks — it makes the readable slug.
const candidates = new Map();
const walk = (dir) => {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    missing.push(relative(ROOT, dir) + '/');
    return;
  }
  for (const entry of entries) {
    const from = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(from);
      continue;
    }
    if (!/\.(png|jpe?g|webp|avif)$/i.test(entry.name)) continue;
    const key = thumbKey(entry.name);
    if (!key) continue;
    const canonical = key.replace(/-/g, '');
    const words = key.split('-').length;
    const best = candidates.get(canonical);
    if (!best || words > best.words) candidates.set(canonical, { key, words, from });
  }
};
for (const root of THUMB_ROOTS) walk(root);

const games = {};
for (const { key, from } of [...candidates.values()].sort((a, b) => a.key.localeCompare(b.key))) {
  const url = place(from, `images/games/${key}${extname(from).toLowerCase()}`);
  if (url) games[key] = url;
}

// --- manifest --------------------------------------------------------------
const manifest = { brand, navIcons, providers, footer, ui, originals, games };
writeFileSync(
  join(ROOT, 'apps/web/src/data/assets.generated.js'),
  `/**
 * GENERATED by scripts/place-assets.mjs — do not edit by hand.
 * Maps every asset copied out of asset/ to the URL it is served from.
 */

export const ASSETS = ${JSON.stringify(manifest, null, 2)};
`,
);

console.log(`placed ${copied} files into apps/web/public`);
for (const [group, value] of Object.entries(manifest)) {
  const n =
    group === 'footer'
      ? Object.values(value).reduce((a, b) => a + Object.keys(b).length, 0)
      : Object.keys(value).length;
  console.log(`  ${group.padEnd(10)} ${n}`);
}
if (missing.length) console.log(`\nmissing from asset/ (${missing.length}):\n  ${missing.join('\n  ')}`);
