'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { loadModules, mountModules } = require('@ibitplay/common');

const { buildLegacyRewriter } = require('../../../../../../gateway/src/legacyRoutes');

/**
 * The mssports API contract.
 *
 * services/sports runs the sportsbook exported from TENEXCH (mssports) and keeps its API: every
 * route its three `api/*.api.js` files mounted, with the same method and path, still answers —
 * the TENEXCH path is rewritten by the gateway onto the route this service mounts.
 *
 * TENEXCH_ROUTES is that list, read off the export's own routers (69 routes). A route that stops
 * being mounted, or a gateway rewrite that stops reaching it, fails here.
 */
const TENEXCH_ROUTES = [
  'GET /api/user/all/sports/tree',
  'GET /api/user/all/sports/events',
  'POST /api/user/cricket/all-data',
  'POST /api/user/cricket/get-sport-data-by-id',
  'POST /api/user/cricket/get-match-private-data',
  'GET /api/user/v1/sports-get_latest_events',
  'GET /api/user/v1/sports-gamedetailPrivate',
  'POST /api/user/cricket/market-list',
  'POST /api/user/cricket/score-card',
  'GET /api/user/cricket/score-url',
  'GET /api/user/virtual/event-media',
  'GET /api/user/virtual/cricketv-cards',
  'GET /api/user/betting-config',
  'GET /api/user/bet-limits/:event_id',
  'GET /api/user/stake-button-values',
  'POST /api/user/stake-button-values',
  'GET /api/user/buttonlist',
  'POST /api/user/updatebuttonlist',
  'POST /api/user/place',
  'GET /api/user/bet-result/:client_ref',
  'POST /api/user/place-combined',
  'POST /api/user/cancel-bet',
  'POST /api/user/matchexposures/match',
  'GET /api/user/fancy-bets',
  'GET /api/user/cricket/sports-bets/user',
  'GET /api/user/cricket/user-open-bets',
  'GET /api/user/cricket/user-open-bets-grouped',
  'GET /api/user/cricket/matched-bets/all',
  'POST /api/user/account-statement-v2',
  'POST /api/user/account-statement-v2/bets',
  'GET /api/internalsettle/momatches',
  'GET /api/internalsettle/fanmatches',
  'POST /api/internalsettle/declareresult',
  'POST /api/internalsettle/void',
  'GET /api/internalsettle/open-bets',
  'POST /api/internalsettle/void-single-bet',
  'GET /api/internalsettle/settled-markets',
  'GET /api/internalsettle/settled-bets',
  'POST /api/internalsettle/void-bet-after-settlement',
  'POST /api/internalsettle/void-market-after-settlement',
  'GET /api/admin/sports-lock/get/:targetId',
  'POST /api/admin/sports-lock/update',
  'GET /api/admin/betlock/market-locks/:event_id',
  'POST /api/admin/betlock/toggle-market-lock',
  'POST /api/admin/betlock/bulk-toggle-market-lock',
  'GET /api/admin/betting-config/buffer/sports',
  'POST /api/admin/betting-config/buffer/sports',
  'POST /api/admin/betting-config/buffer/sports/bulk',
  'DELETE /api/admin/betting-config/buffer/sports',
  'GET /api/admin/betting-config/bet-limits/inplay',
  'GET /api/admin/betting-config/bet-limits/event/:event_id',
  'POST /api/admin/betting-config/bet-limits/event',
  'DELETE /api/admin/betting-config/bet-limits/event/:id',
  'GET /api/admin/betting-config/max-odds/sports',
  'POST /api/admin/betting-config/max-odds/sports',
  'DELETE /api/admin/betting-config/max-odds/sports',
  'GET /api/admin/betting-config/auto-void',
  'PUT /api/admin/betting-config/auto-void',
  'GET /api/admin/betting-config/auto-void/tracker',
  'GET /api/admin/betting-config/auto-void/links',
  'POST /api/admin/betting-config/auto-void/links',
  'PUT /api/admin/betting-config/auto-void/links/:id',
  'DELETE /api/admin/betting-config/auto-void/links/:id',
  'GET /api/admin/betting-config/virtual-limits',
  'PUT /api/admin/betting-config/virtual-limits',
  'GET /api/admin/commission-config/sports',
  'POST /api/admin/commission-config/sports',
  'POST /api/admin/commission-config/sports/bulk',
  'DELETE /api/admin/commission-config/sports',
];

