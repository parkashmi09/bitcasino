'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const { findUnauthorizedWrites, mountModules } = require('../src/moduleLoader');
const { auditProductionConfig } = require('../src/productionGuards');

/**
 * An admin write route must say what it costs.
 *
 * The `admin` audience guard is `authenticateStaff()` — it proves WHO is
 * calling, not what they may do. Authorization is per-route, and 8 of 48 admin
 * route files once applied none, which put `POST /gis/vouchers`,
 * `POST /js-games/v1/transfer` and `POST /email/bulk` within reach of a level-7
 * executive holding read-only grants.
 *
 * These tests cover the mechanism that stops that recurring.
 */

const IS_AUTHORIZATION = Symbol.for('ibitplay.authorizationMiddleware');

/** A guard, as `markAuthorization` produces one. */
const guard = () => {
  const fn = (_req, _res, next) => next();
  fn[IS_AUTHORIZATION] = true;
  return fn;
};

/** Authentication, or any other middleware. Deliberately untagged. */
const plain = () => (_req, _res, next) => next();

const ok = (_req, res) => res.json({ ok: true });
const silent = { info() {}, warn() {}, error() {}, debug() {} };

test('admin write routes must carry an authorization guard', async (t) => {
  await t.test('an unguarded POST is reported', () => {
    const router = express.Router();
    router.post('/vouchers', ok);

    assert.deepEqual(findUnauthorizedWrites(router), ['POST /vouchers']);
  });

  await t.test('a guarded POST is not', () => {
    const router = express.Router();
    router.post('/vouchers', guard(), ok);

    assert.deepEqual(findUnauthorizedWrites(router), []);
  });

  await t.test('every mutating verb is checked', () => {
    const router = express.Router();
    router.post('/a', ok);
    router.put('/b', ok);
    router.patch('/c', ok);
    router.delete('/d', ok);

    assert.deepEqual(findUnauthorizedWrites(router).sort(), [
      'DELETE /d',
      'PATCH /c',
      'POST /a',
      'PUT /b',
    ]);
  });

  await t.test('reads are not required to carry one', () => {
    /**
     * A GET is still scoped by the caller's hierarchy inside the service, and
     * demanding a grant on every read would produce ceremonial guards that
     * teach nobody anything.
     */
    const router = express.Router();
    router.get('/list', ok);

    assert.deepEqual(findUnauthorizedWrites(router), []);
  });

  await t.test('a router-level guard covers everything below it', () => {
    // How `bet-history` is written — one `router.use`, so the ninth route
    // added cannot forget it.
    const router = express.Router();
    router.use(guard());
    router.post('/a', ok);
    router.delete('/b', ok);

    assert.deepEqual(findUnauthorizedWrites(router), []);
  });

  await t.test('authentication alone does NOT satisfy the check', () => {
    /**
     * The distinction the whole thing rests on. `authenticateStaff` is already
     * attached by the audience guard; if it counted as authorization then every
     * admin route would pass trivially and this check would be decoration.
     */
    const router = express.Router();
    router.post('/transfer', plain(), ok);

    assert.deepEqual(findUnauthorizedWrites(router), ['POST /transfer']);
  });

  await t.test('a guard anywhere in the chain counts, not just first', () => {
    const router = express.Router();
    router.post('/x', plain(), plain(), guard(), ok);

    assert.deepEqual(findUnauthorizedWrites(router), []);
  });

  await t.test('nested routers are walked', () => {
    const inner = express.Router();
    inner.post('/deep', ok);

    const router = express.Router();
    router.use('/nested', inner);

    assert.deepEqual(findUnauthorizedWrites(router), ['POST /deep']);
  });

  await t.test('only some routes guarded still reports the rest', () => {
    /**
     * The case a `grep -L requirePermission` audit misses entirely: the file
     * DOES mention a guard, just not on every write. That is how `affiliate`'s
     * two unguarded POSTs survived the first pass of this review.
     */
    const router = express.Router();
    router.post('/guarded', guard(), ok);
    router.post('/forgotten', ok);

    assert.deepEqual(findUnauthorizedWrites(router), ['POST /forgotten']);
  });
});

