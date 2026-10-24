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
import { CATEGORY_SLUGS, categoryFromType, queryTypesFor } from '../src/data/adapters/categories.js';
import { CATEGORY_ART } from '../src/data/adapters/games.js';
import { KNOWN_LOGOS } from '../src/data/adapters/providers.js';
import {
  PLATFORM_COLLECTIONS,
  CUT_COLLECTIONS,
  resolveCollection,
} from '../src/data/adapters/collections.js';
import { HOME_RAILS } from '../src/data/homeRails.js';
import { EVENTS } from '../src/lib/socketEvents.js';

import { io } from 'socket.io-client';

/** `public/` — every path the adapters emit is served from here. */
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

/** A served URL path -> the file that answers it. */
const asset = (url) => join(PUBLIC_DIR, url.replace(/^\//, ''));

const BASE = process.env.API_BASE ?? 'http://127.0.0.1:4000';
const CASINO = `${BASE}/api/v1/casino`;
const ADMIN = `${BASE}/api/v1/admin`;
const USER = `${BASE}/api/v1/user`;

/**
 * The socket base, which is NOT the gateway.
 *
 * user-service attaches its own Socket.io server on its own port; the
 * gateway proxies HTTP only. In the browser this is same-origin because
 * `vite.config.js` proxies `/socket.io` to :4001; a script has no proxy, so
 * it names the service directly.
 */
const SOCKET_BASE = process.env.SOCKET_BASE ?? 'http://127.0.0.1:4001';

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

  /**
   * An empty category is legitimate — but every row that DID come back must
   * belong to the page we asked for, or the mapping table is wrong in a way
   * that shows the player another category's games.
   *
   * "Belongs to" is `queryTypesFor`, not `=== slug`, because a page may cover
   * more than its own type: `/categories/live-casino` is the whole live room
   * and answers the baccarat, blackjack and roulette tables carved out of it.
   * For the other nine that set is one long, so this is the same assertion it
   * always was — and it still catches the failure it was written for, which is
   * a row from a category nobody asked about.
   */
  const covered = new Set(queryTypesFor(slug).map(categoryFromType).filter(Boolean));
  const wrong = games.filter((game) => !covered.has(game.category));
  if (wrong.length) {
    fail(`?type=${query.type}`, `${wrong.length} row(s) mapped to ${wrong[0].category}`);
  } else {
    const detail =
      covered.size > 1
        ? `${games.length} game(s) across ${covered.size} categories`
        : `${games.length} game(s)`;
    ok(`?type=${query.type}`, detail);
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
{
  const res = await get(`${CASINO}/bet-history`, { page: 1, limit: 5 });
  if (res.error) ok('bet-history needs a token', `${res.status}`);
  else fail('bet-history needs a token', 'answered 200 without one');
}

/**
 * The account area's reads, added with Phase 6.
 *
 * Every one is `player`, so the check without a token is that the route
 * EXISTS and is guarded. A 404 is the failure worth catching: a renamed or
 * unmounted route would render as an empty security card or an empty
 * transactions table, neither of which looks like a missing endpoint.
 */
for (const [label, path_, query] of [
  ['GET /2fa/status', `${USER}/2fa/status`, undefined],
  ['GET /auth/sessions', `${USER}/auth/sessions`, undefined],
  ['GET /kyc/status', `${USER}/kyc/status`, undefined],
  ['GET /history', `${USER}/history`, { limit: 5, offset: 0 }],
  ['GET /history/transfers', `${USER}/history/transfers`, { limit: 5, offset: 0 }],
]) {
  const res = await get(path_, query);
  if (res.status === 404) fail(label, 'answered 404 — the route is not mounted');
  else if (res.error) ok(`${label} needs a token`, `${res.status}`);
  else fail(label, 'answered 200 without one');
}

/**
 * The two aggregator launch routes.
 *
 * Unauthenticated POSTs, so the only thing checkable without a session is that
 * the routes EXIST and are guarded — which is exactly the failure worth
 * catching, because a renamed or unmounted route answers 404 and `Play.jsx`
 * would render that as "the provider refused" rather than "the route is gone".
 *
 * A 404 here fails the check; a 401/403 passes it. `GIS_NOT_CONFIGURED` (503)
 * would also pass — it means the route ran — but the guard sits in front of
 * the service, so it should not be reached.
 */
console.log('\nAggregator launch  (routes exist and are guarded)');
for (const [label, url] of [
  ['POST /gis/launch', `${CASINO}/gis/launch`],
  ['POST /gis/launch-demo', `${CASINO}/gis/launch-demo`],
]) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ gameUuid: 'cobalt-sky' }),
  });

  if (response.status === 404) fail(label, 'answered 404 — the route is not mounted');
  else if (response.status === 200 || response.status === 201) fail(label, 'launched without a token');
  else ok(label, `${response.status}`);
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