/**
 * Routes these modules mount on top of the TENEXCH contract, as mounted paths. Each is deliberate:
 * - account-statement-direct: the statement of a player with no parent (point_ledger_direct).
 */
const LOCAL_EXTRA_ROUTES = [
  'POST /api/v1/sports/user/account-statement-direct',
];

const MSSPORTS_MODULES =['odds-events', 'bets', 'statement', 'settlement', 'sports-config'];

/** Every route the mssports modules mount, as { method, path, regex }. */
function mountedRoutes() {
  const passthrough = (_req, _res, next) => next();
  const modules = loadModules(path.resolve(__dirname, '../..')).filter((m) => MSSPORTS_MODULES.includes(m.name));
  const root = mountModules({
    modules,
    deps: { config: {}, logger: { info() {}, warn() {}, debug() {}, error() {} }, clients: { admin: {} }, auth: { requirePermission: () => passthrough } },
    guards: { public: [], user: [passthrough], admin: [passthrough], internal: [passthrough] },
  });

  const routes = [];
  const walk = (stack, prefix) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          const full = `${prefix}${layer.route.path}`;
          const source = full.split('/').map((s) => (s.startsWith(':') ? '[^/]+' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/');
          routes.push({ method: method.toUpperCase(), path: full, regex: new RegExp(`^${source}$`) });
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, prefix + mountPathOf(layer));
      }
    }
  };
  walk(root.stack, '');
  return routes;
}

/** The literal path an Express `use()` layer was mounted at. */
function mountPathOf(layer) {
  if (layer.regexp.fast_slash) return '';
  const match = /^\^((?:\\\/[^\\?()]+)+)\\\/\?\(\?=\\\/\|\$\)$/i.exec(layer.regexp.source);
  if (!match) throw new Error(`unexpected mount regexp ${layer.regexp.source}`);
  return match[1].replace(/\\\//g, '/').replace(/\\(.)/g, '$1');
}

test('mssports API — every TENEXCH route is mounted', () => {
  const routes = mountedRoutes();
  assert.strictEqual(routes.length, TENEXCH_ROUTES.length + LOCAL_EXTRA_ROUTES.length, 'mounted route count');
  const mounted = new Set(routes.map((r) => `${r.method} ${r.path}`));
  assert.deepStrictEqual(LOCAL_EXTRA_ROUTES.filter((r) => !mounted.has(r)), [], 'every listed extra route is mounted');
  assert.strictEqual(new Set(TENEXCH_ROUTES).size, TENEXCH_ROUTES.length, 'the contract has no duplicates');
});

test('mssports API — the gateway takes every TENEXCH path to the route that serves it', () => {
  const routes = mountedRoutes();
  const rewrite = buildLegacyRewriter();
  const unreached = [];
  const served = new Set();

  for (const entry of TENEXCH_ROUTES) {
    const [method, tenexchPath] = entry.split(' ');
    const concrete = tenexchPath.replace(/:[A-Za-z_]+/g, '4021');
    const req = { method, url: `${concrete}?q=1` };
    rewrite(req, {}, () => {});
    const [rewritten] = req.url.split('?');
    const hit = routes.find((r) => r.method === method && r.regex.test(rewritten));
    if (!hit) unreached.push(`${entry} → ${rewritten}`);
    else served.add(`${hit.method} ${hit.path}`);
  }

  assert.deepStrictEqual(unreached, [], 'TENEXCH paths that reach no mounted route');
  assert.strictEqual(served.size, TENEXCH_ROUTES.length, 'each TENEXCH route reaches its own mounted route');
});

test('mssports API — the path under /api/v1 keeps the TENEXCH tail', () => {
  const routes = mountedRoutes().map((r) => `${r.method} ${r.path}`);
  const tail = (p) => p
    .replace(/^\/api\/v1\/sports\/user\//, 'user/')
    .replace(/^\/api\/v1\/admin\/sports\/internalsettle\//, 'internalsettle/')
    .replace(/^\/api\/v1\/admin\/sports\/config\//, 'admin/')
    .replace(/^\/api\/(user|internalsettle|admin)\//, '$1/');
  const ours = new Set(routes.map((r) => { const [m, p] = r.split(' '); return `${m} ${tail(p)}`; }));
  const theirs = TENEXCH_ROUTES.map((r) => { const [m, p] = r.split(' '); return `${m} ${tail(p)}`; });
  assert.deepStrictEqual(theirs.filter((r) => !ours.has(r)), []);
});
