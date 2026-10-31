'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, errorHandler, requestContext, ForbiddenError } = require('@ibitplay/common');

const { SiteConfigService, TIP_LIMIT_DEFAULTS } = require('../siteConfig.service');
const v = require('../siteConfig.validators');

/**
 * Tip limits (migration 081): `GET/PUT /admin/site-config/tips` for staff and
 * `GET /internal/admin/site-config/tips` for user-service's tip send.
 */
test('tip limit settings', async (t) => {
  const logger = createLogger({ name: 'tip-limits-test', level: 'silent' });

  // ══ The schema — no database needed ═══════════════════════════════════

  await t.test('validation: decimal strings ≥ 0 with at most 8 dp; empty reads as 0', () => {
    const parse = (body) => v.updateTipSettings.body.safeParse(body);
    assert.deepEqual(parse({ maxPerTipUsd: '500' }).data, { maxPerTipUsd: '500' });
    assert.deepEqual(parse({ maxPerDayUsd: '0' }).data, { maxPerDayUsd: '0' });
    assert.deepEqual(parse({ maxPerDayUsd: '' }).data, { maxPerDayUsd: '0' }, 'empty = no cap');
    assert.deepEqual(parse({ minWageredUsd: ' 12.12345678 ' }).data, { minWageredUsd: '12.12345678' });
    assert.equal(parse({ maxPerTipUsd: '1.123456789' }).success, false, 'more than 8 dp');
    assert.equal(parse({ maxPerTipUsd: '-1' }).success, false, 'negative');
    assert.equal(parse({ maxPerTipUsd: 500 }).success, false, 'a number, not a string');
    assert.equal(parse({ maxPerTipUsd: '1e9' }).success, false);
    assert.equal(parse({ maxPerTipUsd: '1234567890123' }).success, false, 'beyond numeric(20,8)');
    assert.equal(parse({}).success, false, 'names nothing');
    assert.equal(parse({ maxPerTipUsd: '1', currency: 'INR' }).success, false, 'unknown field');
  });

  // ══ The routes against the real schema ════════════════════════════════

  let connection;
  try {
    connection = await db.connect({
      config: {
        DB_HOST: process.env.DB_HOST || '127.0.0.1',
        DB_PORT: Number(process.env.DB_PORT || 5432),
        DB_NAME: process.env.TEST_DB_NAME || 'ibitplay_test',
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

  const { Siteconfig } = connection.models;
  const { sequelize } = connection;
  const sql = (q, replacements = {}) => sequelize.query(q, { replacements, type: sequelize.QueryTypes.SELECT });

  // `siteconfig` is a singleton: borrow the row if there is one and put its values back.
  let row = await Siteconfig.findOne({ order: [['id', 'ASC']], raw: true });
  const created = !row;
  if (!row) {
    row = (await Siteconfig.create({ registerbonus: '0', affiliatebonus: '0', comissionpercent: '0', createdat: new Date(), updatedat: new Date() })).get({ plain: true });
  }
  const [before] = await sql('SELECT tip_max_per_tip_usd, tip_max_per_day_usd, tip_min_wagered_usd FROM siteconfig WHERE id = :id', { id: row.id });

  const deps = { models: connection.models, db: connection, logger, config: { SERVICE_NAME: 'admin-service' }, clients: {} };
  const service = new SiteConfigService(deps);

  // Staff: level 1 (house), with exactly the permissions the case gives.
  let permissions = [];
  let level = 1;
  const auth = {
    requirePermission: (perm) => (req, _res, next) => {
      if (permissions.includes(perm)) return next();
      return next(new ForbiddenError(`missing ${perm}`));
    },
    requireAnyPermission: (...perms) => (req, _res, next) => {
      if (perms.some((perm) => permissions.includes(perm))) return next();
      return next(new ForbiddenError(`missing ${perms.join(' or ')}`));
    },
  };
  const app = express();
  app.use(express.json());
  app.use(requestContext());
  app.use((req, _res, next) => {
    req.staff = { id: 1, level, permissions };
    next();
  });
  app.use('/admin', require('../routes/admin.routes')({ ...deps, auth }));
  app.use('/internal', require('../routes/internal.routes')(deps));
  app.use(errorHandler({ logger }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, code: json?.error?.code, data: json?.data };
  };

  t.after(async () => {
    server.closeAllConnections?.();
    server.close();
    if (created) await Siteconfig.destroy({ where: { id: row.id } });
    else {
      await sequelize.query(
        'UPDATE siteconfig SET tip_max_per_tip_usd = :a, tip_max_per_day_usd = :b, tip_min_wagered_usd = :c WHERE id = :id',
        { replacements: { a: before.tip_max_per_tip_usd, b: before.tip_max_per_day_usd, c: before.tip_min_wagered_usd, id: row.id } }
      );
    }
    await connection.close();
  });

  await t.test('the shipped defaults are the column defaults', async () => {
    await sequelize.query(
      'UPDATE siteconfig SET tip_max_per_tip_usd = DEFAULT, tip_max_per_day_usd = DEFAULT, tip_min_wagered_usd = DEFAULT WHERE id = :id',
      { replacements: { id: row.id } }
    );
    const read = await service.tipSettings();
    assert.deepEqual(read, {
      maxPerTipUsd: '500.00000000',
      maxPerDayUsd: '2000.00000000',
      minWageredUsd: '0.00000000',
      currency: 'USDT', // the test DB's default coin
      configured: true,
    });
    assert.deepEqual(TIP_LIMIT_DEFAULTS, { maxPerTipUsd: '500', maxPerDayUsd: '2000', minWageredUsd: '0' });
  });

  await t.test('routes: read needs config:read, write needs config:write, bodies are validated', async () => {
    permissions = [];
    assert.equal((await call('GET', '/admin/tips')).status, 403);

    permissions = ['config:read'];
    const read = await call('GET', '/admin/tips');
    assert.equal(read.status, 200);
    assert.equal(read.data.maxPerTipUsd, '500.00000000');
    assert.equal((await call('PUT', '/admin/tips', { maxPerTipUsd: '100' })).status, 403, 'read-only staff cannot save');

    permissions = ['config:read', 'config:write'];
    assert.equal((await call('PUT', '/admin/tips', { maxPerTipUsd: 100 })).status, 422);
    assert.equal((await call('PUT', '/admin/tips', { maxPerTipUsd: '1.123456789' })).status, 422);
    assert.equal((await call('PUT', '/admin/tips', { maxPerTipUsd: '-5' })).status, 422);
    assert.equal((await call('PUT', '/admin/tips', {})).status, 422);
    assert.equal((await call('PUT', '/admin/tips', { maxPerTipUsd: '1', extra: true })).status, 422);

    // A patch: only the named fields change; "" is stored as 0 (no cap).
    const saved = await call('PUT', '/admin/tips', { maxPerTipUsd: '100.5', maxPerDayUsd: '' });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.data, {
      maxPerTipUsd: '100.50000000',
      maxPerDayUsd: '0.00000000',
      minWageredUsd: '0.00000000',
      currency: 'USDT', // the test DB's default coin
      configured: true,
    });
    const wager = await call('PUT', '/admin/tips', { minWageredUsd: '250' });
    assert.equal(wager.data.maxPerTipUsd, '100.50000000');
    assert.equal(wager.data.minWageredUsd, '250.00000000');

    // user-service reads the same values over the internal route.
    const internal = await call('GET', '/internal/tips');
    assert.equal(internal.status, 200);
    assert.equal(internal.data.maxPerTipUsd, '100.50000000');
    assert.equal(internal.data.maxPerDayUsd, '0.00000000');
    assert.equal(internal.data.minWageredUsd, '250.00000000');

    // The agent tree is refused, like the welcome bonuses.
    level = 6;
    try {
      assert.equal((await call('GET', '/admin/tips')).status, 403);
    } finally {
      level = 1;
    }
  });
});
