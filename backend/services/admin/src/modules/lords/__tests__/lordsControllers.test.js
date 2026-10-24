'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createControllers } = require('../controllers');

/**
 * The agent listing's RESPONSE SHAPE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AT ALL
 *
 * `allDetails` used to hand-roll legacy's envelope —
 * `{status: 'success', users, totalPages, totalCount}` — while every other
 * list on the platform answered `{success, data, meta.pagination}`. The panel
 * was later moved onto `apiFetchPage`, which reads the platform envelope, and
 * this endpoint was not moved with it.
 *
 * Nothing failed. The request was a 200, the body carried three agents, and
 * `apiFetchPage` found no `data` key and returned its `[]` default — so the
 * table rendered "No agents found" with the rows visible in the network tab.
 * A shape mismatch between a server and its only client is silent by nature,
 * which is exactly the kind of thing worth a test.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Drive one controller and return the `res` it wrote.
 *
 * `asyncHandler` swallows the promise and forwards a throw to `next`, so the
 * settle signal is the write itself — resolving on `res.json` rather than on a
 * timer is what keeps this from passing on an empty `res`.
 */
const run = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = { statusCode: null, body: null };
    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (payload) => {
      res.body = payload;
      resolve(res);
      return res;
    };

    handler(req, res, (error) => reject(error || new Error('next() with no error')));
  });

test('the agent listing answers in the platform envelope', async (t) => {
  const rows = [
    { id: 4, username: 'agent001', account_type: 'STAFF' },
    { id: 8, username: 'agent002', account_type: 'STAFF' },
  ];

  const service = { allDetails: async () => ({ rows, total: 57 }) };
  const ctrl = createControllers({ service, clients: {} });

  const req = {
    staff: { id: 1, level: 0 },
    query: { limit: 25, offset: 25 },
  };

  await t.test('the rows are under `data`, not `users`', async () => {
    const res = await run(ctrl.allDetails, req);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.data, rows);
    assert.ok(!('users' in res.body), 'legacy key gone — the panel reads `data`');
    assert.ok(!('status' in res.body), 'and the legacy status string with it');
  });

  await t.test('the count is under `meta.pagination`, and the page is derived from the offset', async () => {
    const res = await run(ctrl.allDetails, req);
    const { pagination } = res.body.meta;

    // offset 25 at limit 25 is the second page — the panel pages by number and
    // the server by offset, so this conversion is the one place they meet.
    assert.equal(pagination.page, 2);
    assert.equal(pagination.limit, 25);
    assert.equal(pagination.total, 57, 'the total is the SUBTREE total, not the rows in hand');
    assert.equal(pagination.totalPages, 3);
    assert.equal(pagination.hasNext, true);
    assert.equal(pagination.hasPrev, true);
  });

  await t.test('the caller is the connection’s staff, never the query', async () => {
    const seen = [];
    const spy = {
      allDetails: async (args) => {
        seen.push(args);
        return { rows: [], total: 0 };
      },
    };

    await run(createControllers({ service: spy, clients: {} }).allDetails, {
      staff: { id: 42, level: 3 },
      // A client naming somebody else's subtree. `parentId` reaches the service,
      // which checks it against the caller's descendants — but the ACTOR is not
      // negotiable, and that is what scopes the read.
      query: { limit: 25, offset: 0, parentId: 99 },
    });

    assert.equal(seen[0].actor.id, 42);
    assert.equal(seen[0].actor.canIssueFunds, false, 'level 3 is not the house');
  });
});
