#!/usr/bin/env node
'use strict';

/**
 * Find lobby games (`gisgamesnew`) whose tile art is the wrong shape, missing, broken or on
 * plain http, look the same game up in our own JSGames catalogue first, then on a reference lobby (hash.game, shuffle, powbet,
 * bitcasino, off by default) and, with --apply, point `gisgamesnew.image` at that lobby's art.
 *
 *   node scripts/fix-game-artwork.js                        dry run: measure, match, download, report.csv
 *   node scripts/fix-game-artwork.js --apply                ... and set gisgamesnew.image = the reference URL
 *   node scripts/fix-game-artwork.js --revert [--uuid=..]   put back every image this replaced
 *
 * Which rows:
 *   (always)          art that loads but is the wrong shape for the 3:4 tile
 *   --with-empty      no image at all, or the import's placeholder (/imagesv2/gamecard/earth-globe.png)
 *   --with-broken     the image does not load from here (HTTP error, timeout, not an image)
 *   --with-http       the image is on plain http:// (the bare-IP 82.180.146.91:12001 host is
 *                     mixed content on an https site), even when it loads
 *
 * Narrowing / options:
 *   --provider="Hacksaw Gaming"[,PGSoft]   only these providers (case-insensitive)
 *   --aggregator=slotegrator               only this aggregator
 *   --uuid=<uuid>[,<uuid>]                 only these games
 *   --limit=50                             stop after this many to fix
 *   --brand                                a game no source has, and whose current image is missing,
 *                                          broken or the wrong shape, gets a branded 3:4 tile
 *                                          (lib/branded-art.js), self-hosted in game_artwork and served at
 *                                          /api/v1/casino/games/image/<uuid>.png. A working portrait image is kept.
 *   --import=<file>                        also match a catalogue the user exported from their own browser:
 *                                          JSON [{ name, provider, category, image }] (see the skill)
 *   --with-bitcasino                       also try bitcasino (plain fetch, off by default). Cloudflare
 *                                          blocks scripted requests, so today every row gets the miss
 *                                          "bitcasino blocks scripted access (Cloudflare)"
 *   --out=<dir>                            downloads + report.csv (default ~/Downloads/game-artwork)
 *   --no-download                          skip saving image files (report.csv is still written)
 *   --concurrency=4
 *
 * A reference game is used only when provider, name and live-or-not all match the row
 * (`lib/artwork-sources.js`). `--apply` records the old value in `game_artwork`
 * (migration 098) first, so `--revert` can restore it.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('pg');

const { imageSize } = require('./lib/image-size');
const { UA, SOURCES, setOwnCatalogue, fromBitcasino, importSource, categoryOf } = require('./lib/artwork-sources');
const { brandedArt } = require('./lib/branded-art');
const migration = require('../packages/db/migrations/098-game-artwork-store');

/**
 * width / height the 3:4 tile (`components/shared/GameTile`, `aspect-[3/4]`, object-cover;
 * grids at `--aspect-ratio: .75`) shows without a bad crop: 3:4 (0.75), 2:3 (0.667),
 * 5:7 (0.714), 427x575 (0.743), up to 0.86.
 */
const PORTRAIT = { min: 0.62, max: 0.86 };
/** Placeholder art the catalogue import filled empty rows with: treated as empty. */
const PLACEHOLDER = /^\/imagesv2\/gamecard\/|earth-globe\.png$/i;
/** Lobby launchers and sportsbooks are not catalogue games. */
const SKIP_PROVIDERS = ['lobby', 'esports', 'sports', 'smartbet'];

function parseArgs(argv) {
  const flag = (name) => argv.includes(`--${name}`);
  const value = (name) => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const list = (name) =>
    (value(name) || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    apply: flag('apply'),
    revert: flag('revert'),
    withEmpty: flag('with-empty'),
    withBroken: flag('with-broken'),
    withHttp: flag('with-http'),
    download: !flag('no-download'),
    providers: list('provider').map((p) => p.toLowerCase()),
    aggregator: value('aggregator'),
    uuids: list('uuid'),
    limit: Number(value('limit')) || Infinity,
    out: path.resolve((value('out') || path.join(os.homedir(), 'Downloads', 'game-artwork')).replace(/^~(?=$|\/)/, os.homedir())),
    concurrency: Math.max(1, Number(value('concurrency')) || 4),
    bitcasino: flag('with-bitcasino'),
    brand: flag('brand'),
    import: value('import'),
  };
}

