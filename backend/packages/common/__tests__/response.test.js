'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { response } = require('../src');

/**
 * The response envelope.
 *
 * This file exists because of `paginated`. Its signature took Sequelize's
 * `findAndCountAll` output, nearly every call site passed the rows array plus a
 * `total`, and the mismatch produced a 200 with `data: []` — no error, no log
 * line, just a page of nothing. Silent wrong answers are the ones worth a test.
 */

/** Enough of an Express response to capture what would have been sent. */
const capture = () => {
  const sent = {};
  return {
    sent,
    status(code) {
      sent.status = code;
      return this;
    },
    json(body) {
      sent.body = body;
      return this;
    },
    end() {
      sent.ended = true;
      return this;
    },
  };
};

test('response.paginated', async (t) => {
  await t.test('an ARRAY of rows plus an explicit total — the common call shape', () => {
    /**
     * This is what ~50 call sites across the four services pass. Before the
     * fix it answered `data: []`, `total: 0`, with the rows right there in the
     * argument list.
     */
    const res = capture();
    response.paginated(res, [{ id: 1 }, { id: 2 }], { page: 1, limit: 20, total: 57 });

    assert.equal(res.sent.status, 200);
    assert.deepEqual(res.sent.body.data, [{ id: 1 }, { id: 2 }]);
    assert.equal(res.sent.body.meta.pagination.total, 57);
    assert.equal(res.sent.body.meta.pagination.totalPages, 3);
    assert.equal(res.sent.body.meta.pagination.hasNext, true);
    assert.equal(res.sent.body.meta.pagination.hasPrev, false);
  });

  await t.test('findAndCountAll output — the original shape, still honoured', () => {
    const res = capture();
    response.paginated(res, { rows: [{ id: 3 }], count: 9 }, { page: 2, limit: 5 });

    assert.deepEqual(res.sent.body.data, [{ id: 3 }]);
    assert.equal(res.sent.body.meta.pagination.total, 9);
    assert.equal(res.sent.body.meta.pagination.hasPrev, true);
  });

  await t.test('an array with no total counts the rows in hand', () => {
    /**
     * Not merely a default: a zero here would contradict the rows in the very
     * same response, and a client trusting `total` would render an empty list
     * over data it was given.
     */
    const res = capture();
    response.paginated(res, [{ id: 4 }, { id: 5 }, { id: 6 }], { page: 1, limit: 20 });

    assert.equal(res.sent.body.data.length, 3);
    assert.equal(res.sent.body.meta.pagination.total, 3);
  });

  await t.test('an explicit total wins over count when both are given', () => {
    // A caller who passes `total` has said what the total is.
    const res = capture();
    response.paginated(res, { rows: [{ id: 7 }], count: 1 }, { page: 1, limit: 20, total: 400 });
    assert.equal(res.sent.body.meta.pagination.total, 400);
  });

  await t.test('nothing at all is an empty page, not a crash', () => {
    const res = capture();
    response.paginated(res, null, { page: 1, limit: 20 });
    assert.deepEqual(res.sent.body.data, []);
    assert.equal(res.sent.body.meta.pagination.total, 0);
    assert.equal(res.sent.body.meta.pagination.totalPages, 0);
  });

  await t.test('extra meta rides alongside the pagination block', () => {
    const res = capture();
    response.paginated(res, [], { page: 1, limit: 20, total: 0 }, { currency: 'INR' });
    assert.equal(res.sent.body.meta.currency, 'INR');
    assert.ok(res.sent.body.meta.pagination);
  });
});

test('response envelopes', async (t) => {
  await t.test('every success carries success:true and a data key', () => {
    for (const [fn, status] of [
      [response.ok, 200],
      [response.created, 201],
      [response.accepted, 202],
    ]) {
      const res = capture();
      fn(res, { hello: 'world' });
      assert.equal(res.sent.status, status);
      assert.equal(res.sent.body.success, true);
      assert.deepEqual(res.sent.body.data, { hello: 'world' });
    }
  });

  await t.test('a failure carries success:false and a code', () => {
    const res = capture();
    response.fail(res, 422, 'BANNERS_BAD_IMAGE', 'That is not an image', { got: 'text/html' });
    assert.equal(res.sent.status, 422);
    assert.equal(res.sent.body.success, false);
    assert.equal(res.sent.body.error.code, 'BANNERS_BAD_IMAGE');
    assert.deepEqual(res.sent.body.error.details, { got: 'text/html' });
  });

  await t.test('details are omitted rather than sent as undefined', () => {
    const res = capture();
    response.fail(res, 404, 'NOT_FOUND', 'Nope');
    assert.equal('details' in res.sent.body.error, false);
  });
});
