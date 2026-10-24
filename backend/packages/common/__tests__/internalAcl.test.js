'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

const { isInternalCallAllowed, KNOWN_SERVICES, resolveInternalKey } = require('../src/internalAcl');
const { internalAuth, collectServiceKeys } = require('../src/middleware/internalAuth');
const { errorHandler } = require('../src/middleware/errorHandler');

/**
 * Service-to-service authorization.
 *
 * Before this, one `INTERNAL_API_KEY` was shared by every service, so
 * `internalAuth` could only ask "is this THE key" — and the answer was yes for
 * all four. Any service could call any internal endpoint on any other,
 * including `POST /internal/user/wallet/credit`, which mints balance. The
 * caller's name came from a header it wrote itself, and that name was recorded
 * on audit rows as who moved the money.
 */

const silent = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * Every server started by `serve`, closed in `after` regardless of outcome.
 *
 * A failed assertion skips the `close()` at the end of a test, and one leaked
 * listener keeps the whole test file alive forever.
 */
const openServers = new Set();

const KEYS = {
  'user-service': 'u'.repeat(48),
  'admin-service': 'a'.repeat(48),
  'casino-service': 'c'.repeat(48),
  'sports-service': 's'.repeat(48),
};
const SHARED = 'shared'.repeat(8);

const fullConfig = {
  INTERNAL_API_KEY: SHARED,
  INTERNAL_KEY_USER_SERVICE: KEYS['user-service'],
  INTERNAL_KEY_ADMIN_SERVICE: KEYS['admin-service'],
  INTERNAL_KEY_CASINO_SERVICE: KEYS['casino-service'],
  INTERNAL_KEY_SPORTS_SERVICE: KEYS['sports-service'],
};

