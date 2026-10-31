'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildLegacyRewriter, EXACT, PATTERNS } = require('../legacyRoutes');

/**
 * Legacy path compatibility.
 *
 * A wrong rewrite silently sends a request somewhere unexpected, and some of
 * these paths move money — so the interesting cases are the ones where a
 * pattern could capture a path that belongs to something else.
 */

const rewrite = (() => {
  const rewriter = buildLegacyRewriter();
  return (method, url) => {
    const req = { method, url, originalUrl: url };
    rewriter(req, null, () => {});
    return req;
  };
})();

test('gateway legacy routes', async (t) => {
  await t.test('a parameterised legacy path is rewritten', async () => {
    // `GET /api/staff/1` answered `404 ... does not exist` while
    // `GET /api/v1/admin/staff/1` worked: the EXACT map is keyed on a literal
    // path and could not express the id segment.
    assert.equal(rewrite('GET', '/api/staff/1').url, '/api/v1/admin/staff/1');
    assert.equal(rewrite('PATCH', '/api/staff/1').url, '/api/v1/admin/staff/1');
    assert.equal(rewrite('DELETE', '/api/staff/1').url, '/api/v1/admin/staff/1');
    assert.equal(
      rewrite('GET', '/api/staff/1/percent-chain').url,
      '/api/v1/admin/staff/1/percent-chain'
    );
  });

  await t.test('`req.originalUrl` moves with `req.url`', async () => {
    // The proxy rebuilds the upstream path from `originalUrl` — Express strips
    // the mount prefix off `url` before the handler runs. Rewriting one and not
    // the other routes to the right service and then asks it for the legacy
    // path, which it does not have.
    const req = rewrite('GET', '/api/staff/1');
    assert.equal(req.originalUrl, '/api/v1/admin/staff/1');
    assert.equal(req.legacyPath, '/api/staff/1');
  });

  await t.test('a literal path is never captured by a pattern', async () => {
    // `/api/staff/:id` next to `/api/staff/tree` is the collision this table
    // has to survive. Parameters match digits only, and EXACT is checked first.
    assert.equal(rewrite('GET', '/api/staff/tree').url, '/api/v1/admin/staff/tree');
    assert.equal(rewrite('GET', '/api/staff/players').url, '/api/v1/admin/staff/players');
    assert.equal(rewrite('GET', '/api/staff/transactions').url, '/api/v1/admin/staff/transactions');
    assert.equal(
      rewrite('GET', '/api/staff/transfers/summary').url,
      '/api/v1/admin/staff/transfers/summary'
    );
    // Unmapped and non-numeric: passed through untouched rather than guessed at.
    assert.equal(rewrite('GET', '/api/staff/whoever').url, '/api/staff/whoever');
  });

  await t.test('a method is part of the key', async () => {
    assert.equal(rewrite('POST', '/api/staff/1').url, '/api/staff/1');
  });

  await t.test('the caller\'s query survives, and wins over the target\'s', async () => {
    // `${target}?${search}` produced a second `?`:
    // `/dashboard/today?kind=deposits?date=X` parses `kind` as `deposits?date=X`.
    assert.equal(
      rewrite('GET', '/today-deposits?date=2024-01-01').url,
      '/api/v1/admin/dashboard/today?kind=deposits&date=2024-01-01'
    );
    assert.equal(rewrite('GET', '/api/staff/1?x=1').url, '/api/v1/admin/staff/1?x=1');
  });

  await t.test('legacy `rollupStaff` keeps meaning the whole branch', async () => {
    // Three legacy handlers over one query. `rollupStaff` summed the subtree,
    // `metrics` and `rollup` the one account — now one route and a flag.
    assert.equal(
      rewrite('GET', '/api/staff/rollupStaff/1').url,
      '/api/v1/admin/staff/rollup/1?includeSubtree=true'
    );
    assert.equal(rewrite('GET', '/api/staff/metrics/1').url, '/api/v1/admin/staff/rollup/1');
    // A baked-in default is a default: an explicit ask still wins.
    assert.equal(
      rewrite('GET', '/api/staff/rollupStaff/1?includeSubtree=false').url,
      '/api/v1/admin/staff/rollup/1?includeSubtree=false'
    );
  });

  await t.test('a path parameter can become a query parameter', async () => {
    assert.equal(
      rewrite('GET', '/api/staff/transfers/summary/7?from=2024-01-01').url,
      '/api/v1/admin/staff/transfers/summary?staffId=7&from=2024-01-01'
    );
    // The bare `/transfers/:id` stays a path segment, and must not be swallowed
    // by the `summary` pattern above it.
    assert.equal(rewrite('GET', '/api/staff/transfers/7').url, '/api/v1/admin/staff/transfers/7');
  });

  await t.test('every mapping targets a versioned path', async () => {
    // A rewrite to something that is not `/api/v1/...` cannot reach a service:
    // the gateway routes by that prefix. A typo here would 404 in production
    // and nowhere else.
    for (const target of [...Object.values(EXACT), ...PATTERNS.map(([, to]) => to)]) {
      assert.ok(target.startsWith('/api/v1/'), `${target} does not start with /api/v1/`);
    }
  });

  await t.test('no pattern duplicates an EXACT key', async () => {
    // EXACT wins, so a duplicated key is dead code that reads as live routing.
    for (const [key] of PATTERNS) {
      assert.ok(!(key in EXACT), `${key} is in both EXACT and PATTERNS`);
    }
  });
});
