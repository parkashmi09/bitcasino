/**
 * Fetches the twenty Salon Prive tile images behind `/themes/vip-prive` into
 * apps/web/public/images/games/.
 *
 * Same argument as the seven under `/themes/live-exclusives` (see
 * `LIVE_EXCLUSIVES` in apps/web/src/data/catalog.js): a theme page is a list
 * of specific named tables, and a placeholder standing in for one is not the
 * same page. So these twenty carry the reference's real titles and its real
 * artwork. `docs/07-assets.md` records the provenance.
 *
 * Re-runnable: it overwrites, and the CDN is deterministic for a given set of
 * parameters, so a second run produces the same bytes.
 *
 *   node scripts/fetch-vip-prive.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { VIP_PRIVE_ART } from '../apps/web/src/data/vipPriveArt.mjs';

const OUT = path.resolve(import.meta.dirname, '../apps/web/public/images/games');
const CDN = 'https://heathmont.imgix.net/';

/**
 * 420x564 is this app's portrait tile; the reference asks its own CDN for
 * 152x212 at dpr 1.5, which is the same crop two thirds of the size.
 *
 * `crop=faces` is the reference's own parameter and it matters here in a way
 * it did not for the originals: every one of these twenty is a photograph of a
 * dealer, and a centre crop of a 16:9 studio shot puts the table in frame and
 * the dealer's head out of it.
 *
 * AVIF for the same reason as everywhere else — it is what `auto=format`
 * serves a modern browser anyway, and it lands these at ~25 KB against
 * ~200 KB for the PNG.
 */
const QUERY = 'w=420&h=564&fit=crop&crop=faces&fm=avif&q=72';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

await mkdir(OUT, { recursive: true });

let total = 0;
let bytes = 0;
for (const [slug, source] of Object.entries(VIP_PRIVE_ART)) {
  // The paths carry spaces and one carries a trailing space in a directory
  // name (`Prive game tiles - Evo /`). `encodeURI` leaves the separators alone
  // and escapes the rest, which is exactly what imgix wants.
  const url = `${CDN}${encodeURI(source)}?${QUERY}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${slug}: ${res.status} for ${source}`);

  const buf = Buffer.from(await res.arrayBuffer());
  // imgix answers some errors with a 200 and an HTML body; an empty or tiny
  // file renders as a broken-image glyph rather than failing here.
  if (buf.length < 2048) throw new Error(`${slug}: ${buf.length} bytes, not an image`);

  await writeFile(path.join(OUT, `${slug}.avif`), buf);
  console.log(`  ${`${slug}.avif`.padEnd(34)} ${String(buf.length).padStart(7)} bytes`);
  total += 1;
  bytes += buf.length;
}

console.log(`\nWrote ${total} files (${Math.round(bytes / 1024)} KB) to ${path.relative(process.cwd(), OUT)}`);
