'use strict';

process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { hashPassword, verifyPassword } = require('@ibitplay/auth');

const { WhitelabelsService } = require('../whitelabels.service');
const adminRoutes = require('../routes/admin.routes');
const v = require('../whitelabels.validators');
const { readOwnerDirectBalance } = require('../../lords/ownerWallet');
const { schemas: linkSchemas } = require('../../whitelabel-link/routes/public.routes');
const migration = require('../../../../../../packages/db/migrations/172-whitelabels');
const iconMigration = require('../../../../../../packages/db/migrations/173-whitelabel-icon');
const posterMigration = require('../../../../../../packages/db/migrations/174-whitelabel-posters');

// A real 1×1 PNG: the branding checks read its magic bytes.
const PNG = { type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' };

/**
 * The parent's Whitelabel panel: a create is queued and never shows a secret; a transfer is
 * debited once, delivered or retried, and given back only when the copy refused it outright;
 * delete is held until the copy is off, empty (or confirmed) and has nothing in flight.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const config = {
  SERVICE_NAME: 'admin-service',
  JWT_ACCESS_SECRET: 'wl-parent-test-access',
  JWT_REFRESH_SECRET: 'wl-parent-test-refresh',
  JWT_ADMIN_SECRET: 'wl-parent-test-admin-0123456789',
  TOTP_ENCRYPTION_KEY: 'a'.repeat(64),
  WHITELABEL_MODE: false,
};
const tag = `wp${process.pid % 100_000}`;
const logger = createLogger({ name: 'whitelabels-test', level: 'silent' });
const TXN = '246810';

const input = (n) => ({
  name: `Lucky ${tag}${n}`,
  slug: `lucky-${tag}${n}`,
  siteDomain: `${tag}${n}.example.com`,
  adminDomain: `admin.${tag}${n}.example.com`,
  apiDomain: `api.${tag}${n}.example.com`,
  template: 'emerald_dark',
  companyRoleName: 'Company',
  companyName: 'Lucky Ltd',
  companyEmail: `owner@${tag}${n}.example.com`,
  companyPassword: 'Company-Pass-1',
});

test('create validators', () => {
  assert.equal(v.create.body.safeParse(input(1)).success, true);
  assert.equal(v.create.body.safeParse({ ...input(1), slug: 'Bad Slug' }).success, false);
  assert.equal(v.create.body.safeParse({ ...input(1), siteDomain: 'not a domain' }).success, false);
  assert.equal(v.create.body.safeParse({ ...input(1), name: '<script>' }).success, false);
  assert.equal(v.create.body.safeParse({ ...input(1), template: 'nope' }).success, false);
});

test('the panel is the Super Admin’s, and never on a copy', async (t) => {
  const pass = (_req, _res, next) => next();
  const routes = (cfg, level, models) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.staff = { id: 1, level, permissions: ['*'] };
      next();
    });
    app.use(
      adminRoutes({
        auth: { requirePermission: () => pass },
        clients: { admin: { post: async () => ({}) } },
        logger,
        config: cfg,
        models,
        whitelabelsService: { list: async () => ({ rows: [], total: 0 }) },
      })
    );
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ code: err.code }));
    return app;
  };
  const get = async (app) => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
      return { status: res.status, body: await res.json() };
    } finally {
      server.close();
    }
  };

  assert.equal((await get(routes(config, 1))).status, 200);
  assert.equal((await get(routes(config, 2))).body.code, 'WHITELABEL_OWNER_ONLY');
  assert.equal((await get(routes({ ...config, WHITELABEL_MODE: true }, 1))).body.code, 'WHITELABEL_NOT_ON_A_COPY');
  const policy = (variant) => ({ SiteFeature: { findByPk: async () => (variant ? { variant } : null) } });
  assert.equal((await get(routes(config, 1, policy('off')))).body.code, 'WHITELABEL_DISABLED');
  assert.equal((await get(routes(config, 1, policy('on')))).status, 200);
  assert.equal((await get(routes(config, 1, policy(null)))).status, 200, 'unset = on');
  t.diagnostic('guards checked');
});

test('whitelabels against a database', async (t) => {
  let connection;
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

  const { models, sequelize } = connection;
  const q = (sql, replacements = {}) => sequelize.query(sql, { replacements });
  const one = async (sql, replacements = {}) => (await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT }))[0];
  await migration.up({ sequelize });
  await iconMigration.up({ sequelize });
  await posterMigration.up({ sequelize });

  // The parent's Super Admin, with a Direct balance and a transaction password.
  // 7_100_000+: clear of the 9500–10500 roles the staff suites seed and re-level.
  const roleId = 7_100_000 + (process.pid % 100_000);
  const ownerId = 610_000 + (process.pid % 1000) * 10;
  const cleanup = async () => {
    await q(`DELETE FROM whitelabel_transfers WHERE whitelabel_id IN (SELECT id FROM whitelabels WHERE slug LIKE :p)`, { p: `lucky-${tag}%` });
    await q(`DELETE FROM whitelabel_jobs WHERE whitelabel_id IN (SELECT id FROM whitelabels WHERE slug LIKE :p)`, { p: `lucky-${tag}%` });
    await q(`DELETE FROM whitelabel_assets WHERE whitelabel_id IN (SELECT id FROM whitelabels WHERE slug LIKE :p)`, { p: `lucky-${tag}%` });
    await q(`DELETE FROM whitelabels WHERE slug LIKE :p`, { p: `lucky-${tag}%` });
    await q(`DELETE FROM owner_direct_ledger WHERE owner_id = :id`, { id: ownerId });
    await q(`DELETE FROM staff_transfers WHERE from_id = :id OR to_id = :id`, { id: ownerId });
    await q(`DELETE FROM staff_balances WHERE staff_id = :id`, { id: ownerId });
    await q(`DELETE FROM staff WHERE id = :id`, { id: ownerId });
  };
  t.after(async () => {
    try {
      await cleanup();
      await q(`DELETE FROM roles WHERE id = :id`, { id: roleId });
    } finally {
      await connection.close();
    }
  });
  await cleanup();
  await q(`INSERT INTO roles (id, name, level) VALUES (:id, :name, 1) ON CONFLICT (id) DO UPDATE SET level = 1`, { id: roleId, name: `Owner ${tag}` });
  await models.Staff.create({
    id: ownerId,
    name: `owner-${tag}`,
    email: `owner-${tag}@test.invalid`,
    password: 'x',
    role_id: roleId,
    status: 'active',
    transaction_password: await hashPassword(TXN, 4),
  });
  await q(`INSERT INTO staff_balances (staff_id, inr) VALUES (:id, 1000)`, { id: ownerId });
  await q(`SELECT setval('staff_id_seq', GREATEST((SELECT MAX(id) FROM staff), 1))`);
  const actor = { id: ownerId, level: 1 };
  const balance = async () => money.toMinorQuantised(await readOwnerDirectBalance(models, ownerId));

  // The copy, played by a fake fetch: `answer` decides each call.
  let answer = () => ({ status: 200, body: { success: true, data: {} } });
  const calls = [];
  // Every body is checked against the copy's own route validators: what the copy would refuse fails here.
  const LINK_BODY = { credit: linkSchemas.credit, 'company-password': linkSchemas.password, maintenance: linkSchemas.maintenance, palette: linkSchemas.palette, branding: linkSchemas.branding, poster: linkSchemas.poster };
  const fetchImpl = async (url, init) => {
    const body = init.body ? JSON.parse(init.body) : null;
    const schema = LINK_BODY[url.split('/').pop()];
    if (schema) {
      const checked = schema.body.safeParse(body);
      assert.ok(checked.success, `the copy would refuse ${url}: ${JSON.stringify(checked.error?.issues)}`);
    }
    calls.push({ url, method: init.method, body, key: init.headers['x-whitelabel-key'] });
    const a = answer(url, init);
    if (a instanceof Error) throw a;
    return { ok: a.status < 400, status: a.status, json: async () => a.body };
  };
  const service = new WhitelabelsService({ models, db: connection, logger, config, fetchImpl });

  let wl;
  await t.test('create: queued, a setup job, no secret in the answer', async () => {
    wl = await service.create(input(1), actor);
    assert.equal(wl.status, 'queued');
    assert.equal(wl.hasLogo, false);
    for (const k of ['link_key', 'linkKey', 'company_password_hash', 'companyPassword']) assert.equal(k in wl, false, k);
    const job = await one(`SELECT kind, status FROM whitelabel_jobs WHERE whitelabel_id = :id`, { id: wl.id });
    assert.deepEqual(job, { kind: 'create', status: 'queued' });
    const row = await one(`SELECT company_password_hash, link_key FROM whitelabels WHERE id = :id`, { id: wl.id });
    assert.equal(await verifyPassword('Company-Pass-1', row.company_password_hash), true, 'only the hash is kept');
    assert.match(service.secrets.open(row.link_key), /^[0-9a-f]{64}$/, 'the link key is sealed');

    await assert.rejects(() => service.create({ ...input(2), siteDomain: input(1).siteDomain }), (e) => e.code === 'WHITELABEL_TAKEN');
    await assert.rejects(() => service.create({ ...input(2), slug: input(1).slug }), (e) => e.code === 'WHITELABEL_TAKEN');
    await assert.rejects(() => service.create({ ...input(2), adminDomain: input(2).siteDomain }), (e) => e.code === 'WHITELABEL_SAME_DOMAIN');
    await assert.rejects(
      () => service.create({ ...input(2), logo: { type: 'image/png', data: Buffer.from('not a png at all, just some text bytes padding padding padding').toString('base64') } }),
      (e) => e.code === 'WHITELABEL_BAD_LOGO'
    );
  });

  // The setup script's part: the copy is up on a port.
  await q(`UPDATE whitelabels SET status = 'live', admin_port = 1, company_password_hash = NULL WHERE id = :id`, { id: wl.id });

  await t.test('a transfer is debited once and delivered', async () => {
    const before = await balance();
    const done = await service.transfer({ id: wl.id, amount: '100', transactionPassword: TXN, actor });
    assert.equal(done.status, 'done');
    assert.equal(await balance(), before - money.toMinor('100'));
    const sent = calls.at(-1);
    assert.match(sent.url, /^http:\/\/127\.0\.0\.1:1\/api\/v1\/admin\/whitelabel-link\/credit$/);
    assert.equal(sent.body.transferId, `p${done.id}`);
    assert.equal(sent.body.amount, '100.00', 'two decimals, as the copy takes it');
    assert.equal(sent.key, service.secrets.open((await one(`SELECT link_key FROM whitelabels WHERE id = :id`, { id: wl.id })).link_key));

    await assert.rejects(() => service.transfer({ id: wl.id, amount: '5000', transactionPassword: TXN, actor }), (e) => e.code === 'INSUFFICIENT_FUNDS');
    await assert.rejects(() => service.transfer({ id: wl.id, amount: '1', transactionPassword: 'wrong1', actor }));
  });

  await t.test('no answer: kept pending, sent again later, never paid twice here', async () => {
    const before = await balance();
    answer = () => new Error('ECONNREFUSED');
    const pending = await service.transfer({ id: wl.id, amount: '50', transactionPassword: TXN, actor });
    assert.equal(pending.status, 'pending');
    assert.equal(pending.uncertain, true);
    assert.equal(await balance(), before - money.toMinor('50'), 'debited, not refunded');

    // Even a later refusal is not refunded: the unanswered try may have landed.
    answer = () => ({ status: 401, body: { success: false, error: { code: 'UNAUTHORIZED', message: 'Bad whitelabel key' } } });
    await service.retryTransfers(wl.id);
    assert.equal((await one(`SELECT status FROM whitelabel_transfers WHERE id = :id`, { id: pending.id })).status, 'pending');

    answer = () => ({ status: 200, body: { success: true, data: { replayed: true } } });
    assert.deepEqual(await service.retryTransfers(wl.id), { retried: 1 });
    assert.equal((await one(`SELECT status FROM whitelabel_transfers WHERE id = :id`, { id: pending.id })).status, 'done');
    assert.equal(await balance(), before - money.toMinor('50'));
  });

  await t.test('refused outright: given back once', async () => {
    const before = await balance();
    answer = () => ({ status: 409, body: { success: false, error: { code: 'WHITELABEL_NO_COMPANY', message: 'This site has no company account' } } });
    const refunded = await service.transfer({ id: wl.id, amount: '30', transactionPassword: TXN, actor });
    assert.equal(refunded.status, 'refunded');
    assert.match(refunded.error, /no company account/);
    assert.equal(await balance(), before, 'back where it was');
    const back = await one(`SELECT COUNT(*)::int AS n FROM staff_transfers WHERE to_id = :id AND transfer_type = 'whitelabel_refund'`, { id: ownerId });
    assert.equal(back.n, 1);
  });

  await t.test('logo and icon: kept here and put on the live copy (no icon yet = the logo is the mark too)', async () => {
    answer = () => ({ status: 200, body: { success: true, data: {} } });
    const before = calls.length;
    const updated = await service.setBranding(wl.id, { logo: PNG });
    assert.equal(updated.hasLogo, true);
    assert.deepEqual(calls.slice(before).map((c) => [c.url.split('/').pop(), c.body.slot]), [['branding', 'logo'], ['branding', 'mark']]);

    const mid = calls.length;
    const withIcon = await service.setBranding(wl.id, { icon: PNG });
    assert.equal(withIcon.hasIcon, true);
    assert.deepEqual(calls.slice(mid).map((c) => c.body.slot), ['mark']);

    // Once it has an icon, a new logo leaves the mark alone.
    const last = calls.length;
    await service.setBranding(wl.id, { logo: PNG });
    assert.deepEqual(calls.slice(last).map((c) => c.body.slot), ['logo']);

    const { contentType } = await service.image(wl.id, 'icon');
    assert.equal(contentType, 'image/png');
    await assert.rejects(() => service.setBranding(wl.id, { icon: { type: 'image/png', data: Buffer.from('x'.repeat(80)).toString('base64') } }), (e) => e.code === 'WHITELABEL_BAD_ICON');
  });

  await t.test('poster: kept here and put on the live copy as the home banners', async () => {
    const before = calls.length;
    const result = await service.setPoster(wl.id, { desktop: PNG, mobile: PNG });
    assert.deepEqual(Object.keys(result.posters).sort(), ['poster', 'poster_mobile']);
    assert.deepEqual(calls.slice(before).map((c) => c.body.placement), ['home', 'home_mobile']);
    assert.equal((await service.posterImage(wl.id, 'poster_mobile')).contentType, 'image/png');
    await assert.rejects(() => service.setPoster(wl.id, { desktop: { type: 'image/jpeg', data: PNG.data } }), (e) => e.code === 'WHITELABEL_BAD_POSTER', 'the type must match the bytes');
  });

  await t.test('preview, maintenance and the company password go to the copy', async () => {
    answer = (url) => ({ status: 200, body: { success: true, data: url.endsWith('/preview') ? { code: 'c0de-1234567890abcdef', expiresInSeconds: 60 } : { maintenance: true } } });
    const { url } = await service.preview(wl.id);
    assert.equal(url, `https://${input(1).adminDomain}/preview?code=c0de-1234567890abcdef`);
    assert.deepEqual(await service.setMaintenance(wl.id, true), { maintenance: true });
    assert.equal((await one(`SELECT maintenance FROM whitelabels WHERE id = :id`, { id: wl.id })).maintenance, true);
    await service.setCompanyPassword(wl.id, 'New-Company-1');
    assert.deepEqual(calls.at(-1).body, { password: 'New-Company-1' });
  });

  await t.test('delete waits for off, an empty copy (or a yes) and nothing in flight', async () => {
    await assert.rejects(() => service.remove({ id: wl.id, confirmName: 'wrong', actor }), (e) => e.code === 'WHITELABEL_NAME_MISMATCH');

    await q(`UPDATE whitelabels SET maintenance = false WHERE id = :id`, { id: wl.id });
    await assert.rejects(() => service.remove({ id: wl.id, confirmName: wl.name, actor }), (e) => e.code === 'WHITELABEL_MUST_BE_OFF');
    await q(`UPDATE whitelabels SET maintenance = true WHERE id = :id`, { id: wl.id });

    const summary = (direct) => ({
      status: 200,
      body: { success: true, data: { balances: { direct, agentSystem: '0', staff: '0', players: '0' }, counts: { playersWithBalance: 0 } } },
    });
    answer = () => summary('150.00000000');
    await assert.rejects(() => service.remove({ id: wl.id, confirmName: wl.name, actor }), (e) => e.code === 'WHITELABEL_BALANCES_REMAIN');

    answer = () => summary('0.00000000');
    assert.deepEqual(await service.remove({ id: wl.id, confirmName: wl.name, actor }), { status: 'deleting' });
    const job = await one(`SELECT kind, status FROM whitelabel_jobs WHERE whitelabel_id = :id ORDER BY id DESC LIMIT 1`, { id: wl.id });
    assert.deepEqual(job, { kind: 'delete', status: 'queued' });
    await assert.rejects(() => service.remove({ id: wl.id, confirmName: wl.name, actor }), (e) => e.code === 'WHITELABEL_BUSY');

    // The delete fails part-way: deleting again is the way on, building it back is refused.
    await q(`UPDATE whitelabel_jobs SET status = 'failed' WHERE id = (SELECT MAX(id) FROM whitelabel_jobs WHERE whitelabel_id = :id)`, { id: wl.id });
    await q(`UPDATE whitelabels SET status = 'failed' WHERE id = :id`, { id: wl.id });
    await assert.rejects(() => service.retrySetup(wl.id, actor), (e) => e.code === 'WHITELABEL_DELETE_FAILED');
    assert.deepEqual(await service.remove({ id: wl.id, confirmName: wl.name, actor }), { status: 'deleting' });
  });

  await t.test('a queued one that never started is just cancelled', async () => {
    const queued = await service.create(input(3), actor);
    assert.deepEqual(await service.remove({ id: queued.id, confirmName: queued.name, actor }), { status: 'deleted' });
    assert.equal((await one(`SELECT status, step FROM whitelabel_jobs WHERE whitelabel_id = :id`, { id: queued.id })).step, 'cancelled');
    // Its names are free again.
    const again = await service.create(input(3), actor);
    assert.equal(again.status, 'queued');
  });
});