// ── Every home rail resolves to games ──────────────────────────────────
/**
 * The seven rails, each through the source it actually uses.
 *
 * A rail whose source stopped resolving renders nothing at all — `GameRail`
 * returns null for an empty list, which is right for a collection an operator
 * emptied and indistinguishable from a rail that broke. This is what tells
 * them apart.
 */
console.log('\nHome rails  (a rail with no source renders nothing at all)');
for (const rail of HOME_RAILS) {
  const { kind, slug } = rail.source;

  let rows;
  if (kind === 'collection') {
    const res = await get(`${CASINO}/games/collections/${slug}`, collectionQuery({ limit: 12 }));
    if (res.error) {
      fail(`"${rail.title}"`, res.error);
      continue;
    }
    rows = res.data;
  } else if (kind === 'category') {
    const res = await get(`${CASINO}/games`, gamesQuery({ category: slug, page: 1, limit: 12 }));
    if (res.error) {
      fail(`"${rail.title}"`, res.error);
      continue;
    }
    rows = res.data;
  } else {
    const res = await get(`${CASINO}/games`, gamesQuery({ page: 1, limit: 100 }));
    if (res.error) {
      fail(`"${rail.title}"`, res.error);
      continue;
    }
    rows = res.data;
  }

  const games = kind === 'cut' ? resolveCollection(slug).cut(toGames(rows)) : toGames(rows);

  if (games.length === 0) {
    fail(`"${rail.title}"`, `${kind} "${slug}" resolved to 0 games — the rail draws nothing`);
  } else {
    ok(`"${rail.title}"`, `${kind} "${slug}" — ${games.length}`);
  }
}

// ── The Themes strip links somewhere real ──────────────────────────────
/**
 * Every tile in the old strip was a 404: the six static `THEMES` linked to
 * `/themes/:slug` and there has never been a `/themes` route. The five here
 * link to `/games/:collection`, so each has to be a slug the platform serves
 * AND one `resolveCollection` reads as a collection.
 */
console.log('\nThemes strip');
{
  const artMissing = PLATFORM_COLLECTIONS.filter((c) => !existsSync(asset(c.art)));
  if (artMissing.length) {
    fail('theme art exists', artMissing.map((c) => `${c.slug} -> ${c.art}`).join(', '));
  } else {
    ok('theme art exists', `${PLATFORM_COLLECTIONS.length} tile(s)`);
  }

  const badLink = PLATFORM_COLLECTIONS.filter(
    (c) => resolveCollection(c.slug)?.kind !== 'collection',
  );
  if (badLink.length) {
    fail('every tile links to a real list', badLink.map((c) => c.slug).join(', '));
  } else {
    ok('every tile links to a real list', '/games/<collection>');
  }
}

// ── The client-side cuts still find something ──────────────────────────
/**
 * `new`, `exclusives` and `live-rtp` are cut out of one fetched page because
 * the browse route has no `label` filter and no sort — see
 * `data/adapters/collections.js`. They are the surfaces that will break first
 * against a real catalogue, so an empty cut is reported rather than passed
 * over as "the operator curated nothing".
 */
