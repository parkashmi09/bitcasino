'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, errorHandler, requestContext, ForbiddenError } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../siteContent.validators');

/** Site content (migration 179): validation, PUT then the public read, and who may write. */
test('site content', async (t) => {
  const logger = createLogger({ name: 'site-content-test', level: 'silent' });

  await t.test('validation: links are http(s) or site-relative, text is capped and inert', () => {
    const footer = (href, label = 'Terms') => v.SECTIONS.footer.safeParse({ columns: [{ title: 'Help', links: [{ label, href }] }] });
    assert.equal(footer('/terms').success, true);
    assert.equal(footer('https://example.com/a?b=1').success, true);
    assert.equal(footer('').success, true, 'empty = unset');
    assert.equal(footer('javascript:alert(1)').success, false);
    assert.equal(footer('//evil.example').success, false, 'protocol-relative');
    assert.equal(footer('data:text/html,x').success, false);
    assert.equal(footer('/ok', '<b>x</b>').success, false, 'angle brackets');
    assert.equal(footer('/ok', 'a'.repeat(81)).success, false, 'overlong label');
    assert.equal(v.SECTIONS.home.safeParse({ heroTitle: 'x'.repeat(121) }).success, false, 'overlong title');
    assert.equal(v.SECTIONS.pages.safeParse({ items: [{ slug: 'terms', title: 'T', body: 'x'.repeat(50_001) }] }).success, false, 'body > 50k');
    assert.equal(v.SECTIONS.pages.safeParse({ items: [{ slug: 'terms', title: 'T', body: 'line 1\nline 2' }] }).success, true, 'newlines in a body');
    assert.equal(v.SECTIONS.pages.safeParse({ items: [{ slug: 'a', title: '', body: '' }, { slug: 'a', title: '', body: '' }] }).success, false, 'duplicate slug');
    assert.equal(v.SECTIONS.social.safeParse({ links: [{ network: 'myspace', href: '/x' }] }).success, false, 'unknown network');
    assert.equal(v.SECTIONS.support.safeParse({ email: 'not-an-email' }).success, false);
    assert.equal(v.SECTIONS.support.safeParse({ email: 'a@b.co', extra: 1 }).success, false, 'unknown field');
    assert.equal(v.SECTIONS.footer.safeParse({ columns: Array.from({ length: 9 }, () => ({ title: 'x', links: [] })) }).success, false, '> 8 columns');
  });

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

  const { sequelize } = connection;
  const before = await sequelize.query('SELECT key, value, updated_by FROM site_content', { type: sequelize.QueryTypes.SELECT });

  const deps = { models: connection.models, db: connection, logger, config: { SERVICE_NAME: 'admin-service', RATE_LIMIT_ENABLED: false }, clients: {} };
  let permissions = [];
  let level = 1;
  const auth = {
    requirePermission: (perm) => (_req, _res, next) => (permissions.includes(perm) ? next() : next(new ForbiddenError(`missing ${perm}`))),
  };
  const app = express();
  app.use(express.json());
  app.use(requestContext());
  app.use('/public', require('../routes/public.routes')(deps));
  app.use((req, _res, next) => {
    req.staff = { id: 1, level, permissions };
    next();
  });
  app.use('/admin', require('../routes/admin.routes')({ ...deps, auth }));
  app.use(errorHandler({ logger }));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, code: json?.error?.code, data: json?.data };
  };

  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    await sequelize.query('DELETE FROM site_content');
    for (const r of before) {
      await sequelize.query('INSERT INTO site_content (key, value, updated_by) VALUES (:key, CAST(:value AS JSONB), :by)', {
        replacements: { key: r.key, value: JSON.stringify(r.value), by: r.updated_by },
      });
    }
    await connection.close();
  });

  await t.test('PUT a section, then the public read returns it', async () => {
    await sequelize.query('DELETE FROM site_content');
    assert.deepEqual((await call('GET', '/public/public')).data, {}, 'nothing set = empty object');

    permissions = [PERMISSIONS.CONFIG_READ, PERMISSIONS.CONFIG_WRITE];
    const support = { email: 'help@testplay.example', liveChatUrl: 'https://chat.example', helpCenterUrl: '/help' };
    const put = await call('PUT', '/admin/support', support);
    assert.equal(put.status, 200);
    assert.deepEqual(put.data.value, support);

    const home = await call('PUT', '/admin/home', { heroTitle: '  Play now  ' });
    assert.deepEqual(home.data.value, { heroTitle: 'Play now', heroSubtitle: '', registerCta: '' }, 'trimmed, missing fields default to empty');

    assert.deepEqual((await call('GET', '/public/public')).data, { support, home: home.data.value });
    assert.deepEqual((await call('GET', '/admin')).data.content.support, support);

    assert.equal((await call('PUT', '/admin/footer', { columns: [{ title: 'x', links: [{ label: 'y', href: 'javascript:alert(1)' }] }] })).status, 422);
    assert.equal((await call('PUT', '/admin/nope', {})).status, 422, 'unknown key');
  });

  await t.test('refused without config:write, and to agent accounts', async () => {
    permissions = [PERMISSIONS.CONFIG_READ];
    assert.equal((await call('PUT', '/admin/home', { heroTitle: 'x' })).status, 403);
    assert.equal((await call('GET', '/admin')).status, 200);

    permissions = [PERMISSIONS.CONFIG_READ, PERMISSIONS.CONFIG_WRITE];
    level = 3;
    const agent = await call('PUT', '/admin/home', { heroTitle: 'x' });
    assert.equal(agent.status, 403);
    assert.equal(agent.code, 'SITE_CONTENT_HOUSE_ONLY');
    level = 1;
    assert.equal((await call('GET', '/public/public')).data.home.heroTitle, 'Play now', 'refused writes changed nothing');
  });
});
