'use strict';

// The company chooses its transaction password on the forced change (separate mode).
process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');
const { hashPassword, verifyPassword, TokenService, TOKEN_TYPES } = require('@ibitplay/auth');

const { WhitelabelLinkService, PALETTE_KEYS } = require('../whitelabelLink.service');
const publicRoutes = require('../routes/public.routes');
const { ExchangeService } = require('../../exchange/exchange.service');
const { StaffService } = require('../../staff/staff.service');
const { readOwnerDirectBalance, moveOwnerDirectToAgentSystem } = require('../../lords/ownerWallet');
const migration = require('../../../../../../packages/db/migrations/171-whitelabel-link');

/**
 * A whitelabel copy and its parent: the company cannot fund itself, the parent's transfer lands
 * once however often it is retried, Direct → Agent System moves only what is there, the preview
 * link works once, and the link's keyed routes answer only a direct call with the key.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const config = {
  SERVICE_NAME: 'admin-service',
  JWT_ACCESS_SECRET: 'whitelabel-test-access',
  JWT_REFRESH_SECRET: 'whitelabel-test-refresh',
  JWT_ADMIN_SECRET: 'whitelabel-test-admin',
  WHITELABEL_MODE: true,
  WHITELABEL_LINK_KEY: 'whitelabel-test-key',
  RATE_LIMIT_ENABLED: false,
};
const tag = `wl${process.pid % 100_000}`;
const logger = createLogger({ name: 'whitelabel-test', level: 'silent' });

test('a whitelabel company cannot fund itself; the move needs whitelabel mode', async () => {
  const company = new ExchangeService({ config });
  const actor = { id: 1, level: 1, canIssueFunds: true };
  for (const call of [() => company.ownerAddBalance({ actor, amount: '10' }), () => company.ownerAddDirectBalance({ actor, amount: '10' })]) {
    await assert.rejects(call, (err) => err.code === 'WHITELABEL_NO_SELF_FUNDING' && err.status === 403);
  }
  const parent = new ExchangeService({ config: { WHITELABEL_MODE: false } });
  await assert.rejects(() => parent.ownerMoveToAgentSystem({ actor, amount: '10' }), (err) => err.code === 'WHITELABEL_ONLY');
});

test('the link answers keyed routes only to a direct call with the key', async (t) => {
  const fake = {
    status: async () => ({ maintenance: false }),
    summary: async () => ({ ok: true }),
  };
  const app = express();
  app.use(express.json());
  app.use(publicRoutes({ config, whitelabelLinkService: fake }));
  app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ code: err.code }));
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${base}/status`)).status, 200, 'status needs no key');
  assert.equal((await fetch(`${base}/summary`)).status, 401, 'no key');
  assert.equal((await fetch(`${base}/summary`, { headers: { 'x-whitelabel-key': 'wrong' } })).status, 401, 'wrong key');
  assert.equal(
    (await fetch(`${base}/summary`, { headers: { 'x-whitelabel-key': config.WHITELABEL_LINK_KEY, 'x-forwarded-for': '1.2.3.4' } })).status,
    401,
    'through the gateway / Apache'
  );
  assert.equal((await fetch(`${base}/summary`, { headers: { 'x-whitelabel-key': config.WHITELABEL_LINK_KEY } })).status, 200);

  const put = (palette) =>
    fetch(`${base}/palette`, {
      method: 'PUT',
      headers: { 'x-whitelabel-key': config.WHITELABEL_LINK_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ palette }),
    });
  const { bg: _missing, ...partial } = Object.fromEntries(PALETTE_KEYS.map((k) => [k, '#112233']));
  assert.equal((await put(partial)).status, 422, 'every token is required');
  assert.equal((await put({ ...partial, bg: 'red' })).status, 422, 'only #RRGGBB');
});

test('whitelabel link against a database', async (t) => {
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
  await migration.up({ sequelize });

  // A level-1 role and the company on it; the service takes the lowest-id level-1 account.
  // 7_200_000+: clear of the 9500–10500 roles the staff suites seed and re-level.
  const roleId = 7_200_000 + (process.pid % 100_000);
  const companyId = 600_000 + (process.pid % 1000) * 10; // below the 700_000+ ids other suites seed
  const cleanup = async () => {
    await q(`DELETE FROM whitelabel_inbound_credits WHERE transfer_id LIKE :p`, { p: `${tag}%` });
    await q(`DELETE FROM mssports.point_ledger WHERE wallet_id IN (SELECT id FROM credits WHERE staff_id = :id)`, { id: companyId });
    await q(`DELETE FROM owner_direct_ledger WHERE owner_id = :id`, { id: companyId });
    await q(`DELETE FROM staff_transfers WHERE to_id = :id AND to_type = 'staff'`, { id: companyId });
    await q(`DELETE FROM staff_balances WHERE staff_id = :id`, { id: companyId });
    await q(`DELETE FROM credits WHERE staff_id = :id`, { id: companyId });
    await q(`DELETE FROM staff_hierarchy WHERE ancestor_id = :id OR descendant_id = :id`, { id: companyId });
    await q(`DELETE FROM staff WHERE id = :id`, { id: companyId });
  };
  t.after(async () => {
    try {
      await cleanup();
      await q(`DELETE FROM roles WHERE id = :id`, { id: roleId });
      await q(`UPDATE whitelabel_settings SET maintenance = false WHERE id = 1`);
    } finally {
      await connection.close();
    }
  });

  await cleanup();
  await q(`INSERT INTO roles (id, name, level) VALUES (:id, :name, 1) ON CONFLICT (id) DO UPDATE SET level = 1`, { id: roleId, name: `Company ${tag}` });
  await models.Staff.create({
    id: companyId,
    name: `company-${tag}`,
    email: `company-${tag}@test.invalid`,
    password: await hashPassword('Given-Pass-1', 4),
    role_id: roleId,
    status: 'active',
    must_change_password: true,
  });
  await q(`SELECT setval('staff_id_seq', GREATEST((SELECT MAX(id) FROM staff), 1))`);

  const service = new WhitelabelLinkService({ models, db: connection, logger, config });
  const { company } = await service.summary();
  if (company.id !== companyId) {
    t.skip(`another level-1 account (${company.id}) sits below the test company`);
    return;
  }
  const direct = async () => money.toMinorQuantised(await readOwnerDirectBalance(models, companyId));
  // Amounts come back at the platform's scale ("135.50000000"): compare the value.
  const same = (actual, expected, message) => assert.equal(money.toMinorQuantised(actual), money.toMinor(expected), message);

  await t.test('the parent transfer lands once', async () => {
    const first = await service.credit({ transferId: `${tag}-1`, amount: '125.50' });
    assert.equal(first.replayed, false);
    assert.equal(await direct(), money.toMinor('125.50'));

    const retry = await service.credit({ transferId: `${tag}-1`, amount: '125.50' });
    assert.equal(retry.replayed, true);
    assert.equal(await direct(), money.toMinor('125.50'), 'a retry pays nothing');

    await assert.rejects(() => service.credit({ transferId: `${tag}-1`, amount: '99' }), (err) => err.code === 'WHITELABEL_TRANSFER_MISMATCH');

    const both = await Promise.all([service.credit({ transferId: `${tag}-2`, amount: '10' }), service.credit({ transferId: `${tag}-2`, amount: '10' })]);
    assert.deepEqual(both.map((r) => r.replayed).sort(), [false, true], 'two concurrent calls, one payment');
    assert.equal(await direct(), money.toMinor('135.50'));

    const summary = await service.summary();
    same(summary.balances.direct, '135.50');
    same(summary.received, '135.50');
  });

  await t.test('Direct → Agent System moves only what is there', async () => {
    const moved = await connection.transaction((transaction) =>
      moveOwnerDirectToAgentSystem(models, { ownerId: companyId, amount: '100' }, { transaction })
    );
    same(moved.directBalance, '35.50');
    same(moved.balance, '100');

    await assert.rejects(
      () => connection.transaction((transaction) => moveOwnerDirectToAgentSystem(models, { ownerId: companyId, amount: '35.51' }, { transaction })),
      (err) => err.code === 'INSUFFICIENT_FUNDS' && err.details?.party === 'owner_direct'
    );
    assert.equal(await direct(), money.toMinor('35.50'), 'a refused move changes nothing');
    same((await service.summary()).balances.agentSystem, '100');

  });

  await t.test('first login: the company sets its password and chooses its transaction password', async () => {
    const staff = new StaffService({ models, db: connection, logger, config, clients: { admin: {} } });
    const result = await staff.changePassword({
      actor: { id: companyId, level: 1 },
      oldPassword: 'Given-Pass-1',
      newPassword: 'Own-Pass-123',
      transactionPassword: '482915',
    });
    assert.equal(result.transactionPasswordSet, true);
    assert.equal(result.transactionPassword, undefined, 'a chosen code is not echoed');
    const row = await models.Staff.findByPk(companyId, { raw: true });
    assert.equal(row.must_change_password, false);
    assert.equal(await verifyPassword('482915', row.transaction_password), true);
  });

  await t.test('the parent resets the company password', async () => {
    const before = await models.Staff.findByPk(companyId, { raw: true });
    await service.setCompanyPassword('Reset-Pass-99');
    const after = await models.Staff.findByPk(companyId, { raw: true });
    assert.equal(await verifyPassword('Reset-Pass-99', after.password), true);
    assert.equal(after.must_change_password, true, 'the company must choose its own again');
    assert.equal(Number(after.token_version), Number(before.token_version ?? 0) + 1, 'company sessions end');
  });

  await t.test('preview: a one-time code for a read-only company session', async () => {
    const { code } = await service.preview();
    const session = await service.redeemPreview(code);
    assert.equal(session.readOnly, true);
    assert.equal(session.mustChangePassword, false);
    const payload = new TokenService(config).verify(session.token, TOKEN_TYPES.ADMIN);
    assert.equal(payload.ro, true);
    assert.equal(Number(payload.sub), companyId);
    await assert.rejects(() => service.redeemPreview(code), (err) => err.code === 'WHITELABEL_PREVIEW_INVALID', 'used once');

    const late = await service.preview();
    for (const entry of service.previews.values()) entry.expires = Date.now() - 1;
    await assert.rejects(() => service.redeemPreview(late.code), (err) => err.code === 'WHITELABEL_PREVIEW_INVALID', 'expired');
  });

  await t.test('custom palette for the player site', async () => {
    const palette = Object.fromEntries(PALETTE_KEYS.map((k, i) => [k, `#${String(i).padStart(2, '0')}AA33`]));
    assert.deepEqual(await service.setPalette(palette), { palette });
    assert.deepEqual(await service.theme(), { palette });
    assert.deepEqual(await service.setPalette(null), { palette: null }, 'null = the owner template again');
  });

  await t.test('maintenance switch', async () => {
    assert.deepEqual(await service.setMaintenance(true), { maintenance: true });
    assert.deepEqual(await service.status(), { maintenance: true });
    assert.deepEqual(await service.setMaintenance(false), { maintenance: false });
  });
});
