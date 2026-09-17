/**
 * Fetches the reference site's own Originals artwork into
 * apps/web/public/images/originals/.
 *
 * Five of the twenty in-house games here are also games the reference deals,
 * and its thumbnails for those are the real thing — so they are used rather
 * than drawn. `CAPTURED_ORIGINALS` in scripts/art.mjs says which, and where.
 * The sixth file it pulls is Baccarat, which this platform does not deal; it
 * is the extra sample the fifteen drawn tiles are colour-matched against.
 *
 * Re-runnable: it overwrites, and the CDN is deterministic for a given set of
 * parameters, so a second run produces the same bytes.
 *
 *   node scripts/fetch-originals.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CAPTURED_ORIGINALS } from './art.mjs';

const OUT = path.resolve(import.meta.dirname, '../apps/web/public/images/originals');
const CDN = 'https://heathmont.imgix.net/';

/**
 * The two boxes `GameCard` renders, and the imgix parameters that fill them.
 *
 * The sources are portrait — 490x624, or 720x924 for roulette — with the
 * subject in the upper two thirds and the foot left empty for the caption. So
 * the portrait crop is a centre crop that loses only a sliver off each side,
 * and the wide one has to be anchored to the top (`crop=top`) or the centre
 * crop of a portrait image cuts the subject in half.
 *
 * AVIF because that is what the CDN's `auto=format` serves a modern browser
 * anyway, and it lands these at 11-25 KB where PNG is 100-420 KB.
 */
const CROPS = [
  { suffix: '', query: 'w=420&h=564&fit=crop&fm=avif&q=72' },
  { suffix: '-wide', query: 'w=732&h=564&fit=crop&crop=top&fm=avif&q=72' },
];

/** Captured, but not one of the twenty — see `CAPTURED_ORIGINALS`. */
const EXTRA = { baccarat: 'casino-onetouch/baccarat.png' };

const SOURCES = { ...CAPTURED_ORIGINALS, ...EXTRA };

// A browser UA: the CDN itself is open, but the parameters are the ones the
// reference's own page requests, so this asks for exactly what it serves.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

await mkdir(OUT, { recursive: true });

let total = 0;
for (const [uid, source] of Object.entries(SOURCES)) {
  for (const { suffix, query } of CROPS) {
    const url = `${CDN}${source}?${query}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${uid}${suffix}: ${res.status} for ${source}`);

    const buf = Buffer.from(await res.arrayBuffer());
    // A 403 body is HTML with a 200 in front of it on some imgix errors, and
    // an empty file renders as a broken-image glyph rather than failing here.
    if (buf.length < 1024) throw new Error(`${uid}${suffix}: ${buf.length} bytes, not an image`);

    const name = `${uid}${suffix}.avif`;
    await writeFile(path.join(OUT, name), buf);
    console.log(`  ${name.padEnd(26)} ${String(buf.length).padStart(7)} bytes`);
    total += 1;
  }
}

console.log(`\nWrote ${total} files to apps/web/public/images/originals`);