/** GET an image the way an `<img>` asks for it. `{ bytes, size, type }` or `{ error }`. */
async function fetchImage(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(25_000),
        headers: {
          'user-agent': UA,
          // No AVIF: imgxcut answers AVIF to a browser Accept, which imageSize cannot read.
          accept: 'image/png,image/jpeg;q=0.9,image/webp;q=0.8,image/*;q=0.5',
          'sec-fetch-dest': 'image',
          'sec-fetch-mode': 'no-cors',
          'sec-fetch-site': 'cross-site',
        },
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        return { error: `HTTP ${res.status}` };
      }
      const type = res.headers.get('content-type') || '';
      const bytes = Buffer.from(await res.arrayBuffer());
      const size = imageSize(bytes);
      if (!size) return { error: `not an image (${type || 'no type'})` };
      return { bytes, size, type };
    } catch (err) {
      if (attempt) return { error: err.name === 'TimeoutError' ? 'timeout' : err.message };
    }
  }
  return { error: 'rate limited' };
}

const ratioOf = (s) => s.width / s.height;
const portrait = (s) => ratioOf(s) >= PORTRAIT.min && ratioOf(s) <= PORTRAIT.max;
const shapeOf = (s) =>
  ratioOf(s) > 1.05 ? 'landscape' : ratioOf(s) >= 0.95 ? 'square' : ratioOf(s) < PORTRAIT.min ? 'too tall' : 'nearly square';

async function pool(items, size, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    })
  );
}

