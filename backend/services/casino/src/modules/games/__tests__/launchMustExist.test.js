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
