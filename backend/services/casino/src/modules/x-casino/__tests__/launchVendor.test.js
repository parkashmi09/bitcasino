'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { catalogued } = require('../routes/user.routes');

const run = (models, body) =>
  new Promise((resolve) => {
    const req = { body };
    catalogued({ models })(req, {}, (err) => resolve({ err: err ?? null, req }));
  });

test('x-casino launch: the vendor comes from our apigames row, not the client', async () => {
  const Apigames = { findOne: async ({ where }) => (where.id === 42 && where.enabled === 1 ? { vendor: 'evolution', type: 'live' } : null) };

  const { err, req } = await run({ Apigames }, { gameId: 42, vendor: 'spribe' });
  assert.equal(err, null);
  assert.equal(req.body.vendor, 'evolution');

  const unknown = await run({ Apigames }, { gameId: 7, vendor: 'evolution' });
  assert.equal(unknown.err?.code, 'GAMES_NOT_FOUND');
  assert.equal(unknown.err?.status, 404);
});
