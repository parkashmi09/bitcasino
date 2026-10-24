'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { LEVEL_PERMISSIONS } = require('@ibitplay/auth');
const { createControllers: bannerControllers } = require('../controllers');
const { createControllers: blogControllers } = require('../../blogs/controllers');

/**
 * Inactive banners and draft blog posts used to go to ANY staff token
 * (`Boolean(req.staff)`), so an AGENT (level 6) could list content the house
 * had taken down or not yet published. Only staff with the content grant's
 * read variant (`config:read`; the writes need `config:write`) see them now —
 * everyone else gets the public view.
 */

const staffAt = (level) => ({ id: 1, level, permissions: LEVEL_PERMISSIONS[level] });

function capture() {
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set() { return this; },
    send() { return this; },
    end() { return this; },
  };
  return { res };
}

async function run(handler, req) {
  const { res } = capture();
  await new Promise((resolve, reject) => {
    const next = (err) => (err ? reject(err) : resolve());
    Promise.resolve(handler(req, res, next)).then(resolve, reject);
  });
  return res;
}

test('banners: inactive only for staff with config:read', async () => {
  const calls = [];
  const service = {
    list: async (args) => { calls.push(['list', args.includeInactive]); return { rows: [], total: 0 }; },
    listWithImages: async (args) => { calls.push(['binary', args.includeInactive]); return { rows: [], total: 0 }; },
    byType: async (args) => { calls.push(['byType', args.includeInactive]); return {}; },
  };
  const ctrl = bannerControllers({ service });

  const cases = [
    [undefined, false],      // anonymous
    [staffAt(6), false],     // AGENT
    [staffAt(5), false],     // MASTER
    [staffAt(4), false],     // SUPER_MASTER
    [staffAt(3), true],      // SUB_ADMIN holds config:read
    [staffAt(2), true],
    [staffAt(1), true],
  ];
  for (const [staff, expected] of cases) {
    calls.length = 0;
    const query = { includeInactive: true };
    await run(ctrl.list, { staff, query, params: {} });
    await run(ctrl.listWithImages, { staff, query, params: {} });
    await run(ctrl.byType, { staff, query: {}, params: { type: 'hero' } });
    assert.equal(calls.length, 3);
    for (const [name, value] of calls) {
      assert.equal(Boolean(value), expected, `${name} level ${staff?.level ?? 'anon'}`);
    }
  }
});

test('blogs: drafts only for staff with config:read', async () => {
  const calls = [];
  const service = {
    list: async (args) => { calls.push(['list', args.includeUnpublished]); return { rows: [], total: 0 }; },
    bySlug: async (args) => { calls.push(['bySlug', args.includeUnpublished]); return {}; },
    byId: async (args) => { calls.push(['byId', args.includeUnpublished]); return {}; },
  };
  const ctrl = blogControllers({ service });

  for (const [staff, expected] of [[undefined, false], [staffAt(6), false], [staffAt(4), false], [staffAt(3), true], [staffAt(1), true]]) {
    calls.length = 0;
    await run(ctrl.list, { staff, query: { page: 1, limit: 10 }, params: {} });
    await run(ctrl.bySlug, { staff, query: {}, params: { slug: 'x' } });
    await run(ctrl.byId, { staff, query: {}, params: { id: 1 } });
    assert.equal(calls.length, 3);
    for (const [name, value] of calls) {
      assert.equal(value, expected, `${name} level ${staff?.level ?? 'anon'}`);
    }
  }
});