console.log('\nClient-side cuts  (no label filter upstream — see collections.js)');
{
  const res = await get(`${CASINO}/games`, gamesQuery({ page: 1, limit: 100 }));
  if (res.error) {
    fail('cut source', res.error);
  } else {
    const games = toGames(res.data);
    for (const [slug, meta] of Object.entries(CUT_COLLECTIONS)) {
      const cut = meta.cut(games);
      if (cut.length === 0) {
        fail(`"${slug}"`, `cut 0 of ${games.length} — the rail and /games/${slug} are both empty`);
      } else {
        ok(`"${slug}"`, `${cut.length} of ${games.length}`);
      }
    }
  }
}

// ── The live surfaces ──────────────────────────────────────────────────
/**
 * The four public socket events behind the ticker, the game-page feed and
 * the notification list.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THIS SECTION DOES NOT GO THROUGH THE GATEWAY.
 *
 * The gateway proxies HTTP only — `proxy.js` strips `upgrade` with the
 * other hop-by-hop headers — so a websocket handshake sent at :4000 never
 * reaches a service. These connect straight to user-service, which is what
 * `vite.config.js` points the browser's `/socket.io` at.
 *
 * The event NAMES come from the app's own table, for the same reason the
 * HTTP checks import `queries/params.js`: a script with its own copy of a
 * hash would verify the script. `verify:socket-events` proves those names
 * match the backend byte for byte; this proves the replies have the fields
 * the adapters read, which is the failure that presents as an empty rail.
 * ═══════════════════════════════════════════════════════════════════════
 */