/** An app whose single route reports what the guard decided. */
async function serve(config) {
  const app = express();
  app.use('/internal', internalAuth(SHARED, { config, logger: silent }));
  // Express 4 wildcard. `'/internal/*splat'` is Express 5 syntax and matches
  // nothing here, which turned every assertion into a 404 — and, because a
  // thrown assertion skipped the close below, left the server holding the
  // event loop open so the file never exited.
  app.get('/internal/*', (req, res) =>
    res.json({ caller: req.internalCaller, verified: req.internalCallerVerified })
  );
  app.use(errorHandler({ logger: silent }));

  const server = http.createServer(app);
  openServers.add(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    call: (path, key, claimed) =>
      fetch(`${base}${path}`, {
        headers: {
          ...(key ? { 'x-internal-key': key } : {}),
          ...(claimed ? { 'x-internal-service': claimed } : {}),
        },
      }),
    close: () => {
      openServers.delete(server);
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Belt and braces: nothing survives the file. */
test.after(() => {
  for (const server of openServers) server.close();
  openServers.clear();
});

test('the internal ACL table', async (t) => {
  await t.test('the wallet is reachable only by the services that pay out bets', () => {
    /**
     * The finding this exists for. casino and sports credit winnings; admin
     * and user do not, and never did — nothing said so before.
     */
    for (const caller of ['casino-service', 'sports-service']) {
      assert.equal(
        isInternalCallAllowed(caller, '/internal/user/wallet/credit').allowed,
        true,
        `${caller} pays out bets and must reach the wallet`
      );
    }

    for (const caller of ['admin-service', 'user-service']) {
      assert.equal(
        isInternalCallAllowed(caller, '/internal/user/wallet/credit').allowed,
        false,
        `${caller} must NOT be able to mint balance`
      );
      assert.equal(isInternalCallAllowed(caller, '/internal/user/wallet/debit').allowed, false);
      assert.equal(isInternalCallAllowed(caller, '/internal/user/wallet/transfer').allowed, false);
    }
  });

  await t.test('staff wallet adjustments are unaffected', () => {
    /**
     * Worth asserting because it is the obvious worry. Operators adjust
     * balances through `POST /api/v1/admin/user/wallet/adjust` — a route on
     * user-service behind a staff token and `wallet:adjust`. It is not an
     * internal call, so nothing here touches it.
     */
    assert.equal(
      isInternalCallAllowed('admin-service', '/api/v1/admin/user/wallet/adjust').allowed,
      false,
      'not an internal path — and this guard never runs on it'
    );
  });

  await t.test('a service cannot reach another domain it has no business in', () => {
    assert.equal(isInternalCallAllowed('casino-service', '/internal/sports/settlement/settle-market').allowed, false);
    assert.equal(isInternalCallAllowed('sports-service', '/internal/casino/bet-history/recent').allowed, false);
  });

  await t.test('each service keeps the reach it actually uses', () => {
    const real = [
      ['casino-service', '/internal/user/wallet/debit'],
      ['casino-service', '/internal/admin/staff-directory/verify-transaction-password'],
      ['sports-service', '/internal/user/wallet/rollback'],
      ['sports-service', '/internal/admin/site-config/sports'],
      ['user-service', '/internal/casino/bet-history/top-winners'],
      ['user-service', '/internal/sports/wager/turnover/42'],
      ['admin-service', '/internal/sports/bet-admin/net'],
    ];
    for (const [caller, path] of real) {
      assert.equal(isInternalCallAllowed(caller, path).allowed, true, `${caller} → ${path}`);
    }
  });

  await t.test('prefix matching does not leak across a name boundary', () => {
    /**
     * `/internal/user/wallet` must not permit `/internal/user/wallet-export`.
     * Matching with a bare `startsWith` would, which is the classic way a
     * prefix ACL turns out to be wider than it reads.
     */
    assert.equal(isInternalCallAllowed('casino-service', '/internal/user/wallet-export').allowed, false);
    assert.equal(isInternalCallAllowed('casino-service', '/internal/user/wallet').allowed, true);
    assert.equal(isInternalCallAllowed('casino-service', '/internal/user/wallet/credit').allowed, true);
  });

  await t.test('an unknown service is refused everything', () => {
    assert.equal(isInternalCallAllowed('rogue-service', '/internal/user/wallet/credit').allowed, false);
  });

  await t.test('an unidentified caller is not judged', () => {
    /**
     * The backward-compatibility hinge. A null caller is the shared-key path;
     * enforcement needs identity, and denying what cannot be attributed would
     * break every deployment that has not set per-service keys.
     */
    assert.equal(isInternalCallAllowed(null, '/internal/user/wallet/credit').allowed, true);
  });
});

test('internalAuth with per-service keys', async (t) => {
  await t.test('the caller is identified by WHICH key verified', async () => {
    const app = await serve(fullConfig);

    const res = await app.call('/internal/user/wallet/credit', KEYS['casino-service']);
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.caller, 'casino-service');
    assert.equal(body.verified, true);
    await app.close();
  });

  await t.test('a forged x-internal-service header cannot rewrite identity', async () => {
    /**
     * The audit-attribution finding. This header was trusted and written onto
     * audit rows as "who moved this money". Now the key decides.
     */
    const app = await serve(fullConfig);

    const res = await app.call('/internal/user/wallet/credit', KEYS['casino-service'], 'admin-service');
    const body = await res.json();

    assert.equal(body.caller, 'casino-service', 'the key wins, not the claim');
    await app.close();
  });

  await t.test('a service is refused an endpoint outside its grants', async () => {
    const app = await serve(fullConfig);

    const res = await app.call('/internal/user/wallet/credit', KEYS['admin-service']);
    const body = await res.json();

    assert.equal(res.status, 403);
    assert.equal(body.success, false);
    // 403 not 404: it is a known service holding a valid key, simply not
    // permitted — and that should read as a refusal, not a routing typo.
    assert.match(body.error.message, /not permitted/i);
    await app.close();
  });

  await t.test('a wrong key is 401, and says nothing about which key was wrong', async () => {
    const app = await serve(fullConfig);

    const bad = await app.call('/internal/user/wallet/credit', 'x'.repeat(48));
    const none = await app.call('/internal/user/wallet/credit', null);

    assert.equal(bad.status, 401);
    assert.equal(none.status, 401);
    assert.equal((await bad.json()).error.message, (await none.json()).error.message);
    await app.close();
  });
});

test('internalAuth without per-service keys behaves exactly as before', async (t) => {
  await t.test('the shared key still works', async () => {
    const app = await serve({ INTERNAL_API_KEY: SHARED });

    const res = await app.call('/internal/user/wallet/credit', SHARED);
    assert.equal(res.status, 200);
    await app.close();
  });

  await t.test('and the ACL is skipped, so nothing that worked stops working', async () => {
    /**
     * The property that makes this shippable. An unmigrated deployment sees no
     * behaviour change at all — including the calls the ACL would deny once
     * identity exists.
     */
    const app = await serve({ INTERNAL_API_KEY: SHARED });

    // admin-service → wallet/credit is DENIED once identity is available.
    const res = await app.call('/internal/user/wallet/credit', SHARED, 'admin-service');
    const body = await res.json();

    assert.equal(res.status, 200, 'shared-key deployments are unchanged');
    assert.equal(body.caller, 'admin-service', 'falls back to the self-declared header');
    assert.equal(body.verified, false, 'and marks it as unverified');
    await app.close();
  });

  await t.test('a PARTIAL rollout also falls back rather than half-enforcing', async () => {
    /**
     * With some keys set and some not, a caller holding the shared key is
     * indistinguishable from one whose key was never configured — so the ACL
     * would deny real traffic. All-or-nothing keeps the failure mode legible.
     */
    const partial = { INTERNAL_API_KEY: SHARED, INTERNAL_KEY_CASINO_SERVICE: KEYS['casino-service'] };
    const app = await serve(partial);

    const res = await app.call('/internal/user/wallet/credit', SHARED, 'admin-service');
    assert.equal(res.status, 200, 'still permissive until every service has a key');
    await app.close();
  });

  await t.test('a per-service key is still accepted during a partial rollout', async () => {
    const partial = { INTERNAL_API_KEY: SHARED, INTERNAL_KEY_CASINO_SERVICE: KEYS['casino-service'] };
    const app = await serve(partial);

    const res = await app.call('/internal/user/wallet/credit', KEYS['casino-service']);
    assert.equal(res.status, 200, 'so keys can be rolled out one service at a time');
    await app.close();
  });
});

test('key resolution and configuration', async (t) => {
  await t.test('a service presents its own key when it has one', () => {
    assert.equal(resolveInternalKey(fullConfig, 'casino-service'), KEYS['casino-service']);
  });

  await t.test('and the shared key when it does not', () => {
    assert.equal(resolveInternalKey({ INTERNAL_API_KEY: SHARED }, 'casino-service'), SHARED);
  });

  await t.test('missing keys are reported together, not one per restart', () => {
    const { keys, missing } = collectServiceKeys({ INTERNAL_KEY_USER_SERVICE: 'x' });
    assert.equal(keys.size, 1);
    assert.equal(missing.length, KNOWN_SERVICES.length - 1);
    assert.ok(missing.every((m) => m.startsWith('INTERNAL_KEY_')));
  });

  await t.test('internalAuth still refuses to be built with no shared key', () => {
    assert.throws(() => internalAuth('', { config: {}, logger: silent }), /INTERNAL_API_KEY/);
  });
});

test('mounted the way mountModules mounts it', async (t) => {
  /**
   * ═════════════════════════════════════════════════════════════════════
   * THE REGRESSION TEST FOR THE BUG THAT NEARLY SHIPPED
   *
   * The tests above mount the guard at `/internal`, which is not what the
   * platform does. `mountModules` mounts each module at its FULL prefix:
   *
   *     root.use('/internal/user/wallet', internalAuth, walletRouter)
   *
   * Express strips a mount prefix from `req.path`, so inside the guard the
   * path is `/credit` — not `/internal/user/wallet/credit`. The first version
   * matched `req.path` against the ACL and therefore denied EVERY internal
   * call on the platform the moment per-service keys were set: settlement
   * stops paying out, casino bets stop debiting, and the cause looks like a
   * permissions mystery rather than a path bug.
   *
   * This mounts it exactly as production does, so the shape cannot regress.
   * ═════════════════════════════════════════════════════════════════════
   */
  const mountLikeProduction = async (config) => {
    const app = express();
    const root = express.Router();

    // One real mount point per internal module, prefix and all.
    for (const prefix of ['/internal/user/wallet', '/internal/admin/staff-directory', '/internal/sports/settlement']) {
      const router = express.Router();
      router.get('/*', (req, res) =>
        res.json({ caller: req.internalCaller, verified: req.internalCallerVerified })
      );
      router.post('/*', (req, res) => res.json({ caller: req.internalCaller }));
      root.use(prefix, internalAuth(SHARED, { config, logger: silent }), router);
    }

    app.use(root);
    app.use(errorHandler({ logger: silent }));

    const server = http.createServer(app);
    openServers.add(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;

    return {
      call: (path, key, method = 'GET') =>
        fetch(`${base}${path}`, { method, headers: { 'x-internal-key': key } }),
      close: () => { openServers.delete(server); return new Promise((r) => server.close(r)); },
    };
  };

  await t.test('a permitted caller reaches a deeply-mounted route', async () => {
    const app = await mountLikeProduction(fullConfig);
    try {
      const res = await app.call('/internal/user/wallet/credit', KEYS['casino-service'], 'POST');
      assert.equal(res.status, 200, 'casino-service pays out bets and must reach the wallet');
      assert.equal((await res.json()).caller, 'casino-service');
    } finally { await app.close(); }
  });

  await t.test('and a forbidden one is still refused at the same depth', async () => {
    const app = await mountLikeProduction(fullConfig);
    try {
      const res = await app.call('/internal/user/wallet/credit', KEYS['admin-service'], 'POST');
      assert.equal(res.status, 403);
    } finally { await app.close(); }
  });

  await t.test('every real caller reaches every endpoint it actually uses', async () => {
    /**
     * The property that matters for "nothing breaks": each of these is a call
     * the code makes today, at its true mount depth.
     */
    const app = await mountLikeProduction(fullConfig);
    try {
      const real = [
        ['casino-service', '/internal/user/wallet/debit', 'POST'],
        ['casino-service', '/internal/user/wallet/balance/42', 'GET'],
        ['sports-service', '/internal/user/wallet/rollback', 'POST'],
        ['sports-service', '/internal/admin/staff-directory/staff/7', 'GET'],
        ['user-service', '/internal/admin/staff-directory/staff/7/descendants', 'GET'],
        ['admin-service', '/internal/sports/settlement/pending-markets', 'GET'],
      ];
      for (const [caller, path, method] of real) {
        const res = await app.call(path, KEYS[caller], method);
        assert.equal(res.status, 200, `${caller} → ${method} ${path} must still work`);
      }
    } finally { await app.close(); }
  });

  await t.test('with only the shared key, every one of those still works', async () => {
    const app = await mountLikeProduction({ INTERNAL_API_KEY: SHARED });
    try {
      for (const path of [
        '/internal/user/wallet/credit',
        '/internal/admin/staff-directory/staff/7',
        '/internal/sports/settlement/pending-markets',
      ]) {
        assert.equal((await app.call(path, SHARED)).status, 200);
      }
    } finally { await app.close(); }
  });
});
