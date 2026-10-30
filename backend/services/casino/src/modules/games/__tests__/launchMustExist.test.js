'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { requireGameEntitled } = require('../gameEntitlement');

const none = { findOne: async () => null };
const run = (guard, gameUuid) =>
  new Promise((resolve) => guard({ body: { gameUuid } }, {}, (err) => resolve(err ?? null)));

test('launch guard: a uid that is in no live catalogue (parked or invented) is refused before upstream', async () => {
  const guard = requireGameEntitled({ models: { Gisgamesnew: none, JsGames: none }, config: {} }, (req) => ({ uid: req.body.gameUuid }), { mustExist: true });
  const err = await run(guard, 'parked-or-made-up-uid');
  assert.equal(err?.code, 'GAMES_NOT_FOUND');
  assert.equal(err?.status, 404);
});

test("book launch: refused while the site admin's Sports switch is off, even with the owner's sports + sportsbook on", async (t) => {
  const { entitlements } = require('@ibitplay/common');
  entitlements.configureEntitlements({ read: () => ({ features: {}, flags: { sports: true, sportsbook: true }, version: 1, fetchedAt: null, source: 'owner' }) });
  t.after(() => entitlements.resetEntitlements());
  const admin = (sportsOff) => ({ get: async () => ({ data: { sports_off: sportsOff } }) });
  const guardWith = (sportsOff) =>
    requireGameEntitled({ models: { Gisgamesnew: none, JsGames: none }, config: {}, clients: { admin: admin(sportsOff) } }, (req) => ({ uid: req.body.gameUuid }), { mustExist: true });
  const luckySports = '8a704858d5deb4af1ddc722092ac7614';

  const off = await run(guardWith(true), luckySports);
  assert.equal(off?.code, 'FEED_SPORTS_DISABLED');
  assert.equal(off?.status, 503);
  assert.equal(await run(guardWith(false), luckySports), null);
});