console.log('\nSocket live surfaces  (LatestWins, RecentRounds, Notifications)');
{
  const socket = io(SOCKET_BASE, { path: '/socket.io', transports: ['polling', 'websocket'] });

  /** The wire format: JSON in a byte array. Same as `lib/socket.js`. */
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const ask = (event, payload = {}) =>
    new Promise((resolve) => {
      socket.timeout(10_000).emit(event, encoder.encode(JSON.stringify(payload)), (timeout, frame) => {
        if (timeout) return resolve({ error: 'no reply within 10s' });
        try {
          const body =
            frame instanceof ArrayBuffer
              ? JSON.parse(decoder.decode(new Uint8Array(frame)))
              : ArrayBuffer.isView(frame)
                ? JSON.parse(decoder.decode(frame))
                : frame;
          // `status === true` and nothing else — a refusal sets `status` to
          // the error MESSAGE, which is truthy. See `lib/socket.js`.
          if (body?.status !== true) {
            return resolve({ error: body?.error?.code ?? body?.msg ?? 'refused' });
          }
          return resolve({ data: body });
        } catch (error) {
          return resolve({ error: `unreadable frame: ${error.message}` });
        }
      });
    });

  const connected = await new Promise((resolve) => {
    socket.once('connect', () => resolve(true));
    socket.once('connect_error', () => resolve(false));
  });

  if (!connected) {
    fail('socket connects to user-service', `nothing accepted a handshake at ${SOCKET_BASE}`);
  } else {
    ok('socket connects to user-service', SOCKET_BASE);

    /**
     * Every row the two feeds answer must carry the six fields the ticker
     * renders. A renamed field upstream makes `toBet` produce `undefined`,
     * and `undefined` renders as nothing — the strip goes blank rather than
     * throwing, which is exactly the failure this whole script exists for.
     */
    const ROW_FIELDS = ['name', 'game', 'coin', 'amount', 'profit', 'at'];

    const checkFeed = async (label, event, payload, field) => {
      const res = await ask(event, payload);
      if (res.error) return fail(label, res.error);

      const rows = res.data[field];
      if (!Array.isArray(rows)) {
        return fail(`${label} answers \`${field}\``, `got ${typeof rows}`);
      }
      if (rows.length === 0) {
        return ok(label, 'empty — nothing settled yet, which the ticker renders as no section');
      }

      const missing = ROW_FIELDS.filter((key) => rows[0][key] === undefined);
      if (missing.length) return fail(`${label} row shape`, `missing ${missing.join(", ")}`);

      ok(label, `${rows.length} row(s)`);
    };

    await checkFeed('LAST_BETS  (Live wins, Latest)', EVENTS.LAST_BETS, {}, 'bets');
    await checkFeed('TOP_WINNERS  (Live wins, Biggest)', EVENTS.TOP_WINNERS, {}, 'winners');

    /**
     * `LAST_BETS_BY_GAME` takes the ENGINE key, not a catalogue slug.
     *
     * The refusal boundary is pinned here because it is not where it looks:
     * the handler guards the EMPTY string only, so an unknown game answers a
     * perfectly ordinary empty list. That is the shape a caller sending a
     * provider slug would get — silence, indistinguishable from a game nobody
     * has played — and it is worth failing this script if it ever changes,
     * because the game page's feed would then start throwing where it used to
     * render nothing.
     */
    await checkFeed('LAST_BETS_BY_GAME  (RecentRounds)', EVENTS.LAST_BETS_BY_GAME, { game: 'limbo' }, 'bets');

    const unknown = await ask(EVENTS.LAST_BETS_BY_GAME, { game: 'not-a-game' });
    if (unknown.error) fail('an unknown game answers an empty feed', unknown.error);
    else if (!Array.isArray(unknown.data?.bets) || unknown.data.bets.length) {
      fail('an unknown game answers an empty feed', 'answered rows');
    } else {
      ok('an unknown game answers an empty feed', 'not a refusal — the caller must know the key');
    }

    const nameless = await ask(EVENTS.LAST_BETS_BY_GAME, { game: '' });
    if (nameless.error) ok('an empty game name IS refused', nameless.error);
    else fail('an empty game name IS refused', 'answered a list');

    /**
     * The notification feed. It answered `SOCKET_HANDLER_FAILED` for every
     * caller until Phase 8 — the handler ordered by an `id` column the
     * `notifications` table does not have. This is the check that would
     * have caught it.
     */
    const notices = await ask(EVENTS.NOTIFICATION);
    if (notices.error) fail('NOTIFICATION  (the announcements feed)', notices.error);
    else if (!Array.isArray(notices.data.notifications)) {
      fail('NOTIFICATION answers `notifications`', `got ${typeof notices.data.notifications}`);
    } else {
      const rows = notices.data.notifications;
      const missing = rows.length ? ['title', 'content', 'date'].filter((k) => rows[0][k] === undefined) : [];
      if (missing.length) fail('notification row shape', `missing ${missing.join(', ')}`);
      else ok('NOTIFICATION  (the announcements feed)', `${rows.length} notice(s)`);
    }
  }

  socket.close();
}

// ── Content and promotions ─────────────────────────────────────────────
/**
 * The Phase 7 surfaces. Unlike the account routes above, most of these are
 * **public**, so this checks the shapes the pages actually render rather than
 * only that the guard bites.
 *
 * Two of them are legitimately empty on this deployment and are reported as
 * such rather than failed: nobody has uploaded a banner and nobody has
 * scheduled a promotion. An empty list and a broken fetch look identical in a
 * rendered page, which is exactly why the distinction is worth printing here.
 */
