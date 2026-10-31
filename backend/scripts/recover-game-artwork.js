#!/usr/bin/env node
'use strict';

/**
 * Build `packages/db/seeders/data/recovered-artwork.json`: verified artwork for the catalogue
 * rows whose own `game_icon` cannot be drawn (see `packages/db/seeders/data/artwork.js`).
 *
 *   node scripts/recover-game-artwork.js            probe and write the file
 *   node scripts/recover-game-artwork.js --dry-run  probe and print the counts only
 *   node scripts/recover-game-artwork.js --check    also GET every URL already kept, report failures
 *
 * Each candidate is fetched the way an `<img>` fetches it (browser user agent, a Referer,
 * an image Accept header) and kept only on 200 + `image/*` + more than 1 KB. A HEAD is not
 * enough: some CDNs answer HEAD 403 and serve the GET.
 *
 * Candidates, first verified wins:
 *   1. the row's own URL unwrapped (`_next/image?url=`, Drive share link -> `uc?export=view`,
 *      which Drive refuses to an <img>, so none of those is kept)
 *   2. cdn.softswiss.net/i/s6/<studio>/<GameName>.png, the studio folders below
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseCsvObjects } = require('../packages/db/seeders/data/parseCsv');
const { usableArtwork, unwrapArtwork, RECOVERED_PATH } = require('../packages/db/seeders/data/artwork');

const CSV_PATH = path.join(__dirname, '..', 'packages', 'db', 'seeders', 'data', 'js-games.csv');
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const REFERER = 'http://localhost:5190/';
const CONCURRENCY = 8;

/** The softswiss CDN folders a catalogue vendor's art is filed under. */
const SOFTSWISS_DIRS = {
  bgaming: ['bgaming', 'softswiss'],
  netent: ['evolution', 'netent'],
  evolution: ['evolution'],
  pragmaticlive: ['pragmaticexternal', 'pragmaticplaylive'],
  pragmatic: ['pragmaticexternal', 'pragmatic'],
  microgaming: ['microgaming', 'gamesglobal'],
  ezugi: ['ezugi'],
  hacksaw: ['hacksaw'],
  pgsoft: ['pgsoft'],
  jili: ['jili'],
};

function nameVariants(name) {
  const words = String(name || '')
    .replace(/['’]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (!words.length) return [];
  const asIs = words.join('');
  const pascal = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  const pascalLower = words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
  return [...new Set([pascal, asIs, pascalLower])];
}

function candidates(row) {
  const out = [];
  const raw = String(row.game_icon || '').trim();
  const unwrapped = unwrapArtwork(raw);
  if (unwrapped && unwrapped !== raw) out.push(unwrapped);
  for (const dir of SOFTSWISS_DIRS[row.vendor] || []) {
    for (const n of nameVariants(row.game_name)) out.push(`https://cdn.softswiss.net/i/s6/${dir}/${n}.png`);
  }
  return [...new Set(out)];
}

async function renders(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
        // What Chrome sends for an <img>. Drive, for one, serves curl and refuses this.
        headers: {
          'user-agent': UA,
          referer: REFERER,
          accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          'sec-fetch-dest': 'image',
          'sec-fetch-mode': 'no-cors',
          'sec-fetch-site': 'cross-site',
        },
      });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (!res.ok || !/^image\//i.test(res.headers.get('content-type') || '')) {
        await res.body?.cancel();
        return false;
      }
      const bytes = (await res.arrayBuffer()).byteLength;
      return bytes > 1024;
    } catch {
      if (attempt) return false;
    }
  }
  return false;
}

async function pool(items, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) await fn(items[next++]);
    })
  );
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const check = process.argv.includes('--check');
  const rows = parseCsvObjects(fs.readFileSync(CSV_PATH, 'utf8')).filter((r) => r.game_uid);

  const games = {};
  const missed = {};
  const kept = rows.filter((r) => usableArtwork(String(r.game_icon || '').trim()));
  const todo = rows.filter((r) => !usableArtwork(String(r.game_icon || '').trim()));

  await pool(todo, async (row) => {
    for (const url of candidates(row)) {
      if (await renders(url)) {
        games[row.game_uid] = url;
        return;
      }
    }
    missed[row.vendor] = (missed[row.vendor] || 0) + 1;
  });

  const failingKept = [];
  if (check) {
    await pool(kept, async (row) => {
      if (!(await renders(String(row.game_icon).trim()))) failingKept.push(row.game_uid);
    });
  }

  const byVendor = {};
  for (const row of todo) if (games[row.game_uid]) byVendor[row.vendor] = (byVendor[row.vendor] || 0) + 1;
  console.log(`rows ${rows.length}, own art ${kept.length}, without ${todo.length}`);
  console.log(`recovered ${Object.keys(games).length}`, byVendor);
  console.log('still without art', missed);
  if (check) console.log(`own URLs that did not render: ${failingKept.length}`, failingKept.slice(0, 20));

  if (dryRun) return;
  const sorted = Object.fromEntries(Object.entries(games).sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(
    RECOVERED_PATH,
    `${JSON.stringify({ generatedBy: 'scripts/recover-game-artwork.js', verifiedAt: new Date().toISOString().slice(0, 10), games: sorted }, null, 2)}\n`
  );
  console.log(`wrote ${path.relative(process.cwd(), RECOVERED_PATH)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