const safeFile = (s) => String(s).replace(/[/\\:*?"<>|\u0000-\u001f]+/g, '-').trim().slice(0, 120) || 'game';
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function connect() {
  const envFile = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const client = new Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: /^(1|true|require)$/i.test(process.env.DB_SSL || '') ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  const schema = process.env.DB_SCHEMA || 'public';
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) throw new Error(`Unexpected DB_SCHEMA "${schema}"`);
  await client.query(`SET search_path TO ${schema}`);
  return client;
}

async function revert(db, opts) {
  const params = [];
  let where = '';
  if (opts.uuids.length) {
    params.push(opts.uuids);
    where = 'AND a.game_uuid = ANY($1)';
  }
  // Only where the row still shows what this script set: an admin's later change is left alone.
  const restored = await db.query(
    `UPDATE gisgamesnew g SET image = a.previous_image
       FROM game_artwork a
      WHERE g.uuid = a.game_uuid AND g.image IS NOT DISTINCT FROM a.image ${where}
      RETURNING g.uuid`,
    params
  );
  const removed = await db.query(`DELETE FROM game_artwork a WHERE TRUE ${where}`, params);
  console.log(`reverted ${restored.rowCount} game(s), removed ${removed.rowCount} game_artwork row(s)`);
}

/**
 * The JSGames catalogue already in this DB (source `own`): curated lobby / parked rows first,
 * then `js_games`. A table this DB does not have is skipped.
 */
async function ownCatalogue(db) {
  const parts = [];
  for (const t of ['gisgamesnew', 'gisgamesnew_parked']) {
    const { rows } = await db.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'aggregator'`,
      [t]
    );
    if (rows.length) parts.push(`SELECT name, provider, type, image FROM ${t} WHERE aggregator = 'js_games'`);
  }
  if ((await db.query(`SELECT to_regclass('js_games') AS t`)).rows[0].t) {
    parts.push(`SELECT game_name, vendor, game_type, game_icon FROM js_games WHERE is_active IS NOT FALSE`);
  }
  return parts.length ? (await db.query(parts.join(' UNION ALL '))).rows : [];
}

/** What the current image is: empty / broken / wrong shape / http / ok. */
async function measure(row) {
  const image = String(row.image || '').trim();
  if (!image || PLACEHOLDER.test(image)) return { status: 'empty', old: image ? 'placeholder' : '' };
  if (!/^https?:\/\//i.test(image)) return { status: 'self-hosted', old: '' };
  const got = await fetchImage(image);
  if (got.error) return { status: 'broken', old: got.error };
  const old = `${got.size.width}x${got.size.height}`;
  if (!portrait(got.size)) return { status: `wrong shape (${shapeOf(got.size)})`, old };
  if (/^http:\/\//i.test(image)) return { status: 'http', old };
  return { status: 'ok', old };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const db = await connect();
  try {
    if (opts.apply || opts.revert) await migration.up({ sequelize: { query: (sql) => db.query(sql) } });
    if (opts.revert) return await revert(db, opts);

    const params = [SKIP_PROVIDERS];
    let sql = `SELECT uuid, name, provider, type, image FROM gisgamesnew
                WHERE lower(coalesce(provider, '')) <> ALL($1) AND lower(coalesce(type, '')) <> 'lobby'`;
    if (opts.providers.length) {
      params.push(opts.providers);
      sql += ` AND lower(provider) = ANY($${params.length})`;
    }
    if (opts.aggregator) {
      params.push(opts.aggregator);
      sql += ` AND aggregator = $${params.length}`;
    }
    if (opts.uuids.length) {
      params.push(opts.uuids);
      sql += ` AND uuid = ANY($${params.length})`;
    }
    const { rows } = await db.query(`${sql} ORDER BY provider, name`, params);
    console.log(`checking ${rows.length} game(s)...`);

    // 1. What is each game's art now?
    const results = [];
    let measured = 0;
    await pool(rows, opts.concurrency * 3, async (row) => {
      results.push({ ...row, category: categoryOf(row.type), ...(await measure(row)) });
      if (++measured % 200 === 0) console.log(`  measured ${measured}/${rows.length}`);
    });

    console.log(`own catalogue: ${setOwnCatalogue(await ownCatalogue(db))} JSGames name(s) with https art`);
    const imported = opts.import ? importSource(JSON.parse(fs.readFileSync(opts.import, 'utf8'))) : null;
    const sources = [...SOURCES, ...(imported ? [imported] : []), ...(opts.bitcasino ? [fromBitcasino] : [])];

    const wanted = (r) =>
      r.status.startsWith('wrong shape') ||
      (opts.withEmpty && r.status === 'empty') ||
      (opts.withBroken && r.status === 'broken') ||
      (opts.withHttp && r.status === 'http');
    const todo = results.filter(wanted).slice(0, opts.limit);
    console.log(`${todo.length} game(s) to fix; looking them up...`);

    // 2. Find each on the references, download, apply.
    if (opts.download) fs.mkdirSync(opts.out, { recursive: true });
    const usedFiles = new Set();
    let writes = Promise.resolve();
    let done = 0;
    await pool(todo, opts.concurrency, async (r) => {
      const misses = [];
      for (const source of sources) {
        const hit = await source(r);
        if (hit.miss) {
          misses.push(hit.miss);
          continue;
        }
        // Landscape art beats nothing, never a working image.
        if (hit.landscape && r.status !== 'empty' && r.status !== 'broken') {
          misses.push(`${hit.source} art is landscape; the current image still loads`);
          continue;
        }
        const got = await fetchImage(hit.url);
        const shapeOk = got.size && (hit.landscape || portrait(got.size));
        if (got.error || !shapeOk || got.bytes.length < 2048) {
          misses.push(`${hit.source} art unusable (${got.error || `${got.size.width}x${got.size.height}`})`);
          continue;
        }
        Object.assign(r, { source: hit.source, newUrl: hit.url, matched: hit.matched, new: `${got.size.width}x${got.size.height}` });

        if (opts.download) {
          const dir = path.join(opts.out, r.category, safeFile(r.provider || 'unknown'));
          let file = path.join(dir, `${safeFile(r.name)}.${got.size.type}`);
          if (usedFiles.has(file)) file = path.join(dir, `${safeFile(r.name)} (${r.uuid.slice(0, 8)}).${got.size.type}`);
          usedFiles.add(file);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(file, got.bytes);
          r.file = path.relative(opts.out, file);
        }

        // One client, so one transaction at a time: lookups run in parallel, writes queue.
        if (opts.apply) await (writes = writes.then(() => applyOne(db, r, got)));
        r.status = opts.apply ? 'fixed' : 'found';
        break;
      }
      // No reference art. A working portrait image (status http) stays; anything else gets the branded tile.
      if (!r.source && opts.brand && r.status !== 'http') {
        const got = await brandedArt(r);
        Object.assign(r, { source: 'branded', newUrl: 'generated', matched: 'branded tile', new: `${got.size.width}x${got.size.height}` });
        if (opts.download) {
          const dir = path.join(opts.out, r.category, safeFile(r.provider || 'unknown'));
          const file = path.join(dir, `${safeFile(r.name)} (${r.uuid.slice(0, 8)}).png`);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(file, got.bytes);
          r.file = path.relative(opts.out, file);
        }
        if (opts.apply) await (writes = writes.then(() => applyOne(db, r, got, { selfHost: true })));
        r.note = misses.join('; ');
        r.status = opts.apply ? 'fixed' : 'found';
      }
      if (!r.source) {
        r.note = misses.join('; ');
        r.status = r.status === 'http' ? 'kept (loads, portrait, no reference art)' : `not found (${r.status})`;
      }
      if (++done % 50 === 0) console.log(`  looked up ${done}/${todo.length}`);
    });
    await writes;

    report(results, todo, opts, sources);
  } finally {
    await db.end();
  }
}

/** Where the casino service serves self-hosted art (games public routes, `/image/:name`). */
const ARTWORK_PATH = '/api/v1/casino/games/image/';

async function applyOne(db, r, got, { selfHost = false } = {}) {
  const name = selfHost ? `${r.uuid}.${got.size.type}` : null;
  const image = name ? `${ARTWORK_PATH}${name}` : r.newUrl;
  const contentType = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[got.size.type];
  await db.query('BEGIN');
  try {
    // previous_image keeps the FIRST value replaced, so a re-run cannot make --revert restore our own art.
    await db.query(
      `INSERT INTO game_artwork (game_uuid, image, name, data, content_type, byte_size, width, height, source, source_url, previous_image)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, (SELECT image FROM gisgamesnew WHERE uuid = $1))
       ON CONFLICT (game_uuid) DO UPDATE SET
         image = EXCLUDED.image, name = EXCLUDED.name, data = EXCLUDED.data, content_type = EXCLUDED.content_type,
         byte_size = EXCLUDED.byte_size, width = EXCLUDED.width, height = EXCLUDED.height,
         source = EXCLUDED.source, source_url = EXCLUDED.source_url, updated_at = NOW()`,
      [r.uuid, image, name, name ? got.bytes : null, name ? contentType : null, name ? got.bytes.length : null,
        got.size.width, got.size.height, r.source, r.newUrl]
    );
    await db.query('UPDATE gisgamesnew SET image = $2 WHERE uuid = $1', [r.uuid, image]);
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
}

function report(results, todo, opts, sources) {
  const count = (list, fn) => list.reduce((m, r) => ((m[fn(r)] = (m[fn(r)] || 0) + 1), m), {});
  console.log('\ncurrent art:', count(results, (r) => (r.status.startsWith('not found') ? r.status.slice(11, -1) : r.status)));

  const names = sources.map((s) => ({ fromOwnCatalogue: 'own', fromHash: 'hash.game', fromShuffle: 'shuffle', fromPowbet: 'powbet', fromBitcasino: 'bitcasino', fromImport: 'import' })[s.name] || s.name);
  const byProvider = {};
  for (const r of todo) {
    const p = (byProvider[r.provider] ||= { todo: 0, found: 0, missed: 0, ...Object.fromEntries(names.map((n) => [n, 0])), branded: 0, kept: 0 });
    p.todo++;
    if (r.source) {
      p.found++;
      p[r.source]++;
    } else if (r.status.startsWith('kept')) p.kept++;
    else p.missed++;
  }
  console.table(byProvider);
  console.log('by source:', count(todo.filter((r) => r.source), (r) => r.source));
  const found = todo.filter((r) => r.source).length;
  console.log(`found ${found} of ${todo.length}${opts.apply ? ', applied to the DB' : ' (dry run: DB untouched, add --apply)'}`);

  fs.mkdirSync(opts.out, { recursive: true });
  const cols = ['uuid', 'name', 'provider', 'type', 'category', 'status', 'image', 'old', 'source', 'matched', 'new', 'newUrl', 'file', 'note'];
  const rank = (s) => (s === 'found' || s === 'fixed' ? 0 : s.startsWith('not found') ? 1 : s.startsWith('kept') ? 2 : 3);
  const sorted = [...results].sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      a.category.localeCompare(b.category) ||
      String(a.provider).localeCompare(String(b.provider)) ||
      String(a.name).localeCompare(String(b.name))
  );
  const lines = [cols.join(','), ...sorted.map((r) => cols.map((c) => csvCell(r[c])).join(','))];
  fs.writeFileSync(path.join(opts.out, 'report.csv'), `${lines.join('\n')}\n`);
  console.log(`report: ${path.join(opts.out, 'report.csv')}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { PORTRAIT, portrait, parseArgs };
