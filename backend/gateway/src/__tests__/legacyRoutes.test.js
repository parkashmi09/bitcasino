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
    // The EXACT map is keyed on a literal path and cannot express an id segment.
    assert.equal(rewrite('GET', '/api/admin/user-risk/1').url, '/api/v1/admin/reports/user-risk/1');
    // A widened parameter (`:name(<regex>)`) takes more than digits.
    assert.equal(rewrite('GET', '/api/user/bet-result/ab.1:x').url, '/api/v1/sports/user/bet-result/ab.1:x');
  });

  await t.test('`req.originalUrl` moves with `req.url`', async () => {
    // The proxy rebuilds the upstream path from `originalUrl` — Express strips
    // the mount prefix off `url` before the handler runs. Rewriting one and not
    // the other routes to the right service and then asks it for the legacy
    // path, which it does not have.
    const req = rewrite('GET', '/api/admin/user-risk/1');
    assert.equal(req.originalUrl, '/api/v1/admin/reports/user-risk/1');
    assert.equal(req.legacyPath, '/api/admin/user-risk/1');
  });

  await t.test('a non-numeric segment is not captured by a digits pattern', async () => {
    // Unmapped and non-numeric: passed through untouched rather than guessed at.
    assert.equal(rewrite('GET', '/api/admin/user-risk/whoever').url, '/api/admin/user-risk/whoever');
  });

  await t.test('a method is part of the key', async () => {
    assert.equal(rewrite('POST', '/api/admin/user-risk/1').url, '/api/admin/user-risk/1');
  });

  await t.test('the caller\'s query survives, and wins over the target\'s', async () => {
    // `${target}?${search}` produced a second `?`:
    // `/dashboard/today?kind=deposits?date=X` parses `kind` as `deposits?date=X`.
    assert.equal(
      rewrite('GET', '/today-deposits?date=2024-01-01').url,
      '/api/v1/admin/dashboard/today?kind=deposits&date=2024-01-01'
    );
    assert.equal(rewrite('GET', '/api/admin/user-risk/1?x=1').url, '/api/v1/admin/reports/user-risk/1?x=1');
  });

  await t.test('the removed outside agent system is no longer rewritten', async () => {
    // Staff list / tree / detail / rollup hata diye — sirf password aur transfer bache.
    for (const path of ['/api/staff', '/api/staff/tree', '/api/staff/1', '/api/staff/rollupStaff/1', '/api/admin/agent-users']) {
      assert.equal(rewrite('GET', path).url, path);
    }
    assert.equal(rewrite('POST', '/api/staff/transfer').url, '/api/v1/admin/staff/transfer');
    assert.equal(rewrite('PATCH', '/api/staff/password').url, '/api/v1/admin/staff/password');
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
