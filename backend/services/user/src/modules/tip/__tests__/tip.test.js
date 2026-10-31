'use strict';

const test = require('node:test');
const assert = require('node:assert');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, money, entitlements, errorHandler, requestContext } = require('@ibitplay/common');

const { TipService, escapeLike } = require('../tip.service');
const { PreferencesService } = require('../../preferences/preferences.service');
const { configureNotifier } = require('../../notifications/notifyPlayer');
const { INTERNAL_PATH: TIP_LIMITS_PATH, DEFAULTS: TIP_LIMIT_DEFAULTS } = require('../tipLimits');

/**
 * Peer-to-peer tips against a real PostgreSQL (migration 077): the money
 * moves through the wallet spine, so every assertion about balances is also
 * an assertion about the ledger.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

// A uid range no other test file uses (bigint columns throughout), and names
// all starting `tipt` so a crashed run's leftovers are found by name.
let nextUid = 5_000_000_000 + Math.floor(process.pid % 100_000) * 1000;
const usedUids = new Set();
const newUid = () => {
  nextUid += 1;
  usedUids.add(nextUid);
  return nextUid;
};

const rejectsWith = async (promise, code, status) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code, `expected ${code}, got ${error.code} (${error.message})`);
    if (status) assert.equal(error.statusCode ?? error.status, status);
    return true;
  });
};

test('tips', async (t) => {
  const logger = createLogger({ name: 'tip-test', level: 'silent' });
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
      service: 'user-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }

  const m = connection.models;
  const { Op } = require('sequelize');
  const sql = (query, replacements = {}) =>
    connection.sequelize.query(query, { replacements, type: connection.sequelize.QueryTypes.SELECT });

  const purge = async (ids) => {
    await m.Tip.destroy({ where: { [Op.or]: [{ from_user_id: ids }, { to_user_id: ids }] } });
    const strIds = Array.isArray(ids) ? ids.map(String) : ids;
    await m.CreditsLedger.destroy({ where: { user_id: strIds } });
    await m.WalletHistory.destroy({ where: { uid: ids } });
    await m.Userconfig.destroy({ where: { uid: ids } });
    await m.Userwager.destroy({ where: { uid: ids } });
    await m.UserKyc.destroy({ where: { user_id: Array.isArray(ids) ? ids.map(String) : String(ids) } });
    await m.Credits.destroy({ where: { uid: ids } });
    await m.Users.destroy({ where: { id: ids } });
  };

  // Leftovers from a crashed earlier run in this file's uid range.
  const stale = (await m.Users.findAll({ where: { name: { [Op.or]: [{ [Op.like]: 'tipt%' }, { [Op.like]: 'tipr%' }] }, id: { [Op.gte]: 5_000_000_000 } }, attributes: ['id'], raw: true }))
    .map((u) => Number(u.id));
  if (stale.length) await purge(stale);

  const notified = [];
  let notifyFails = false;
  const fakeAdmin = {
    get: async () => ({ ids: [1] }),
    request: async (_method, _path, { body }) => {
      if (notifyFails) throw new Error('admin-service down');
      notified.push(body);
      return { created: true, id: notified.length, unread: 1 };
    },
  };
  configureNotifier({ clients: { admin: fakeAdmin }, logger });

  t.after(async () => {
    configureNotifier(null);
    entitlements.resetEntitlements();
    try {
      if (usedUids.size) await purge([...usedUids]);
    } finally {
      await connection.close();
    }
  });

  // USD per unit, for a stubbed `rewardMoney` — 80 INR = $1. BTC has no rate on purpose.
  const RATES = { USD: '1', USDT: '1', INR: '0.0125' };
  const rateOf = (code) => RATES[String(code).toUpperCase()] ?? null;
  const fakeRewardMoney = {
    toUsd: async (amount, from) => {
      const rate = rateOf(from);
      return rate ? money.toDecimalString(money.multiply(String(amount), rate)) : null;
    },
    convert: async (amount, from, to) => {
      const a = rateOf(from);
      const b = rateOf(to);
      if (!a || !b) return null;
      return money.toDecimalString(money.divide(money.multiply(String(amount), a), b));
    },
  };

  // The operator's limits, as the stubbed resolver answers them. The shipped defaults unless a
  // case sets its own (and puts them back in `finally`).
  let currentLimits = { ...TIP_LIMIT_DEFAULTS };
  const withLimits = async (limits, fn) => {
    currentLimits = { ...TIP_LIMIT_DEFAULTS, ...limits };
    try {
      return await fn();
    } finally {
      currentLimits = { ...TIP_LIMIT_DEFAULTS };
    }
  };

  const deps = {
    models: m,
    db: connection,
    logger,
    config: { SERVICE_NAME: 'user-service', ROOT_STAFF_ID: 1 },
    clients: { admin: fakeAdmin },
    tipLimits: { limits: async () => currentLimits },
    rewardMoney: fakeRewardMoney,
    // The withdraw-style rules (KYC, wagering, caps) are covered by tipRequirements.test.js.
    withdrawRequirements: { assertMet: async () => null, assertCapInTransaction: async () => {} },
  };
  const tips = new TipService(deps);

  const run = `${process.pid}${Date.now() % 100000}`;
  // A tip is money out and passes the withdraw requirements (KYC among them), so every seeded
  // player is KYC Verified unless a case asks otherwise (`kyc: null` = never submitted).
  const seed = async ({ inr = null, prefix = 'tipt', status = 'active', parent = null, kyc = 'Verified' } = {}) => {
    const id = newUid();
    const name = `${prefix}_${run}_${id % 1000}`;
    await m.Users.create({ id, name, password: 'x', status, parent_staff_id: parent });
    if (kyc) await m.UserKyc.create({ user_id: String(id), status: kyc });
    if (inr !== null) await m.Credits.create({ uid: id, inr });
    return { id, name };
  };
  const balanceOf = async (uid) => {
    const row = await m.Credits.findOne({ where: { uid }, raw: true });
    return row ? money.fromStored(String(row.inr ?? '0')) : null;
  };
  const tipCount = async (uid) => m.Tip.count({ where: { [Op.or]: [{ from_user_id: uid }, { to_user_id: uid }] } });
  const ledgerCount = async (uid) => m.CreditsLedger.count({ where: { user_id: String(uid) } });

  // ══════════════════════════════════════════════════════════════════════

  await t.test('send moves the money and writes the tip and two ledger rows together', async () => {
    const a = await seed({ inr: '1000' });
    const b = await seed(); // no wallet row yet: the tip creates it

    const out = await tips.send({ userId: a.id, toUsername: b.name.toUpperCase(), currency: 'inr', amount: '125.5', note: 'gg' });

    assert.equal(out.toUsername, b.name);
    assert.equal(out.currency, 'INR');
    assert.equal(out.amount, '125.50000000');
    assert.equal(out.balance, '874.50000000');
    assert.ok(Number.isInteger(out.tipId));

    assert.equal(await balanceOf(a.id), '874.50000000');
    assert.equal(await balanceOf(b.id), '125.50000000');

    const tip = await m.Tip.findByPk(out.tipId, { raw: true });
    assert.equal(Number(tip.from_user_id), a.id);
    assert.equal(Number(tip.to_user_id), b.id);
    assert.equal(tip.note, 'gg');

    const sent = await m.CreditsLedger.findOne({ where: { idempotency_key: `tip:${out.tipId}:sent` }, raw: true });
    const received = await m.CreditsLedger.findOne({ where: { idempotency_key: `tip:${out.tipId}:received` }, raw: true });
    assert.equal(sent.reason, 'TIP_SENT');
    assert.equal(sent.user_id, String(a.id));
    assert.equal(money.fromStored(String(sent.amount)), '-125.50000000');
    assert.equal(received.reason, 'TIP_RECEIVED');
    assert.equal(received.user_id, String(b.id));
    assert.equal(money.fromStored(String(received.amount)), '125.50000000');
    assert.equal(String(tip.from_ledger_id), String(sent.id));
    assert.equal(String(tip.to_ledger_id), String(received.id));

    // The receiver is told, keyed on the tip.
    await new Promise((r) => setTimeout(r, 20));
    const note = notified.find((n) => n.key === `tip:${out.tipId}`);
    assert.ok(note, 'the receiver was notified');
    assert.equal(note.userId, b.id);
    assert.equal(note.title, 'You got a tip');
    assert.equal(note.body, `${a.name} sent you 125.50 INR`);
  });

  await t.test('a failing notification does not fail the tip', async () => {
    const a = await seed({ inr: '50' });
    const b = await seed({ inr: '0' });
    notifyFails = true;
    try {
      const out = await tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '5' });
      assert.equal(out.balance, '45.00000000');
    } finally {
      notifyFails = false;
    }
    assert.equal(await balanceOf(b.id), '5.00000000');
  });

  await t.test('insufficient balance leaves both wallets, the tips table and the ledger unchanged', async () => {
    const a = await seed({ inr: '10' });
    const b = await seed({ inr: '3' });

    await rejectsWith(tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '10.01' }), 'TIP_INSUFFICIENT_BALANCE', 400);

    assert.equal(await balanceOf(a.id), '10.00000000');
    assert.equal(await balanceOf(b.id), '3.00000000');
    assert.equal(await tipCount(a.id), 0);
    assert.equal(await ledgerCount(a.id), 0);
    assert.equal(await ledgerCount(b.id), 0);

    // No wallet row at all is the same answer, and creates nothing for the receiver.
    const broke = await seed();
    const fresh = await seed();
    await rejectsWith(tips.send({ userId: broke.id, toUsername: fresh.name, currency: 'INR', amount: '1' }), 'TIP_INSUFFICIENT_BALANCE', 400);
    assert.equal(await balanceOf(fresh.id), null);
  });

  await t.test('a self-tip is refused, whatever the case of the name', async () => {
    const a = await seed({ inr: '100' });
    await rejectsWith(tips.send({ userId: a.id, toUsername: a.name.toUpperCase(), currency: 'INR', amount: '1' }), 'TIP_SELF', 400);
    assert.equal(await balanceOf(a.id), '100.00000000');
  });

  await t.test('an unknown username is a 404', async () => {
    const a = await seed({ inr: '100' });
    await rejectsWith(tips.send({ userId: a.id, toUsername: `nobody_${run}`, currency: 'INR', amount: '1' }), 'TIP_USER_NOT_FOUND', 404);
  });

  await t.test('a recipient who switched tips off is refused; switching back on accepts again', async () => {
    const a = await seed({ inr: '100' });
    const b = await seed({ inr: '0' });

    assert.equal((await tips.getSettings({ userId: b.id })).enabled, true);
    assert.deepEqual(await tips.updateSettings({ userId: b.id, enabled: false }), { enabled: false });
    assert.equal((await tips.getSettings({ userId: b.id })).enabled, false);

    // Saving another preference does not reset the switch.
    await new PreferencesService({ models: m, logger }).update({ userId: b.id, theme: 'light' });
    assert.equal((await tips.getSettings({ userId: b.id })).enabled, false);

    await rejectsWith(tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '1' }), 'TIP_DISABLED_BY_RECIPIENT', 400);
    assert.equal(await balanceOf(a.id), '100.00000000');

    // Hidden from the picker too.
    assert.deepEqual(await tips.searchUsers({ userId: a.id, q: b.name }), []);

    await tips.updateSettings({ userId: b.id, enabled: true });
    await tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '1' });
    assert.equal(await balanceOf(b.id), '1.00000000');
  });

  await t.test('blocked accounts can neither receive nor send', async () => {
    const a = await seed({ inr: '100' });
    const blocked = await seed({ inr: '100', status: 'suspended' });

    await rejectsWith(tips.send({ userId: a.id, toUsername: blocked.name, currency: 'INR', amount: '1' }), 'TIP_RECIPIENT_UNAVAILABLE', 400);
    await rejectsWith(tips.send({ userId: blocked.id, toUsername: a.name, currency: 'INR', amount: '1' }), 'TIP_SENDER_BLOCKED', 403);

    await m.Users.update({ status: 'active', is_locked: true }, { where: { id: blocked.id } });
    await rejectsWith(tips.send({ userId: a.id, toUsername: blocked.name, currency: 'INR', amount: '1' }), 'TIP_RECIPIENT_UNAVAILABLE', 400);
    assert.equal(await balanceOf(a.id), '100.00000000');
    assert.equal(await balanceOf(blocked.id), '100.00000000');
  });

  await t.test('below the per-currency minimum is refused (INR 1)', async () => {
    const a = await seed({ inr: '100' });
    const b = await seed({ inr: '0' });
    await rejectsWith(tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '0.99' }), 'TIP_MIN_AMOUNT', 400);
  });

  await t.test('history shows both directions with the right counterparty', async () => {
    const a = await seed({ inr: '100' });
    const b = await seed({ inr: '100' });
    const c = await seed({ inr: '100' });

    const t1 = await tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '10', note: 'first' });
    const t2 = await tips.send({ userId: c.id, toUsername: a.name, currency: 'INR', amount: '7' });

    const page = await tips.history({ userId: a.id, limit: 20, offset: 0 });
    assert.equal(page.total, 2);
    const byId = new Map(page.rows.map((r) => [r.id, r]));

    assert.deepEqual(
      { direction: byId.get(t1.tipId).direction, counterparty: byId.get(t1.tipId).counterparty, amount: byId.get(t1.tipId).amount, note: byId.get(t1.tipId).note },
      { direction: 'sent', counterparty: { id: b.id, name: b.name }, amount: '10.00000000', note: 'first' }
    );
    assert.deepEqual(
      { direction: byId.get(t2.tipId).direction, counterparty: byId.get(t2.tipId).counterparty, amount: byId.get(t2.tipId).amount, note: byId.get(t2.tipId).note },
      { direction: 'received', counterparty: { id: c.id, name: c.name }, amount: '7.00000000', note: null }
    );
    assert.equal(page.rows[0].id, t2.tipId, 'newest first');
    assert.ok(page.rows[0].createdAt);

    const second = await tips.history({ userId: a.id, limit: 1, offset: 1 });
    assert.equal(second.total, 2);
    assert.equal(second.rows.length, 1);
    assert.equal(second.rows[0].id, t1.tipId);
  });

  await t.test('the picker is a prefix match that treats % and _ literally', async () => {
    const me = await seed({ inr: '0', prefix: 'tiptpick' });
    const one = await seed({ inr: '0', prefix: 'tiptpick' });

    const found = await tips.searchUsers({ userId: me.id, q: `TIPTPICK_${run}` });
    const ids = found.map((r) => r.id);
    assert.ok(ids.includes(one.id));
    assert.ok(!ids.includes(me.id), 'the caller is excluded');
    assert.ok(found.length <= 8);

    // `pick%` would match everything named pick…; escaped it matches nothing.
    assert.deepEqual(await tips.searchUsers({ userId: me.id, q: 'tiptpick%' }), []);
    // `_` is literal: "pickX" does not match the pattern "pick_".
    assert.equal(escapeLike('a%b_c\\'), 'a\\%b\\_c\\\\');
  });

  await t.test('admin list: filters, the summary, and the staff tree scope', async () => {
    // Any real staff row other than the platform root owns B (users.parent_staff_id is a FK).
    const [owner] = await sql('SELECT id FROM staff WHERE id <> 1 ORDER BY id LIMIT 1');
    assert.ok(owner, 'the test database has a non-root staff row');
    const subAdmin = Number(owner.id);
    const a = await seed({ inr: '1000', prefix: 'tiptadm' });
    const b = await seed({ inr: '1000', prefix: 'tiptadm', parent: subAdmin });
    const c = await seed({ inr: '1000', prefix: 'tiptadm' });
    await m.Credits.update({ usdt: '50' }, { where: { uid: a.id } });

    await tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '10' });
    await tips.send({ userId: a.id, toUsername: c.name, currency: 'INR', amount: '20' });
    await tips.send({ userId: a.id, toUsername: c.name, currency: 'USDT', amount: '1.5' });

    const [{ today }] = await sql("SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today");
    const [{ yesterday }] = await sql("SELECT to_char(CURRENT_DATE - 1, 'YYYY-MM-DD') AS yesterday");

    // Search by the sender's name finds all three; the summary groups by coin.
    const all = await tips.adminList({ staff: { id: 1 }, limit: 50, offset: 0, search: a.name });
    assert.equal(all.total, 3);
    assert.equal(all.rows.length, 3);
    assert.deepEqual(all.rows[0].from, { id: a.id, name: a.name });
    assert.deepEqual(all.summary, {
      totalTips: 3,
      byCurrency: [
        { currency: 'INR', count: 2, amount: '30.00000000' },
        { currency: 'USDT', count: 1, amount: '1.50000000' },
      ],
    });

    // Search matches the receiver too, partially and case-insensitively.
    const toC = await tips.adminList({ staff: { id: 1 }, limit: 50, offset: 0, search: c.name.slice(2).toUpperCase() });
    assert.equal(toC.total, 2);

    const usdt = await tips.adminList({ staff: { id: 1 }, limit: 50, offset: 0, search: a.name, currency: 'usdt' });
    assert.equal(usdt.total, 1);
    assert.equal(usdt.rows[0].amount, '1.50000000');

    const inDay = await tips.adminList({ staff: { id: 1 }, limit: 50, offset: 0, search: a.name, from: today, to: today });
    assert.equal(inDay.total, 3);
    const before = await tips.adminList({ staff: { id: 1 }, limit: 50, offset: 0, search: a.name, to: yesterday });
    assert.equal(before.total, 0);
    assert.deepEqual(before.summary, { totalTips: 0, byCurrency: [] });

    const paged = await tips.adminList({ staff: { id: 1 }, limit: 1, offset: 0, search: a.name });
    assert.equal(paged.rows.length, 1);
    assert.equal(paged.total, 3);

    // A sub-admin whose tree is just that staff row sees only the tip that touches B.
    const scoped = new TipService({ ...deps, clients: { admin: { ...fakeAdmin, get: async () => ({ ids: [subAdmin] }) } } });
    const mine = await scoped.adminList({ staff: { id: subAdmin }, limit: 50, offset: 0, search: a.name });
    assert.equal(mine.total, 1);
    assert.deepEqual(mine.rows[0].to, { id: b.id, name: b.name });

    // An empty tree sees nothing.
    const none = new TipService({ ...deps, clients: { admin: { ...fakeAdmin, get: async () => ({ ids: [] }) } } });
    assert.deepEqual(await none.adminList({ staff: { id: 999 }, limit: 50, offset: 0 }), { rows: [], total: 0, summary: { totalTips: 0, byCurrency: [] } });
  });

  await t.test('rate limit: the 21st tip within an hour is refused and moves nothing', async () => {
    const a = await seed({ inr: '1000' });
    const b = await seed({ inr: '0' });

    await m.Tip.bulkCreate(
      Array.from({ length: 19 }, () => ({ from_user_id: a.id, to_user_id: b.id, currency: 'INR', amount: '1' }))
    );
    await tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '1' }); // the 20th
    assert.equal(await balanceOf(a.id), '999.00000000');

    await rejectsWith(tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '1' }), 'TIP_RATE_LIMITED', 429);
    assert.equal(await balanceOf(a.id), '999.00000000');
    assert.equal(await balanceOf(b.id), '1.00000000');

    // An hour later the window has moved on.
    await m.Tip.update({ created_at: new Date(Date.now() - 2 * 3600 * 1000) }, { where: { from_user_id: a.id } });
    await tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '1' });
    assert.equal(await balanceOf(b.id), '2.00000000');
  });

  await t.test('opposite-direction tips at the same time do not deadlock and conserve money', async () => {
    const a = await seed({ inr: '100' });
    const b = await seed({ inr: '100' });

    const jobs = [];
    for (let i = 0; i < 6; i += 1) {
      jobs.push(tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '2' }));
      jobs.push(tips.send({ userId: b.id, toUsername: a.name, currency: 'INR', amount: '3' }));
    }
    await Promise.all(jobs);

    assert.equal(await balanceOf(a.id), '106.00000000');
    assert.equal(await balanceOf(b.id), '94.00000000');
    assert.equal(await tipCount(a.id), 12);
  });

  await t.test('a retried send with the same requestId moves the money once', async () => {
    const a = await seed({ inr: '100' });
    const b = await seed({ inr: '0' });
    const requestId = require('node:crypto').randomUUID();

    const first = await tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '10', requestId });
    const again = await tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '10', requestId });
    assert.equal(again.tipId, first.tipId);
    assert.equal(again.replayed, true);
    assert.equal(await balanceOf(a.id), '90.00000000');
    assert.equal(await balanceOf(b.id), '10.00000000');
    assert.equal(await tipCount(a.id), 1);

    // A new requestId is a new tip.
    await tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '10', requestId: require('node:crypto').randomUUID() });
    assert.equal(await balanceOf(b.id), '20.00000000');
  });

  await t.test('the same requestId sent concurrently still moves the money once', async () => {
    const a = await seed({ inr: '100' });
    const b = await seed({ inr: '0' });
    const requestId = require('node:crypto').randomUUID();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '7', requestId }))
    );
    assert.equal(new Set(results.map((r) => r.tipId)).size, 1);
    assert.equal(await balanceOf(a.id), '93.00000000');
    assert.equal(await balanceOf(b.id), '7.00000000');
    assert.equal(await tipCount(a.id), 1);
  });

  // ══ Operator limits (USD, migration 081) ══════════════════════════════

  const rejectsWithDetails = async (promise, code, status) => {
    let caught;
    await assert.rejects(promise, (error) => {
      assert.equal(error.code, code, `expected ${code}, got ${error.code} (${error.message})`);
      assert.equal(error.statusCode ?? error.status, status);
      caught = error;
      return true;
    });
    return caught.details;
  };

  await t.test('limits: a tip above the per-tip cap is refused and moves nothing', async () => {
    const a = await seed({ inr: '5000' });
    const b = await seed({ inr: '0' });

    await withLimits({ maxPerTipUsd: '10', maxPerDayUsd: '0' }, async () => {
      // $10 at 80 INR/$ is 800 INR.
      const details = await rejectsWithDetails(
        tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '800.01' }),
        'TIP_OVER_PER_TIP_LIMIT',
        400
      );
      assert.deepEqual(details, { maxUsd: '10.00000000', maxInCurrency: '800.00000000', currency: 'INR' });
      assert.equal(await balanceOf(a.id), '5000.00000000');
      assert.equal(await balanceOf(b.id), '0.00000000');
      assert.equal(await tipCount(a.id), 0);
      assert.equal(await ledgerCount(a.id), 0);

      // Exactly at the cap is allowed.
      await tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '800' });
      assert.equal(await balanceOf(b.id), '800.00000000');
    });
  });

  await t.test('limits: on an INR site the caps are rupees, and a USDT tip is valued in rupees', async () => {
    const inrSite = new TipService({ ...deps, models: { ...m, SiteFeature: { findByPk: async () => ({ variant: 'INR' }) } } });
    const a = await seed({ inr: '5000' });
    const b = await seed({ inr: '0' });
    await m.Credits.update({ usdt: '100' }, { where: { uid: a.id } });

    await withLimits({ maxPerTipUsd: '1000', maxPerDayUsd: '0' }, async () => {
      const details = await rejectsWithDetails(
        inrSite.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '1000.01' }),
        'TIP_OVER_PER_TIP_LIMIT',
        400
      );
      assert.deepEqual(details, { maxUsd: '1000.00000000', maxInCurrency: '1000.00000000', currency: 'INR' });
      // 13 USDT is 1,040 INR at 80/$: over. 12 USDT is 960 INR: fine.
      await rejectsWith(inrSite.send({ userId: a.id, toUsername: b.name, currency: 'USDT', amount: '13' }), 'TIP_OVER_PER_TIP_LIMIT', 400);
      await inrSite.send({ userId: a.id, toUsername: b.name, currency: 'USDT', amount: '12' });
      await inrSite.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '1000' });
      assert.equal((await inrSite.getSettings({ userId: a.id })).limits.currency, 'INR');
    });
  });

  await t.test('limits: the daily cap sums the last 24h across currencies in USD', async () => {
    const a = await seed({ inr: '10000' });
    const b = await seed({ inr: '0' });
    await m.Credits.update({ usdt: '100', btc: '1' }, { where: { uid: a.id } });

    // Older than 24h: does not count. Inside: 800 INR ($10) + 5 USDT ($5) = $15.
    await m.Tip.bulkCreate([
      { from_user_id: a.id, to_user_id: b.id, currency: 'INR', amount: '5000', created_at: new Date(Date.now() - 25 * 3600 * 1000) },
      { from_user_id: a.id, to_user_id: b.id, currency: 'INR', amount: '800' },
      { from_user_id: a.id, to_user_id: b.id, currency: 'USDT', amount: '5' },
    ]);

    await withLimits({ maxPerTipUsd: '0', maxPerDayUsd: '20' }, async () => {
      assert.equal((await tips.getSettings({ userId: a.id })).limits.usedTodayUsd, '15.00000000');

      await tips.send({ userId: a.id, toUsername: b.name, currency: 'USDT', amount: '4' }); // $19

      // 80.01 INR is $1.000125 — over $20 by a hair.
      const details = await rejectsWithDetails(
        tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '80.01' }),
        'TIP_OVER_DAILY_LIMIT',
        400
      );
      assert.deepEqual(details, { maxUsd: '20.00000000', usedUsd: '19.00000000', remainingInCurrency: '80.00000000', currency: 'INR' });
      assert.equal(await balanceOf(a.id), '10000.00000000');

      // Landing exactly on the cap is allowed; after that nothing fits.
      await tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '80' });
      const full = await rejectsWithDetails(
        tips.send({ userId: a.id, toUsername: b.name, currency: 'USDT', amount: '0.01' }),
        'TIP_OVER_DAILY_LIMIT',
        400
      );
      assert.equal(full.usedUsd, '20.00000000');
      assert.equal(full.remainingInCurrency, '0.00000000');
      assert.deepEqual((await tips.getSettings({ userId: a.id })).limits, {
        maxPerTipUsd: '0.00000000',
        maxPerDayUsd: '20.00000000',
        minWageredUsd: '0.00000000',
        currency: 'USDT',
        usedTodayUsd: '20.00000000',
      });

      // A coin with no exchange rate is refused, not let through.
      await rejectsWith(tips.send({ userId: a.id, toUsername: b.name, currency: 'BTC', amount: '0.001' }), 'TIP_NO_RATE', 400);
    });
  });

  await t.test('limits: the daily cap holds when tips race', async () => {
    const a = await seed({ inr: '0' });
    const b = await seed({ inr: '0' });
    await m.Credits.update({ usdt: '100' }, { where: { uid: a.id } });

    await withLimits({ maxPerTipUsd: '0', maxPerDayUsd: '10' }, async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => tips.send({ userId: a.id, toUsername: b.name, currency: 'USDT', amount: '3' }))
      );
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 3);
      for (const r of results.filter((x) => x.status === 'rejected')) assert.equal(r.reason.code, 'TIP_OVER_DAILY_LIMIT');
    });
  });

  await t.test('limits: the wager requirement refuses below and allows at the threshold', async () => {
    const a = await seed({ inr: '1000' });
    const b = await seed({ inr: '0' });

    await withLimits({ minWageredUsd: '100' }, async () => {
      // No `userwager` row at all is $0 wagered.
      const none = await rejectsWithDetails(
        tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '1' }),
        'TIP_WAGER_REQUIRED',
        403
      );
      assert.deepEqual(none, { requiredUsd: '100.00000000', wageredUsd: '0.00000000' });

      await m.Userwager.create({ uid: a.id, wager: '99.99' });
      const below = await rejectsWithDetails(
        tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '1' }),
        'TIP_WAGER_REQUIRED',
        403
      );
      assert.equal(below.wageredUsd, '99.99000000');
      assert.equal(await balanceOf(a.id), '1000.00000000');

      // Legacy thousands separators parse like the VIP ladder reads them.
      await m.Userwager.update({ wager: '1,00.00' }, { where: { uid: a.id } });
      await tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '1' });
      assert.equal(await balanceOf(b.id), '1.00000000');
    });
  });

  await t.test('limits: settings that cannot be read fall back to the defaults (limits on)', async () => {
    const a = await seed({ inr: '0' });
    const b = await seed({ inr: '0' });
    await m.Credits.update({ usdt: '3000' }, { where: { uid: a.id } });

    // The real resolver, against an admin client whose tip-limit read fails.
    const { tipLimits: _stub, ...rest } = deps;
    const down = new TipService({
      ...rest,
      clients: {
        admin: {
          ...fakeAdmin,
          get: async (path) => {
            if (path === TIP_LIMITS_PATH) throw new Error('admin-service down');
            return fakeAdmin.get(path);
          },
        },
      },
    });

    const details = await rejectsWithDetails(
      down.send({ userId: a.id, toUsername: b.name, currency: 'USDT', amount: '500.01' }),
      'TIP_OVER_PER_TIP_LIMIT',
      400
    );
    assert.deepEqual(details, { maxUsd: '500.00000000', maxInCurrency: '500.00000000', currency: 'USDT' });
    await down.send({ userId: a.id, toUsername: b.name, currency: 'USDT', amount: '500' });
    await down.send({ userId: a.id, toUsername: b.name, currency: 'USDT', amount: '500' });
    await down.send({ userId: a.id, toUsername: b.name, currency: 'USDT', amount: '500' });
    await down.send({ userId: a.id, toUsername: b.name, currency: 'USDT', amount: '500' }); // $2000
    await rejectsWith(down.send({ userId: a.id, toUsername: b.name, currency: 'USDT', amount: '0.01' }), 'TIP_OVER_DAILY_LIMIT', 400);
    assert.deepEqual((await down.getSettings({ userId: a.id })).limits, {
      maxPerTipUsd: '500.00000000',
      maxPerDayUsd: '2000.00000000',
      minWageredUsd: '0.00000000',
      currency: 'USDT',
      usedTodayUsd: '2000.00000000',
    });

    // And when admin-service answers, its values are used ("0" = no cap, "" too).
    const up = new TipService({
      ...rest,
      clients: {
        admin: {
          ...fakeAdmin,
          get: async (path) =>
            path === TIP_LIMITS_PATH ? { maxPerTipUsd: '1.00000000', maxPerDayUsd: '', minWageredUsd: '0' } : fakeAdmin.get(path),
        },
      },
    });
    const c = await seed({ inr: '0' });
    await m.Credits.update({ usdt: '10' }, { where: { uid: c.id } });
    await rejectsWith(up.send({ userId: c.id, toUsername: b.name, currency: 'USDT', amount: '1.01' }), 'TIP_OVER_PER_TIP_LIMIT', 400);
    await up.send({ userId: c.id, toUsername: b.name, currency: 'USDT', amount: '1' });
    assert.equal((await up.getSettings({ userId: c.id })).limits.maxPerDayUsd, '0.00000000');
  });

  await t.test('limits: a replayed requestId returns the original tip after the cap is reached', async () => {
    const a = await seed({ inr: '0' });
    const b = await seed({ inr: '0' });
    await m.Credits.update({ usdt: '100' }, { where: { uid: a.id } });
    const requestId = require('node:crypto').randomUUID();

    await withLimits({ maxPerTipUsd: '0', maxPerDayUsd: '10' }, async () => {
      const first = await tips.send({ userId: a.id, toUsername: b.name, currency: 'USDT', amount: '10', requestId });
      await rejectsWith(tips.send({ userId: a.id, toUsername: b.name, currency: 'USDT', amount: '0.01' }), 'TIP_OVER_DAILY_LIMIT', 400);

      const again = await tips.send({ userId: a.id, toUsername: b.name, currency: 'USDT', amount: '10', requestId });
      assert.equal(again.tipId, first.tipId);
      assert.equal(again.replayed, true);
      assert.equal(await tipCount(a.id), 1);
    });
  });

  await t.test('routes: send is gated by the plan; history and settings are not', async () => {
    const a = await seed({ inr: '100' });
    const auth = { requirePermission: () => (_req, _res, next) => next() };
    const app = express();
    app.use(express.json());
    app.use(requestContext());
    app.use((req, _res, next) => { req.user = { id: a.id }; next(); });
    app.use('/', require('../routes/user.routes')({ ...deps, auth }));
    app.use(errorHandler({ logger }));
    const server = app.listen(0);
    t.after(() => {
      server.closeAllConnections?.();
      server.close();
    });
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

    entitlements.configureEntitlements({ read: () => ({ features: { tips: false }, flags: {}, version: 1, fetchedAt: null, source: 'owner' }) });
    assert.equal((await call('POST', '/send', { toUsername: 'x', currency: 'INR', amount: '1' })).code, 'NOT_ENTITLED');
    assert.equal((await call('GET', '/users?q=ab')).code, 'NOT_ENTITLED');
    const hist = await call('GET', '/history');
    assert.equal(hist.status, 200);
    assert.deepEqual(hist.data, { rows: [], total: 0 });
    assert.deepEqual((await call('GET', '/settings')).data, {
      enabled: true,
      limits: { maxPerTipUsd: '500.00000000', maxPerDayUsd: '2000.00000000', minWageredUsd: '0.00000000', currency: 'USDT', usedTodayUsd: '0.00000000' },
    });
    assert.deepEqual((await call('PATCH', '/settings', { enabled: false })).data, { enabled: false });

    entitlements.configureEntitlements({ read: () => ({ features: {}, flags: {}, version: 1, fetchedAt: null, source: 'owner' }) });
    // A custom (site) coin is refused for tips before validation.
    const custom = await call('POST', '/send', { toUsername: 'x', currency: 'GOLDX', amount: '1' });
    assert.equal(custom.code, 'CURRENCY_NOT_SUPPORTED_FOR_TIPS');
    // Unknown fields and a non-string amount are validation errors.
    assert.equal((await call('POST', '/send', { toUsername: 'x', currency: 'INR', amount: 1 })).status, 422);
    // A sender id in the body is not a field: the sender is the token, always.
    assert.equal((await call('POST', '/send', { toUsername: 'x', currency: 'INR', amount: '1', fromUid: 5 })).status, 422);
    assert.equal((await call('POST', '/send', { toUsername: `nobody_${run}`, currency: 'INR', amount: '1' })).code, 'TIP_USER_NOT_FOUND');

    // An agent-tree player cannot send, at the route and in the service; history stays readable.
    const { configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');
    configureAgentPlayers({ isAgentPlayer: async (id) => Number(id) === a.id });
    try {
      const refused = await call('POST', '/send', { toUsername: `nobody_${run}`, currency: 'INR', amount: '1' });
      assert.equal(refused.status, 403);
      assert.equal(refused.code, 'TIPS_NOT_FOR_AGENT_USERS');
      await rejectsWith(tips.send({ userId: a.id, toUsername: `nobody_${run}`, currency: 'INR', amount: '1' }), 'TIPS_NOT_FOR_AGENT_USERS', 403);
      assert.equal((await call('GET', '/history')).status, 200);
    } finally {
      resetAgentPlayers();
    }

    // Unknown query fields are refused too (a userId filter that doesn't exist must not read as "all").
    assert.equal((await call('GET', '/history?userId=1')).status, 422);
    assert.equal((await call('GET', `/users?q=tipt&userId=1`)).status, 422);
  });

  await t.test('an agent-tree player cannot receive a tip and is not suggested', async () => {
    const a = await seed({ inr: '100' });
    // Their own prefix, so the picker's 8 aren't taken by players from earlier subtests.
    const b = await seed({ inr: '0', prefix: 'tipr' });
    const c = await seed({ inr: '0', prefix: 'tipr' });
    const { configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');
    configureAgentPlayers({ isAgentPlayer: async (id) => Number(id) === b.id });
    try {
      // Same answer as an unknown name: nothing says the account exists.
      await rejectsWith(tips.send({ userId: a.id, toUsername: b.name, currency: 'INR', amount: '5' }), 'TIP_USER_NOT_FOUND', 404);
      assert.equal(await balanceOf(a.id), '100.00000000');
      assert.equal(await tipCount(a.id), 0);
      const names = (await tips.searchUsers({ userId: a.id, q: `tipr_${run}` })).map((u) => u.name);
      assert.ok(!names.includes(b.name));
      assert.ok(names.includes(c.name));
      // A direct player still can.
      await tips.send({ userId: a.id, toUsername: c.name, currency: 'INR', amount: '5' });
      assert.equal(await balanceOf(c.id), '5.00000000');
    } finally {
      resetAgentPlayers();
    }
  });
});
