'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const publicRoutes = require('../routes/public.routes');

// Security (F3): every bet on an event, with usernames — the owner sees all, other staff only their own tree.
function scopeHandlers({ descendants, players }) {
  const calls = [];
  const deps = {
    config: {},
    logger: { error() {}, warn() {}, info() {} },
    clients: {
      admin: {
        get: async (url) => {
          calls.push(url);
          if (descendants instanceof Error) throw descendants;
          return { ids: descendants };
        },
      },
    },
    models: { Users: { findAll: async ({ where }) => players(where) } },
  };
  const router = publicRoutes(deps);
  const layer = router.stack.find((l) => l.route?.path === '/cricket/matched-bets/all');
  const [, staffOnly, staffTree] = layer.route.stack.map((s) => s.handle);
  return { staffOnly, staffTree, calls };
}

const run = async (handler, account) => {
  const req = { user: { account } };
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let nextArg = 'not called';
  await handler(req, res, (e) => { nextArg = e; });
  return { req, res, nextArg };
};

test('matched-bets/all: the owner is unscoped, staff get their tree, others are refused', async () => {
  const { staffOnly, staffTree, calls } = scopeHandlers({
    descendants: [40, 41],
    players: (where) => (String(where.parent_staff_id) === '40,41' ? [{ id: 7 }, { id: 9 }] : []),
  });

  const owner = await run(staffTree, { type: 'OWNER', id: 1 });
  assert.equal(owner.nextArg, undefined);
  assert.equal(owner.req.visibleUserIds, undefined);

  const agent = await run(staffTree, { type: 'STAFF', id: 40 });
  assert.equal(agent.nextArg, undefined);
  assert.deepEqual(agent.req.visibleUserIds, ['7', '9']);
  assert.match(calls[0], /\/staff\/40\/descendants$/);

  assert.equal((await run(staffTree, { type: 'EXECUTIVE', id: 3 })).res.statusCode, 403);
  assert.equal((await run(staffOnly, { type: 'USER', id: 7 })).res.statusCode, 403);
});

test('matched-bets/all fails closed when the staff tree cannot be resolved', async () => {
  const { staffTree } = scopeHandlers({ descendants: new Error('admin down'), players: () => [] });
  const r = await run(staffTree, { type: 'STAFF', id: 40 });
  assert.ok(r.nextArg instanceof Error);
  assert.equal(r.nextArg.statusCode ?? r.nextArg.status, 503);
  assert.equal(r.req.visibleUserIds, undefined);
});

test('getMatchedBetsByEvent filters user_id by the route scope', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../odds-events/controllers/cricketController.mjs'), 'utf8');
  const fn = src.slice(src.indexOf('getMatchedBetsByEvent:'), src.indexOf('getOpenBetsByEvent:'));
  assert.match(fn, /Array\.isArray\(req\.visibleUserIds\) \? \{ user_id: \{ \[Op4\.in\]: req\.visibleUserIds \} \} : \{\}/);
});