test('mountModules refuses to mount an unguarded admin surface', async (t) => {
  const manifest = (routerFactory) => ({
    name: 'demo',
    service: 'admin',
    basePath: '/demo',
    routers: { admin: routerFactory },
  });

  await t.test('a service with an unguarded admin write route cannot boot', () => {
    assert.throws(
      () =>
        mountModules({
          modules: [
            manifest(() => {
              const r = express.Router();
              r.post('/pay', ok);
              return r;
            }),
          ],
          deps: {},
          guards: { admin: [plain()] },
          logger: silent,
        }),
      (error) => {
        assert.match(error.message, /admin write routes with no authorization guard/);
        assert.match(error.message, /POST \/pay/);
        assert.match(error.message, /proves identity, not authority/);
        return true;
      }
    );
  });

  await t.test('a guarded one mounts', () => {
    const root = mountModules({
      modules: [
        manifest(() => {
          const r = express.Router();
          r.post('/pay', guard(), ok);
          return r;
        }),
      ],
      deps: {},
      guards: { admin: [plain()] },
      logger: silent,
    });

    assert.equal(root.mountedRoutes.length, 1);
    assert.equal(root.mountedRoutes[0].path, '/api/v1/admin/demo');
  });

  await t.test('an exemption must be a written reason, and it is recorded', () => {
    /**
     * A sentence rather than a boolean, on purpose: the exemption appears in
     * the boot log and in `mountedRoutes`, so it is a claim somebody made and
     * can be read back — not a flag that silences the check.
     */
    const root = mountModules({
      modules: [
        manifest(() => {
          const r = express.Router();
          r.authorizationReviewed = 'ends the caller\'s own session';
          r.post('/logout', ok);
          return r;
        }),
      ],
      deps: {},
      guards: { admin: [plain()] },
      logger: silent,
    });

    assert.equal(root.mountedRoutes[0].authzExemption, "ends the caller's own session");
  });

  await t.test('the rule applies to admin only, not to user or public routes', () => {
    /**
     * A player route is scoped to the caller by construction — the id comes
     * from their own token — so there is no grant to require.
     */
    assert.doesNotThrow(() =>
      mountModules({
        modules: [
          {
            name: 'demo',
            service: 'user',
            basePath: '/demo',
            routers: {
              user: () => {
                const r = express.Router();
                r.post('/bet', ok);
                return r;
              },
            },
          },
        ],
        deps: {},
        guards: { user: [plain()] },
        logger: silent,
      })
    );
  });
});

test('production posture', async (t) => {
  const sound = {
    NODE_ENV: 'production',
    DB_PASSWORD: 'a-genuinely-set-password',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    JWT_ADMIN_SECRET: 'c'.repeat(48),
    INTERNAL_API_KEY: 'd'.repeat(48),
    RATE_LIMIT_ENABLED: true,
    REDIS_URL: 'redis://127.0.0.1:6379',
    TOTP_ENCRYPTION_KEY: 'e'.repeat(64),
    DB_SSL: true,
    LOG_LEVEL: 'info',
    SPORTS_FEED_ALLOW_INSECURE: false,
  };

  await t.test('a sound production config raises nothing', () => {
    const { fatal, warn } = auditProductionConfig(sound);
    assert.deepEqual(fatal, []);
    assert.deepEqual(warn, []);
  });

  const fatalCases = [
    ['rate limiting switched off', { RATE_LIMIT_ENABLED: false }, /RATE_LIMIT_ENABLED/],
    ['a default database password', { DB_PASSWORD: 'postgres' }, /DB_PASSWORD/],
    ['a placeholder internal key', { INTERNAL_API_KEY: 'changeme' }, /INTERNAL_API_KEY/],
    ['a short signing secret', { JWT_ADMIN_SECRET: 'tooshort' }, /JWT_ADMIN_SECRET/],
    ['a cleartext sports feed', { SPORTS_FEED_ALLOW_INSECURE: true }, /cleartext/],
  ];

  for (const [name, override, pattern] of fatalCases) {
    await t.test(`${name} is fatal`, () => {
      const { fatal } = auditProductionConfig({ ...sound, ...override });
      assert.ok(fatal.some((m) => pattern.test(m)), `expected a fatal matching ${pattern}`);
    });
  }

  await t.test('a shared admin and access secret is fatal', () => {
    /**
     * `TokenService` already refuses access === refresh. Nothing checked the
     * third pair — and a shared ADMIN secret means a leaked player secret can
     * mint a staff token with balance-transfer rights.
     */
    const { fatal } = auditProductionConfig({ ...sound, JWT_ADMIN_SECRET: sound.JWT_ACCESS_SECRET });
    assert.ok(fatal.some((m) => /same as JWT_ACCESS_SECRET/.test(m)));
  });

  await t.test('missing Redis warns but does not block the deploy', () => {
    const { fatal, warn } = auditProductionConfig({ ...sound, REDIS_URL: '' });
    assert.deepEqual(fatal, []);
    assert.ok(warn.some((m) => /REDIS_URL/.test(m)));
  });

  await t.test('development is not held to production rules', () => {
    /**
     * Otherwise every developer's machine fails the check and the check gets
     * deleted.
     */
    const { fatal } = auditProductionConfig({ NODE_ENV: 'development', DB_PASSWORD: 'postgres' });
    assert.deepEqual(fatal, []);
  });

  await t.test('but a developer running with limits off is told what it would mean', () => {
    const { warn } = auditProductionConfig({ NODE_ENV: 'development', RATE_LIMIT_ENABLED: false });
    assert.ok(warn.some((m) => /refused in production/.test(m)));
  });

  await t.test('every problem is reported at once', () => {
    /**
     * A deploy that fails three times for three variables is how a check earns
     * a reputation for being obstructive.
     */
    const { fatal } = auditProductionConfig({
      ...sound,
      DB_PASSWORD: 'postgres',
      RATE_LIMIT_ENABLED: false,
      SPORTS_FEED_ALLOW_INSECURE: true,
    });
    assert.ok(fatal.length >= 3, `expected at least 3 findings, got ${fatal.length}`);
  });
});
