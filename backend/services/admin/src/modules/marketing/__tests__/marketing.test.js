'use strict';

const test = require('node:test');
const assert = require('node:assert');

const db = require('@ibitplay/db');
const { createLogger } = require('@ibitplay/common');

const { MarketingService } = require('../marketing.service');
const { createProtectMarketing } = require('../protectMarketing');
const v = require('../marketing.validators');

/**
 * The marketing panel.
 *
 * Legacy's guard is the good part and is ported nearly verbatim; these tests
 * pin the two properties it exists for — read-only, and marketing accounts
 * only — so a later edit cannot quietly relax either.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

let connection;

test('the panel is read-only, structurally', async (t) => {
  const logger = createLogger({ name: 'marketing-guard-test', level: 'silent' });

  /** A stand-in registry — the guard's DB read is the only model it touches. */
  const models = (executive) => ({
    Executives: { findOne: async () => executive },
  });

  const run = (guard, req) =>
    new Promise((resolve) => {
      guard(req, {}, (err) => resolve(err ?? null));
    });

  const marketingAccount = { id: 7, username: 'mkt', kind: 'marketing', status: 'active', last_login: null };

  await t.test('a GET from a marketing account passes', async () => {
    const guard = createProtectMarketing({ models: models(marketingAccount), logger });
    const req = { method: 'GET', staff: { id: 1, executiveId: 7 } };
    assert.equal(await run(guard, req), null);
    assert.equal(req.marketing.kind, 'marketing');
  });

  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    await t.test(`${method} is refused BEFORE any handler runs`, async () => {
      /**
       * Legacy's comment, kept:
       *
       *     The UI also hides mutations, but this is the guarantee — a
       *     marketing token is incapable of writing through these routes
       *     regardless of what is sent.
       */
      const guard = createProtectMarketing({ models: models(marketingAccount), logger });
      const err = await run(guard, { method, staff: { id: 1, executiveId: 7 } });
      assert.equal(err?.code, 'MARKETING_READ_ONLY');
      assert.equal(err?.status, 405);
    });
  }

  await t.test('a plain staff token is refused', async () => {
    // No executive id at all — a staff member who knows the URL.
    const guard = createProtectMarketing({ models: models(null), logger });
    const err = await run(guard, { method: 'GET', staff: { id: 1 } });
    assert.equal(err?.code, 'MARKETING_ACCOUNT_REQUIRED');
  });

  await t.test('a NON-marketing executive is refused, from the database not the token', async () => {
    /**
     * The account type is re-read rather than trusted from a JWT claim. A
     * token claiming `kind: 'marketing'` gets nowhere if the row says
     * otherwise.
     */
    const classic = { id: 8, username: 'exec', kind: 'classic', status: 'active' };
    const guard = createProtectMarketing({ models: models(classic), logger });
    const err = await run(guard, { method: 'GET', staff: { id: 1, executiveId: 8, kind: 'marketing' } });
    assert.equal(err?.code, 'MARKETING_ACCOUNT_REQUIRED');
  });

  await t.test('a suspended marketing account is refused', async () => {
    const suspended = { ...marketingAccount, status: 'suspended' };
    const guard = createProtectMarketing({ models: models(suspended), logger });
    const err = await run(guard, { method: 'GET', staff: { id: 1, executiveId: 7 } });
    assert.equal(err?.code, 'MARKETING_ACCOUNT_INACTIVE');
  });

  await t.test('a missing executive and a wrong kind answer identically', async () => {
    // So the endpoint does not confirm which executive ids exist.
    const missing = createProtectMarketing({ models: models(null), logger });
    const wrongKind = createProtectMarketing({ models: models({ id: 9, kind: 'classic', status: 'active' }), logger });

    const a = await run(missing, { method: 'GET', staff: { id: 1, executiveId: 9 } });
    const b = await run(wrongKind, { method: 'GET', staff: { id: 1, executiveId: 9 } });

    assert.equal(a.code, b.code);
    assert.equal(a.message, b.message);
  });
});

test('marketing validators', async (t) => {
  await t.test('a range longer than the cap is refused', () => {
    // Legacy capped it too, with the same reasoning: a hand-crafted query must
    // not be able to ask for an unbounded scan.
    assert.equal(v.signups.query.safeParse({ from: '2020-01-01', to: '2026-01-01' }).success, false);
    assert.equal(v.signups.query.safeParse({ from: '2026-01-01', to: '2026-02-01' }).success, true);
  });

  await t.test('a backwards range is refused', () => {
    assert.equal(v.signups.query.safeParse({ from: '2026-06-01', to: '2026-01-01' }).success, false);
  });

  await t.test('the customer page has a ceiling', () => {
    assert.equal(v.customers.query.safeParse({ limit: '100000' }).success, false);
    assert.equal(v.customers.query.parse({}).limit, 25);
  });
});

test('marketing against a database', async (t) => {
  const logger = createLogger({ name: 'marketing-test', level: 'silent' });

  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: TEST_DB,
        DB_USER: process.env.DB_USER || 'postgres',
        DB_PASSWORD: process.env.DB_PASSWORD || 'postgres',
        DB_SCHEMA: 'public',
      },
      logger,
      service: 'admin-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  t.after(async () => {
    if (connection) await connection.close();
  });

  const service = new MarketingService({ models: connection.models, db: connection, logger, config: {} });

  /**
   * Every one of these reads four deposit tables, `users`, `staff`, `roles` and
   * `exchangerate`. Exercising each against the real schema is what catches a
   * column that does not exist — which is how three of this port's findings
   * were found in the first place.
   */
  await t.test('signups runs against the real schema', async () => {
    const result = await service.signups({});
    assert.ok(result.range.from && result.range.to);
    assert.equal(typeof result.total, 'number');
    assert.ok(Array.isArray(result.series));
    assert.equal(typeof result.estimatedUsers, 'number');
  });

  await t.test('deposits runs, and money comes back as decimal strings', async () => {
    const result = await service.deposits({});
    assert.match(result.totals.volume, /^-?\d+\.\d{8}$/);
    assert.match(result.byChannel.online.volume, /^-?\d+\.\d{8}$/);
    assert.equal(typeof result.byChannel.agent.conversionRate, 'number');
  });

  await t.test('retention runs and names its metric honestly', async () => {
    const result = await service.retention({});
    assert.ok(Array.isArray(result.series));
    // Not `dau` — the platform has no session table, and legacy said so too.
    if (result.series.length) assert.ok('activeDepositors' in result.series[0]);
  });

  await t.test('top-agents runs', async () => {
    const result = await service.topAgents({ limit: 5 });
    assert.ok(Array.isArray(result.agents));
    assert.ok(result.agents.length <= 5);
  });

  await t.test('the customer directory runs and returns no wallet balances', async () => {
    /**
     * Legacy's comment on this, kept and now testable:
     *
     *     wallet balances, bet history and KYC documents are deliberately not
     *     selected.
     */
    const result = await service.customers({ limit: 5, offset: 0 });
    assert.ok(Array.isArray(result.rows));

    for (const customer of result.rows) {
      assert.equal('balance' in customer, false);
      assert.equal('inr' in customer, false);
      assert.equal('password' in customer, false);
      assert.ok('depositVolume' in customer);
    }
  });

  await t.test('the search box does not treat _ as a wildcard', async () => {
    // Bound as a parameter in legacy, so not injectable — but the LIKE
    // wildcards inside it were never escaped, so the box lied.
    const result = await service.customers({ search: '_', limit: 5, offset: 0 });
    assert.equal(result.total, 0);
  });
});