console.log('\nGET /admin/blogs  (Blog)');
{
  const res = await get(`${ADMIN}/blogs`, { page: 1, limit: 12 });

  if (res.error) {
    fail('blog index', res.error);
  } else if (!Array.isArray(res.data)) {
    fail('blog index answers a list', `got ${typeof res.data}`);
  } else if (res.data.length === 0) {
    fail('blog index has posts', 'empty — run `npm run db:seed:demo` for the `content` set');
  } else {
    ok('blog index', `${res.data.length} post(s)`);

    // Page-based, so `meta.pagination` — not `meta.total` and not absent.
    if (typeof res.meta?.pagination?.totalPages !== 'number') {
      fail('meta.pagination', `got ${JSON.stringify(res.meta)}`);
    } else {
      ok('meta.pagination', `${res.meta.pagination.totalPages} page(s)`);
    }

    /**
     * The index must NOT ship the body — that is why the detail page fetches
     * by slug. If this ever starts arriving, the extra request can go.
     */
    const withBody = res.data.filter((row) => row.description);
    if (withBody.length) {
      ok('index carries no body', `NOTE: ${withBody.length} row(s) now include one`);
    } else {
      ok('index carries no body', 'metadata only, as expected');
    }

    // The detail read, on a slug the index actually returned.
    const [first] = res.data;
    const detail = await get(`${ADMIN}/blogs/slug/${encodeURIComponent(first.slug)}`);

    if (detail.error) {
      fail(`blogs/slug/${first.slug}`, detail.error);
    } else if (!detail.data?.description) {
      fail(`blogs/slug/${first.slug}`, 'no `description` — the detail page would render empty');
    } else {
      ok(`blogs/slug/${first.slug}`, `${detail.data.description.length} chars of body`);
    }
  }
}

console.log('\nGET /admin/banners  (HomeBanner art)');
{
  const res = await get(`${ADMIN}/banners`);

  if (res.error) {
    fail('banners', res.error);
  } else if (!Array.isArray(res.data)) {
    fail('banners answers a list', `got ${typeof res.data}`);
  } else {
    // Empty is the normal state — the copy is local either way, and only the
    // ART would come from here. See `HomeBanner.jsx`.
    ok(
      'banners answers a list',
      res.data.length === 0 ? 'empty — the fixture art renders' : `${res.data.length} placement(s)`,
    );
  }
}

console.log('\nGET /user/spin-wheel/slices  (Promotions)');
{
  const res = await get(`${USER}/spin-wheel/slices`);

  if (res.error) {
    fail('spin wheel slices', res.error);
  } else if (!Array.isArray(res.data?.slices)) {
    fail('slices answers `{slices, disabled}`', `got ${JSON.stringify(res.data)?.slice(0, 80)}`);
  } else if (res.data.disabled) {
    ok('spin wheel', 'disabled by the operator — the page says so');
  } else if (res.data.slices.length === 0) {
    fail('spin wheel has segments', 'enabled with no slices — the page cannot draw a wheel');
  } else {
    ok('spin wheel slices', `${res.data.slices.length} segment(s)`);

    /**
     * The public route must NOT expose the weights. They are the odds, and a
     * client that had them could compute the house edge off the wheel.
     */
    const leaked = res.data.slices.filter((slice) => slice.weight !== undefined);
    if (leaked.length) fail('weights stay server-side', `${leaked.length} slice(s) expose one`);
    else ok('weights stay server-side', 'no `weight` on the public route');
  }
}

console.log('\nPlayer-scoped promotions  (must refuse an anonymous read)');
for (const [label, path_] of [
  ['GET /user/bonus', `${USER}/bonus`],
  ['GET /user/bonus/events', `${USER}/bonus/events`],
  ['GET /spin-wheel/eligibility', `${USER}/spin-wheel/eligibility`],
]) {
  const res = await get(path_, undefined);
  if (res.status === 404) fail(label, 'answered 404 — the route is not mounted');
  else if (res.error) ok(`${label} needs a token`, `${res.status}`);
  else fail(label, 'answered 200 without one');
}

// ── Result ─────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(70)}`);
if (failures) {
  console.log(`${red(`${failures} of ${checks} checks failed`)}\n`);
  process.exit(1);
}
console.log(`${green(`all ${checks} checks passed`)}\n`);
