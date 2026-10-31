'use strict';

const test = require('node:test');
const assert = require('node:assert');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const db = require('@ibitplay/db');
const { createLogger, money } = require('@ibitplay/common');

const { CurrenciesService, cleanCoinDefinition } = require('../currencies.service');

/**
 * Coin management phase B: the owner's `coins[]` applied to the registry
 * (`CurrenciesService.applyOwnerDocument`), against the migrated test
 * database. Every row it creates is removed after; the built-in row it checks
 * is snapshotted and restored.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const SUFFIX = String(process.pid % 100_000);
const QA = `QA${SUFFIX}`;
const QB = `QB${SUFFIX}`;

const doc = (coins, extra = {}) => ({ version: 7, source: 'owner', features: {}, flags: {}, coins, ...extra });
const qa = (over = {}) => ({
  code: QA, kind: 'points', name: 'QA coin', symbol: 'QAC', decimals: 2, usdRate: '0.01', networks: [], enabled: true, ...over,
});

test('owner custom coins (applyOwnerDocument)', async (t) => {
  const logger = createLogger({ name: 'custom-coins-test', level: 'silent' });

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
    await connection.sequelize.query('SELECT usd_rate FROM currencies LIMIT 1');
  } catch (error) {
    if (connection) await connection.close();
    t.skip(`No migrated test database reachable (${error.message})`);
    return;
  }

  const { sequelize } = connection;
  const q = (sql, replacements) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
  const { Currency } = connection.models;
  const service = new CurrenciesService({ models: connection.models, logger, config: {}, clients: null });

  const usdt = await Currency.findByPk('USDT', { raw: true });
  // A managed apply stamps every row `managed_by = 'owner'` and re-derives
  // `owner_enabled`: restore both on every row after.
  const switches = await q('SELECT code, owner_enabled, managed_by FROM currencies');
  const ratesBefore = await q("SELECT id, currency, usd_rate, managed_by FROM exchangerate WHERE UPPER(currency) = 'USDT'");

  async function cleanup() {
    const codes = [QA, QB];
    await q('DELETE FROM wallet_balances WHERE currency IN (:codes) RETURNING uid', { codes });
    await q('DELETE FROM exchangerate WHERE UPPER(currency) IN (:codes) RETURNING id', { codes });
    await q('DELETE FROM currencies WHERE code IN (:codes) AND builtin = false RETURNING code', { codes });
  }
  t.after(async () => {
    await cleanup();
    await Currency.update(
      { name: usdt.name, symbol: usdt.symbol, decimals: usdt.decimals, kind: usdt.kind, owner_enabled: usdt.owner_enabled, managed_by: usdt.managed_by, usd_rate: usdt.usd_rate ?? null },
      { where: { code: 'USDT' } }
    );
    for (const r of switches) {
      await q('UPDATE currencies SET owner_enabled = :on, managed_by = :by WHERE code = :code RETURNING code', { on: r.owner_enabled, by: r.managed_by, code: r.code });
    }
    for (const r of ratesBefore) {
      await q('UPDATE exchangerate SET usd_rate = :rate, managed_by = :by WHERE id = :id RETURNING id', { rate: r.usd_rate, by: r.managed_by, id: r.id });
    }
    await connection.close();
  });
  await cleanup();

  const row = (code) => Currency.findByPk(code, { raw: true });
  const rate = async (code) => (await q('SELECT usd_rate, managed_by FROM exchangerate WHERE UPPER(currency) = :code', { code }))[0];

  await t.test('a definition is checked again on the backend', () => {
    assert.ok(cleanCoinDefinition(qa()).coin);
    assert.equal(cleanCoinDefinition(qa({ code: 'usdt1x' })).problem, 'bad code');
    assert.match(cleanCoinDefinition(qa({ code: 'USDT' })).problem, /built-in/);
    assert.match(cleanCoinDefinition(qa({ decimals: 9 })).problem, /0–8/);
    assert.match(cleanCoinDefinition(qa({ usdRate: '0' })).problem, /usdRate/);
    assert.match(cleanCoinDefinition(qa({ usdRate: '0.000000001' })).problem, /usdRate/);
    assert.equal(cleanCoinDefinition(qa({ name: '<b>x</b>' })).problem, 'bad name');
    assert.equal(cleanCoinDefinition(qa({ kind: 'stock' })).problem, 'bad kind');
    // Networks only for crypto, keys cleaned, duplicates dropped.
    const crypto = cleanCoinDefinition(qa({ kind: 'crypto', networks: [{ key: 'TRC20', name: 'Tron' }, { key: 'TRC20', name: 'dup' }, { key: 'bad key!', name: 'x' }] })).coin;
    assert.deepEqual(crypto.networks, [{ key: 'TRC20', name: 'Tron' }]);
    assert.deepEqual(cleanCoinDefinition(qa({ networks: [{ key: 'TRC20', name: 'Tron' }] })).coin.networks, []);
  });

  await t.test('a new coin is inserted as a custom, owner-managed row with its rate', async () => {
    const result = await service.applyOwnerDocument(doc([qa()]));
    assert.deepEqual(result.created, [QA]);
    const r = await row(QA);
    assert.equal(r.builtin, false);
    assert.equal(r.kind, 'points');
    assert.equal(Number(r.decimals), 2);
    assert.equal(r.name, 'QA coin');
    assert.equal(r.symbol, 'QAC');
    assert.equal(r.owner_enabled, true);
    assert.equal(r.site_enabled, true);
    assert.equal(r.managed_by, 'owner');
    assert.equal(money.fromStored(r.usd_rate), '0.01000000');
    const er = await rate(QA);
    assert.equal(money.fromStored(er.usd_rate), '0.01000000');
    assert.equal(er.managed_by, 'owner');

    const listed = (await service.publicList()).find((c) => c.code === QA);
    assert.ok(listed, 'players see the new coin');
    assert.equal((await service.ownerList()).find((c) => c.code === QA).usdRate, '0.01000000');
  });

  await t.test('applying the same document again changes nothing', async () => {
    const before = await row(QA);
    const result = await service.applyOwnerDocument(doc([qa()]));
    assert.deepEqual(result.created, []);
    assert.deepEqual(result.updated, []);
    assert.deepEqual(result.switched, []);
    const after = await row(QA);
    assert.equal(String(after.updated_at), String(before.updated_at));
  });

  await t.test("the owner's columns update; the site's rename and switch stay", async () => {
    await Currency.update({ name: 'Site name', symbol: 'SN' }, { where: { code: QA } });
    const result = await service.applyOwnerDocument(doc([qa({ name: 'Owner rename', decimals: 4, usdRate: '0.02' })]));
    assert.deepEqual(result.updated, [QA]);
    const r = await row(QA);
    assert.equal(r.name, 'Site name');
    assert.equal(r.symbol, 'SN');
    assert.equal(Number(r.decimals), 4);
    assert.equal(money.fromStored(r.usd_rate), '0.02000000');
    assert.equal(money.fromStored((await rate(QA)).usd_rate), '0.02000000');
  });

  await t.test('network keys are the owner\'s; a kept key keeps the site\'s name and switch', async () => {
    await service.applyOwnerDocument(doc([qa({ kind: 'crypto', networks: [{ key: 'TRC20', name: 'Tron' }] })]));
    await Currency.update({ networks: [{ key: 'TRC20', name: 'Tron (site)', enabled: false }] }, { where: { code: QA } });
    await service.applyOwnerDocument(doc([qa({ kind: 'crypto', networks: [{ key: 'TRC20', name: 'Tron' }, { key: 'BEP20', name: 'BSC' }] })]));
    assert.deepEqual((await row(QA)).networks, [
      { key: 'TRC20', name: 'Tron (site)', enabled: false },
      { key: 'BEP20', name: 'BSC', enabled: true },
    ]);
    await service.applyOwnerDocument(doc([qa()]));
    assert.deepEqual((await row(QA)).networks, []);
  });

  await t.test('a built-in coin is never overwritten from coins[]', async () => {
    await service.applyOwnerDocument(doc([qa(), { code: 'USDT', kind: 'points', name: 'Hijack', decimals: 0, usdRate: '999' }]));
    const r = await row('USDT');
    assert.equal(r.builtin, true);
    assert.equal(r.name, usdt.name);
    assert.equal(r.kind, usdt.kind);
    assert.equal(Number(r.decimals), Number(usdt.decimals));
    const er = await rate('USDT');
    if (er) assert.notEqual(money.fromStored(er.usd_rate), '999.00000000');
  });

  await t.test('enabled: false switches the coin off; it is never deleted', async () => {
    const result = await service.applyOwnerDocument(doc([qa({ enabled: false })]));
    assert.deepEqual(result.switched, [{ code: QA, ownerEnabled: false }]);
    const r = await row(QA);
    assert.ok(r, 'still there');
    assert.equal(r.owner_enabled, false);
    assert.equal((await service.publicList()).some((c) => c.code === QA), false, 'players no longer see it');
    assert.equal((await service.list()).find((c) => c.code === QA).enabled, false);

    await service.applyOwnerDocument(doc([qa()]));
    assert.equal((await row(QA)).owner_enabled, true, 'and back on');
  });

  await t.test('a coin the document no longer lists is switched off, not deleted', async () => {
    await service.applyOwnerDocument(doc([qa(), qa({ code: QB, name: 'QB coin' })]));
    assert.equal((await row(QB)).owner_enabled, true);
    await service.applyOwnerDocument(doc([qa()]));
    assert.equal((await row(QB)).owner_enabled, false);
    assert.equal((await row(QA)).owner_enabled, true);
  });

  await t.test('the per-coin flag still applies to a custom coin', async () => {
    await service.applyOwnerDocument(doc([qa()], { flags: { [QA.toLowerCase()]: false } }));
    assert.equal((await row(QA)).owner_enabled, false);
    await service.applyOwnerDocument(doc([qa()]));
    assert.equal((await row(QA)).owner_enabled, true);
  });

  await t.test('the built-in default (no owner document) leaves custom coins alone', async () => {
    await service.applyOwnerDocument({ version: 0, source: 'default', features: {}, flags: {}, coins: [] });
    assert.equal((await row(QA)).owner_enabled, true);
  });

  await t.test('a site admin may rename and switch a custom coin within the grant', async () => {
    const updated = await service.update({ code: QA, patch: { name: 'Quality coin', enabled: false }, staff: { id: 1 } });
    assert.equal(updated.name, 'Quality coin');
    assert.equal(updated.siteEnabled, false);
    const on = await service.update({ code: QA, patch: { enabled: true }, staff: { id: 1 } });
    assert.equal(on.enabled, true);
  });
});
