/**
 * Live contract check: the web app's own query objects against a running
 * gateway, with every response run through the adapters.
 *
 * ## What this catches that nothing else does
 *
 * `backend/tools/verify-frontend-routes.js` proves a path in
 * `lib/endpoints.js` is a route the backend mounts. The unit tests prove the
 * adapters map a *fixture* correctly. Neither notices the failure that
 * actually happens in this seam:
 *
 * - a **422** because a route's `.strict()` validator does not accept a
 *   parameter we send, or wants `page`/`limit` where we sent `limit`/`offset`;
 * - a **renamed or dropped field** upstream, which makes the adapter produce
 *   `undefined` — and `undefined` renders as nothing at all, so a rail simply
 *   goes blank rather than throwing;
 * - a **collection slug** the platform stopped serving.
 *
 * All three present in the UI as "empty", which is indistinguishable from a
 * catalogue that genuinely has nothing in it. That is why this asserts on
 * adapted output being *renderable*, not merely on a 200.
 *
 * ## Why it imports from `src/queries/params.js`
 *
 * It sends the exact objects the hooks send. A script that hand-rolled its own
 * parameters would pass while the app 422s — it would verify the script, not
 * the app.
 *
 * Needs a running gateway and a seeded catalogue:
 *
 *     cd backend && npm run dev user admin casino gateway
 *     npm run verify:api            # from apps/web, or the repo root
 *
 * Exits non-zero on the first hard failure, so it is CI-usable.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  gamesQuery,
  collectionQuery,
  searchQuery,
  providerGamesQuery,
  recentQuery,
  COLLECTION_SLUGS,
} from '../src/queries/params.js';
import { toGames, toProviders, toProviderCounts, toSiteConfig } from '../src/data/adapters/index.js';
import { CATEGORY_SLUGS, categoryFromType } from '../src/data/adapters/categories.js';
import { CATEGORY_ART } from '../src/data/adapters/games.js';
import { KNOWN_LOGOS } from '../src/data/adapters/providers.js';

/** `public/` — every path the adapters emit is served from here. */
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** A served URL path -> the file that answers it. */
const asset = (url) => join(PUBLIC_DIR, url.replace(/^\//, ''));

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:4000';
const CASINO = `${BASE}/api/v1/casino`;
const ADMIN = `${BASE}/api/v1/admin`;

let failures = 0;
let checks = 0;

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function ok(label, detail = '') {
  checks += 1;
  console.log(`  ${green('✓')} ${label}${detail ? ` ${dim(detail)}` : ''}`);
}

function fail(label, detail) {
  checks += 1;
  failures += 1;
  console.log(`  ${red('✗')} ${label}`);
  if (detail) console.log(`    ${red(detail)}`);
}

/** Fetch and unwrap the platform envelope, keeping `meta`. */
async function get(url, query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  const full = search ? `${url}?${search}` : url;

  const response = await fetch(full);
  const text = await response.text();

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { status: response.status, url: full, error: `not JSON: ${text.slice(0, 120)}` };
  }

  if (!response.ok || body.success !== true) {
    const code = body?.error?.code ?? `HTTP_${response.status}`;
    const fields = body?.error?.details?.fields
      ?.map((f) => `${f.field}: ${f.message}`)
      .join('; ');
    return {
      status: response.status,
      url: full,
      error: `${code}${fields ? ` — ${fields}` : ''} ${body?.error?.message ?? ''}`.trim(),
    };
  }

  return { status: response.status, url: full, data: body.data, meta: body.meta };
}

/**
 * Every field a tile needs to render.
 *
 * `category` is allowed to be null — an unmapped upstream type still renders,
 * it just does not belong to one of our seven. Everything else being present
 * is what stops a rail from drawing empty boxes.
 */
function unrenderable(game) {
  const missing = [];
  if (!game.id) missing.push('id');
  if (!game.slug) missing.push('slug');
  if (!game.title) missing.push('title');
  if (!game.provider) missing.push('provider');
  if (!game.thumb) missing.push('thumb');
  if (!game.thumbWide) missing.push('thumbWide');
  return missing;
}

/** Assert a list of adapted games is renderable, and non-empty if required. */
function assertGames(label, rows, { min = 1 } = {}) {
  const games = toGames(rows);

  if (games.length < min) {
    fail(label, `adapted to ${games.length} game(s), expected at least ${min}`);
    return games;
  }

  const broken = games
    .map((game) => ({ game, missing: unrenderable(game) }))
    .filter((entry) => entry.missing.length);

  if (broken.length) {
    const [first] = broken;
    fail(
      label,
      `${broken.length}/${games.length} unrenderable — e.g. "${first.game.title}" missing ${first.missing.join(', ')}`,
    );
    return games;
  }

  ok(label, `${games.length} game(s)`);
  return games;
}

console.log(`\niBitPlay contract check  ${dim(BASE)}\n`);

// ── The gateway is up ──────────────────────────────────────────────────
console.log('Reachability');
{
  const probe = await get(`${CASINO}/games`, { page: 1, limit: 1 });
  if (probe.error) {
    console.log(`  ${red('✗')} gateway not answering — ${probe.error}`);
    console.log(
      `\n  ${dim('Start it with:  cd backend && npm run dev user admin casino gateway')}\n`,
    );
    process.exit(1);
  }
  ok('gateway answers the catalogue');
}

// ── Browse ─────────────────────────────────────────────────────────────
console.log('\nGET /casino/games  (useGames)');
{
  const query = gamesQuery({ page: 1, limit: 12 });
  const res = await get(`${CASINO}/games`, query);

  if (res.error) {
    fail(`unfiltered list ${JSON.stringify(query)}`, res.error);
  } else {
    assertGames('unfiltered list', res.data);

    // `meta.pagination`, never `meta.total` — the hooks read `pagination`.
    const pagination = res.meta?.pagination;
    if (!pagination || typeof pagination.total !== 'number') {
      fail('meta.pagination', `got ${JSON.stringify(res.meta)}`);
    } else {
      ok('meta.pagination', `total ${pagination.total}, ${pagination.totalPages} page(s)`);
    }
  }
}

// Every category the nav offers must be a filter the platform accepts.
console.log('\n  per category');
for (const slug of CATEGORY_SLUGS) {
  const query = gamesQuery({ category: slug, page: 1, limit: 6 });
  const res = await get(`${CASINO}/games`, query);

  if (res.error) {
    fail(`?type=${query.type}`, res.error);
    continue;
  }

  const games = toGames(res.data);

  // An empty category is legitimate — but every row that DID come back must
  // map to the slug we asked for, or the mapping table is wrong in a way that
  // shows the player another category's games.
  const wrong = games.filter((game) => game.category !== slug);
  if (wrong.length) {
    fail(`?type=${query.type}`, `${wrong.length} row(s) mapped to ${wrong[0].category}`);
  } else {
    ok(`?type=${query.type}`, `${games.length} game(s)`);
  }
}

// ── Collections ────────────────────────────────────────────────────────
console.log('\nGET /casino/games/collections/:collection  (useCollection)');
for (const slug of COLLECTION_SLUGS) {
  const query = collectionQuery({ limit: 24 });
  const res = await get(`${CASINO}/games/collections/${slug}`, query);

  if (res.error) {
    fail(`collection "${slug}"`, res.error);
    continue;
  }
  assertGames(`collection "${slug}"`, res.data);
}

// ── Search ─────────────────────────────────────────────────────────────
console.log('\nGET /casino/games/search  (useGameSearch, useGame)');
{
  const query = searchQuery({ q: 'a', limit: 30 });
  const res = await get(`${CASINO}/games/search`, query);

  if (res.error) {
    fail('search', res.error);
  } else {
    const games = assertGames('search', res.data);

    // The lean row carries no `images`, so `thumbWide` has to come from the
    // portrait fallback. If that regressed, the featured rail draws holes.
    const noWide = games.filter((game) => !game.thumbWide);
    if (noWide.length) fail('search rows fall back to a portrait thumbWide', `${noWide.length} without`);
    else ok('search rows fall back to a portrait thumbWide');
  }
}

// ── Providers ──────────────────────────────────────────────────────────
console.log('\nGET /casino/games/providers + /games/stats  (useProviders)');
let providers = [];
{
  const stats = await get(`${CASINO}/games/stats`);
  const list = await get(`${CASINO}/games/providers`);

  if (stats.error) fail('stats', stats.error);
  if (list.error) fail('providers', list.error);

  if (!stats.error && !list.error) {
    const counts = toProviderCounts(stats.data?.topProviders);
    providers = toProviders(list.data?.rows, counts);

    if (!providers.length) {
      fail('providers', 'adapted to an empty list');
    } else {
      ok('providers', `${providers.length} studio(s)`);
    }

    /**
     * `gis_providers` and `gisgamesnew` are two catalogues, and nothing in the
     * platform derives one from the other. Phase 0 seeds both; if a later sync
     * fills only one, `/games/stats` keeps reporting providers while
     * `/providers` renders an empty grid. This is the check that notices.
     */
    const declared = Number(stats.data?.stats?.total_providers) || 0;
    if (declared !== providers.length) {
      fail(
        'gis_providers agrees with gisgamesnew',
        `stats says ${declared} provider(s), gis_providers lists ${providers.length}`,
      );
    } else {
      ok('gis_providers agrees with gisgamesnew', `${declared}`);
    }

    // Counts must attach, or the grid says "0 games" under every studio.
    const uncounted = providers.filter((p) => p.gameCount === 0);
    if (uncounted.length === providers.length) {
      fail('provider game counts attach', 'every studio counted 0');
    } else {
      ok('provider game counts attach', `${providers.length - uncounted.length} counted`);
    }

    // Every type the catalogue holds should map to one of our seven, or a
    // category page somewhere is unreachable.
    const unmapped = (stats.data?.gameTypes ?? [])
      .map((row) => row.type)
      .filter((type) => categoryFromType(type) === null);
    if (unmapped.length) {
      fail('every catalogue type maps to a category', `unmapped: ${unmapped.join(', ')}`);
    } else {
      ok('every catalogue type maps to a category');
    }
  }
}

// ── One provider's catalogue ───────────────────────────────────────────
console.log('\nGET /casino/games/provider/:provider  (useProviderGames)');
if (providers.length) {
  const provider = providers.find((p) => p.gameCount > 0) ?? providers[0];
  const query = providerGamesQuery({ page: 1, limit: 24 });
  const res = await get(
    `${CASINO}/games/provider/${encodeURIComponent(provider.name)}`,
    query,
  );

  if (res.error) {
    fail(`provider "${provider.name}"`, res.error);
  } else {
    const games = assertGames(`provider "${provider.name}"`, res.data);

    // The slug in the URL has to reach this exact studio and no other.
    const foreign = games.filter((game) => game.provider !== provider.name);
    if (foreign.length) {
      fail('slug resolves to exactly one studio', `${foreign.length} row(s) from another`);
    } else {
      ok('slug resolves to exactly one studio', `/providers/${provider.slug}`);
    }
  }
} else {
  fail('provider catalogue', 'skipped — no providers to test with');
}

// ── Site config ────────────────────────────────────────────────────────
console.log('\nGET /admin/site-config/public  (useSiteConfig)');
{
  const res = await get(`${ADMIN}/site-config/public`);

  if (res.error) {
    fail('site config', res.error);
  } else {
    const config = toSiteConfig(res.data);

    ok('site config', config.configured ? 'a config row exists' : 'unconfigured — all flags ON');

    // The currency intersection is what drives the wallet picker. If the
    // flags stop carrying lowercase currency codes it silently empties.
    const currencies = config.enabledCurrencies(['USDT', 'BTC', 'ETH', 'INR']);
    if (!currencies.length) {
      fail('currency flags', 'no currency enabled out of USDT, BTC, ETH, INR');
    } else {
      ok('currency flags', currencies.join(', '));
    }

    // An amount must survive as a string; parsing it loses the precision the
    // platform sends it with.
    const bonus = config.amount('registerbonus');
    if (typeof bonus !== 'string') fail('public amounts stay strings', `got ${typeof bonus}`);
    else ok('public amounts stay strings', bonus);
  }
}

// ── The strict validators ──────────────────────────────────────────────
/**
 * These assert the FAILURES, which is what proves the params above are not
 * merely tolerated. If the platform ever stopped being `.strict()` these would
 * flip, and the guarantee that a wrong parameter is loud rather than silent
 * would be gone without anything else noticing.
 */
console.log('\nStrict validators  (a wrong parameter must be refused, not ignored)');
{
  const cases = [
    {
      label: 'offset is refused on /games',
      url: `${CASINO}/games`,
      query: { limit: 5, offset: 10 },
    },
    {
      label: 'type is refused on a collection',
      url: `${CASINO}/games/collections/hot`,
      query: { page: 1, limit: 5, type: 'crash' },
    },
    {
      label: 'page is refused on search',
      url: `${CASINO}/games/search`,
      query: { q: 'a', limit: 5, page: 2 },
    },
    {
      label: 'an unknown collection slug is refused',
      url: `${CASINO}/games/collections/not-a-collection`,
      query: { page: 1, limit: 5 },
    },
  ];

  for (const testCase of cases) {
    const res = await get(testCase.url, testCase.query);
    if (res.error) ok(testCase.label, `${res.status}`);
    else fail(testCase.label, `answered 200 — the validator is no longer strict`);
  }
}

// ── Player-scoped routes are guarded ───────────────────────────────────
console.log('\nPlayer-scoped routes  (must refuse an anonymous read)');
{
  const res = await get(`${CASINO}/games/recently-played`, recentQuery({ limit: 15 }));
  if (res.error) ok('recently-played needs a token', `${res.status}`);
  else fail('recently-played needs a token', 'answered 200 without one');
}

// ── Art the adapters point at must exist ───────────────────────────────
/**
 * A 404 on an image is silent: the browser draws its broken-image glyph and
 * nothing reaches the console as an error. So the paths the adapters can emit
 * are checked against `public/` rather than trusted.
 *
 * Both of these tables were wrong when they were first written — the category
 * fallback derived `crash.png` where the file is `crash-instant-win.png`, and
 * the provider slug derived `northlight-studio.svg` where the file is
 * `northlight.svg`. That is what this check is for.
 */
console.log('\nArt the adapters emit  (a missing image 404s silently)');
{
  const missingArt = Object.entries(CATEGORY_ART).filter(([, url]) => !existsSync(asset(url)));
  if (missingArt.length) {
    fail(
      'category fallback art exists',
      missingArt.map(([slug, url]) => `${slug} -> ${url}`).join(', '),
    );
  } else {
    ok('category fallback art exists', `${Object.keys(CATEGORY_ART).length} categor(ies)`);
  }

  const missingLogos = [...KNOWN_LOGOS].filter(
    (slug) => !existsSync(asset(`/images/providers/${slug}.svg`)),
  );
  if (missingLogos.length) {
    fail('every declared provider logo exists', missingLogos.join(', '));
  } else {
    ok('every declared provider logo exists', `${KNOWN_LOGOS.size} logo(s)`);
  }

  // The other direction: a studio the catalogue serves with no art is not a
  // failure — a real sync brings hundreds — but it must resolve to null rather
  // than to a path that 404s.
  const broken = providers.filter((p) => p.logo && !existsSync(asset(p.logo)));
  if (broken.length) {
    fail(
      'no provider points at art that is not there',
      broken.map((p) => `${p.name} -> ${p.logo}`).join(', '),
    );
  } else {
    const withArt = providers.filter((p) => p.logo).length;
    ok(
      'no provider points at art that is not there',
      `${withArt}/${providers.length} have a logo`,
    );
  }

  // Game art comes from the catalogue row, not from us — but for the seeded
  // placeholder catalogue we own those files too, so a broken one is our bug.
  const sample = await get(`${CASINO}/games`, gamesQuery({ page: 1, limit: 100 }));
  if (!sample.error) {
    const games = toGames(sample.data);
    const brokenArt = games.filter((game) => !existsSync(asset(game.thumb)));
    if (brokenArt.length) {
      fail(
        'seeded game art exists',
        `${brokenArt.length}/${games.length} missing — e.g. ${brokenArt[0].title} -> ${brokenArt[0].thumb}`,
      );
    } else {
      ok('seeded game art exists', `${games.length} tile(s)`);
    }
  }
}

// ── Result ─────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(70)}`);
if (failures) {
  console.log(`${red(`${failures} of ${checks} checks failed`)}\n`);
  process.exit(1);
}
console.log(`${green(`all ${checks} checks passed`)}\n`);
