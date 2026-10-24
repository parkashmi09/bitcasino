'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { createLogger, entitlements, errorHandler, requestContext } = require('@ibitplay/common');

/**
 * Player routes outside the owner's plan answer 403 NOT_ENTITLED — docs/OWNER-PANEL.md §4.
 * Each router is mounted on its own with a fake container; nothing reaches a database or
 * a provider, because the guard answers first (and with the plan open, the assertion is
 * only that the guard stepped aside).
 */

const logger = createLogger({ name: 'player-guards-test', level: 'silent' });
const SERVICES = '../../../../..';

const plan = (features = {}, flags = {}) =>
  entitlements.configureEntitlements({ read: () => ({ features, flags, version: 1, fetchedAt: null, source: 'owner' }) });

/** Catalogue rows the launch guard looks games up in. */
const GAMES = {
  'slot-uid': { provider: 'pgsoft', type: 'Slot Game' },
  'live-uid': { provider: 'evolution', type: 'CasinoLive' },
  '4ee8e0051a035b463b47c3c473ce317d': { provider: 'esports', type: 'ESports' },
};
const models = {
  Gisgamesnew: { findOne: async ({ where }) => GAMES[where.uuid] ?? null },
  JsGames: { findOne: async () => null },
};

const deps = {
  models,
  db: { sequelize: {} },
  logger,
  config: { RATE_LIMIT_ENABLED: false },
  clients: { admin: { get: async () => ({ sportsEnabled: true }) }, user: {} },
  cache: {},
  wallet: {},
};

async function mount(t, routerPath) {
  const app = express();
  app.use(express.json());
  app.use(requestContext());
  // The loader's player guard, faked: these routes always run signed in.
  app.use((req, _res, next) => { req.user = { id: 1 }; next(); });
  app.use('/', require(`${SERVICES}/${routerPath}`)(deps));
  app.use(errorHandler({ logger }));
  const server = app.listen(0);
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, code: json?.error?.code, details: json?.error?.details };
  };
}

const refused = (r, kind, key) => {
  assert.equal(r.status, 403, `expected 403, got ${r.status} ${r.code}`);
  assert.equal(r.code, 'NOT_ENTITLED');
  assert.equal(r.details?.kind, kind);
  assert.equal(r.details?.key, key);
};

test('player guards', async (t) => {
  t.after(() => entitlements.resetEntitlements());

  await t.test('casino sportsbook session: init and refresh need `sports`', async () => {
    const call = await mount(t, 'casino/src/modules/sportsbook/routes/user.routes');
    plan({}, { sports: false });
    refused(await call('POST', '/init', {}), 'flag', 'sports');
    refused(await call('POST', '/refresh', {}), 'flag', 'sports');
    plan({});
    assert.notEqual((await call('POST', '/init', {})).code, 'NOT_ENTITLED');
  });

  await t.test('native sports bets: placing needs `sports`', async () => {
    // The mssports sportsbook: both placement routes, refused before its own auth runs.
    const call = await mount(t, 'sports/src/modules/bets/routes/public.routes');
    plan({}, { sports: false });
    refused(await call('POST', '/place', {}), 'flag', 'sports');
    refused(await call('POST', '/place-combined', {}), 'flag', 'sports');
  });

  await t.test('game launch: books need `sports`, games need `casino` and their provider and category', async () => {
    const call = await mount(t, 'casino/src/modules/js-games/routes/user.routes');
    const launch = (gameUid) => call('POST', '/v2/launch', { gameUid, currencyCode: 'INR' });

    // Sports off: the esports book and the LuckySports book (not in any table) are refused…
    plan({}, { sports: false });
    refused(await launch('4ee8e0051a035b463b47c3c473ce317d'), 'flag', 'sports');
    refused(await launch('8a704858d5deb4af1ddc722092ac7614'), 'flag', 'sports');
    // …and a slot is not a sport.
    assert.notEqual((await launch('slot-uid')).code, 'NOT_ENTITLED');

    // Casino off: every game, known or not — but the books still open.
    plan({}, { casino: false });
    refused(await launch('slot-uid'), 'flag', 'casino');
    refused(await launch('unknown-uid'), 'flag', 'casino');
    assert.notEqual((await launch('4ee8e0051a035b463b47c3c473ce317d')).code, 'NOT_ENTITLED');

    // A provider or a category outside the plan.
    plan({}, { evolution: false });
    refused(await launch('live-uid'), 'flag', 'evolution');
    plan({}, { slotsgames: false });
    refused(await launch('slot-uid'), 'flag', 'slotsgames');
  });

  await t.test('gis launch is guarded the same way', async () => {
    const call = await mount(t, 'casino/src/modules/gis/routes/user.routes');
    plan({}, { pgsoft: false });
    refused(await call('POST', '/launch-demo', { gameUuid: 'slot-uid' }), 'flag', 'pgsoft');
  });

  for (const [routerPath, method, path, feature, flag] of [
    ['user/src/modules/bonus/routes/user.routes', 'POST', '/redeem', 'bonus', 'bonus'],
    ['user/src/modules/spin-wheel/routes/user.routes', 'POST', '/spin', 'spin_wheel', 'wheelspin'],
    ['user/src/modules/race/routes/user.routes', 'GET', '/rewards', 'races', null],
    ['user/src/modules/vip/routes/user.routes', 'GET', '/', 'vip', 'vipclub'],
    ['user/src/modules/affiliate/routes/user.routes', 'POST', '/rewards/claim-all', 'affiliate', 'affiliate'],
    ['user/src/modules/club/routes/user.routes', 'GET', '/me', 'club_membership', 'clubmembership'],
    ['user/src/modules/gift-cards/routes/user.routes', 'POST', '/claim', 'gift_cards', 'giftcards'],
    ['user/src/modules/tip/routes/user.routes', 'POST', '/send', 'tips', null],
    ['user/src/modules/tip/routes/user.routes', 'GET', '/users?q=ab', 'tips', null],
    ['user/src/modules/p2p/routes/user.routes', 'GET', '/offers', 'p2p', null],
    ['user/src/modules/p2p/routes/user.routes', 'POST', '/orders', 'p2p', null],
  ]) {
    await t.test(`${feature}: refused by the feature${flag ? ' and by its product flag' : ''}`, async () => {
      const call = await mount(t, routerPath);
      plan({ [feature]: false });
      refused(await call(method, path, {}), 'feature', feature);
      if (flag) {
        plan({}, { [flag]: false });
        refused(await call(method, path, {}), 'flag', flag);
      }
    });
  }

  await t.test('p2p: the staff routes are refused with the player ones', async () => {
    const allow = () => (_req, _res, next) => next();
    const adminDeps = { ...deps, auth: { requirePermission: allow }, clients: { ...deps.clients, admin: { post: async () => ({}) } }, config: { SERVICE_NAME: 'user' } };
    const app = express();
    app.use(express.json());
    app.use(requestContext());
    app.use(require(`${SERVICES}/user/src/modules/p2p/routes/admin.routes`)(adminDeps));
    app.use(errorHandler({ logger }));
    const server = app.listen(0);
    t.after(() => server.close());
    const base = `http://127.0.0.1:${server.address().port}`;
    plan({ p2p: false });
    for (const [method, path] of [['GET', '/orders'], ['POST', '/orders/1/release'], ['GET', '/payment-types']]) {
      const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
      const json = await res.json();
      refused({ status: res.status, code: json?.error?.code, details: json?.error?.details }, 'feature', 'p2p');
    }
  });
});
