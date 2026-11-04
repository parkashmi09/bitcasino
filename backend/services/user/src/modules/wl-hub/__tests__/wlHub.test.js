'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, money, hubAuth, whitelabelPlan } = require('@ibitplay/common');
const { createSecretBox } = require('@ibitplay/auth');

const publicRoutes = require('../routes/public.routes');
const companyWallet = require('../companyWallet');
const { resetHubCache } = require('../hubCredentials');
const { deliverPending } = require('../delivery');
const { PaymentOrdersService } = require('../../payment-orders/paymentOrders.service');
const { PspService } = require('../../psp/psp.service');

/**
 * The whitelabel hub, both sides in one test database: the PARENT (WHITELABEL_MODE off) opens a
 * real F2Pay order for the COPY (WHITELABEL_MODE on), F2Pay's signed callback settles it on the
 * parent, and the copy — reached over HTTP with the hub signature — credits its player and moves
 * its company balance by the owner's rule (2026-11-01): deposit +A − d%, withdrawal −A − w%.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const logger = createLogger({ name: 'wl-hub-test', level: 'silent' });
const BANK = { account_name: 'Test Player', account_number: '123456789', bank_code: 'BKID0000001' };
// Ids far from every other suite (they share the test database).
const BASE = 7_400_000 + (process.pid % 10_000) * 10;

test('hub signatures: direction, age, proxy and body all count', () => {
  const secret = 'a'.repeat(64);
  const body = JSON.stringify({ amount: '10' });
  const ts = Date.now();
  const sign = (direction, b = body, at = ts) => hubAuth.signature({ secret, direction, method: 'POST', path: '/api/v1/user/wl-hub/x', ts: at, body: b });
  const req = (headers, raw = body) => ({
    method: 'POST',
    originalUrl: '/api/v1/user/wl-hub/x',
    rawBody: Buffer.from(raw),
    get: (h) => headers[h.toLowerCase()],
  });
  const ok = { 'x-hub-ts': String(ts), 'x-hub-sign': sign('c2p') };
  assert.equal(hubAuth.verifyRequest(req(ok), { secret, direction: 'c2p' }), true);
  assert.equal(hubAuth.verifyRequest(req(ok), { secret, direction: 'p2c' }), false, 'a copy→parent signature is no good the other way');
  assert.equal(hubAuth.verifyRequest(req(ok, JSON.stringify({ amount: '1000' })), { secret, direction: 'c2p' }), false, 'the body is signed');
  assert.equal(hubAuth.verifyRequest(req({ ...ok, 'x-forwarded-for': '1.2.3.4' }), { secret, direction: 'c2p' }), false, 'never through a proxy');
  const old = ts - hubAuth.WINDOW_MS - 1000;
  assert.equal(hubAuth.verifyRequest(req({ 'x-hub-ts': String(old), 'x-hub-sign': sign('c2p', body, old) }), { secret, direction: 'c2p' }), false, 'too old');
  assert.equal(hubAuth.verifyRequest(req(ok), { secret: 'b'.repeat(64), direction: 'c2p' }), false, 'another secret');
  // A GET's query is signed too (the copy's /report?from&to, /payments/order?flow&…).
  const getPath = '/api/v1/user/wl-hub/report?from=2026-11-01&to=2026-12-01';
  const signedGet = hubAuth.signature({ secret, direction: 'c2p', method: 'GET', path: getPath, ts, body: '' });
  const get = (url) => ({ method: 'GET', originalUrl: url, rawBody: undefined, get: (h) => ({ 'x-hub-ts': String(ts), 'x-hub-sign': signedGet })[h.toLowerCase()] });
  assert.equal(hubAuth.verifyRequest(get(getPath), { secret, direction: 'c2p' }), true, 'a GET with a query verifies');
  assert.equal(hubAuth.verifyRequest(get(getPath.replace('2026-11-01', '2020-01-01')), { secret, direction: 'c2p' }), false, 'its query cannot be changed');
});

test('gateway charges round half-up to the paisa', () => {
  assert.equal(companyWallet.chargeOf('10000', '4'), '400.00000000');
  assert.equal(companyWallet.chargeOf('10000', '5'), '500.00000000');
  assert.equal(companyWallet.chargeOf('333.33', '2.5'), '8.33000000');
  assert.equal(companyWallet.chargeOf('100', '0'), '0.00000000');
});

test('whitelabel gateway payments through the parent', async (t) => {
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
  const { models } = connection;
  const q = (sql, replacements = {}) => connection.sequelize.query(sql, { replacements, type: connection.sequelize.QueryTypes.SELECT });

  // ── Keys: F2Pay's (signs its answers and callbacks), ours (signs requests), the hub's ──
  const ours = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const theirs = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const F2PAY = {
    F2PAY_MERCHANT_ID: 'F2_TEST',
    F2PAY_BASE_URL: 'https://f2pay.test',
    F2PAY_PRIVATE_KEY: ours.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    F2PAY_PUBLIC_KEY: theirs.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
  const shared = {
    SERVICE_NAME: 'user-service',
    PUBLIC_BASE_URL: 'https://api.example.test',
    AUTO_WITHDRAWALS_ENABLED: true,
    WITHDRAW_REQUIRE_KYC: false,
    DEPOSIT_MINIMUM: '1',
    DEPOSIT_MAXIMUM: '100000',
    WITHDRAW_MINIMUM: '1',
    WITHDRAW_MAXIMUM: '50000',
    TOTP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
  };
  const { key: hubKey, secret: hubSecret } = hubAuth.newCredentials();
  const box = createSecretBox({ config: shared, logger });

  const f2payAnswer = (biz) => {
    const bizContent = JSON.stringify(biz);
    return { code: '0000', msg: 'success', bizContent, sign: crypto.sign('sha256', Buffer.from(bizContent), theirs.privateKey).toString('base64') };
  };
  const gatewayCalls = [];
  const http = {
    post: async (url, body) => {
      gatewayCalls.push({ url, body });
      return f2payAnswer({ mchOrderNo: JSON.parse(body.bizContent).mchOrderNo, platNo: 'F2P-1', payUrl: 'https://cashier.f2pay.test/abc' });
    },
  };
  const f2paySigned = (biz) => {
    const bizContent = JSON.stringify(biz);
    return { merchantId: 'F2_TEST', signType: 'RSA', bizContent, sign: crypto.sign('sha256', Buffer.from(bizContent), theirs.privateKey).toString('base64') };
  };

  // ── Two servers on this machine: the parent's user-service and the copy's ──
  const serve = (deps) => {
    const app = express();
    app.use(express.json({ verify: (req, _res, buf) => { if (buf?.length) req.rawBody = buf; } }));
    app.use('/api/v1/user/wl-hub', publicRoutes(deps));
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: { code: err.code, message: err.message } }));
    const server = app.listen(0, '127.0.0.1');
    t.after(() => server.close());
    return new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  };
  const parentDeps = { models, db: connection, logger, http, config: { ...shared, ...F2PAY, WHITELABEL_MODE: false } };
  const parentPort = await serve(parentDeps);
  const copyConfig = { ...shared, WHITELABEL_MODE: true, PARENT_HUB_URL: `http://127.0.0.1:${parentPort}`, PARENT_HUB_KEY: hubKey, PARENT_HUB_SECRET: hubSecret };
  // KYC / wagering / deposit cap have their own suites (and other suites leave their settings here).
  const withdrawRequirements = { assertMet: async () => ({}), assertCapInTransaction: async () => {} };
  const copyDeps = { models, db: connection, logger, config: copyConfig, withdrawRequirements };
  const copyPort = await serve(copyDeps);

  // ── Fixtures ──
  const wlId = BASE;
  const roleId = BASE + 1;
  // Low on purpose: the copy's company is its LOWEST level-1 staff id, and other suites leave theirs.
  const companyId = 1000 + (process.pid % 1000);
  const uid = BASE + 3;
  const plan = {
    products: { casino: true, sports: true, originals: true },
    features: { branch_management: false, bonus: false, affiliate: false, vip: false, promotions: false },
    payments: { manual: true, gateways: { ccpayment: false, f2pay: true, upi: false } },
  };
  const terms = whitelabelPlan.cleanTerms({ fees: { f2pay: { deposit: '4', withdraw: '5' } } });

  const cleanup = async () => {
    await q(`DELETE FROM whitelabel_gateway_orders WHERE whitelabel_id = :wlId`, { wlId });
    await q(`DELETE FROM whitelabels WHERE id = :wlId`, { wlId });
    await q(`DELETE FROM owner_direct_ledger WHERE owner_id = :companyId`, { companyId });
    await q(`DELETE FROM whitelabel_gateway_movements WHERE staff_id = :companyId`, { companyId });
    await q(`DELETE FROM staff_balances WHERE staff_id = :companyId`, { companyId });
    await q(`DELETE FROM f2paydeposits WHERE user_id = :uid`, { uid });
    await q(`DELETE FROM f2paywithdrawals WHERE user_id = :uid`, { uid });
    await models.Credits.destroy({ where: { uid } });
    await q(`DELETE FROM staff WHERE id = :companyId`, { companyId });
    await q(`DELETE FROM roles WHERE id = :roleId`, { roleId });
  };
  t.after(async () => {
    try {
      await cleanup();
    } finally {
      await connection.close();
    }
  });
  await cleanup();

  await q(`INSERT INTO roles (id, name, level) VALUES (:roleId, 'Company', 1)`, { roleId });
  await q(`INSERT INTO staff (id, name, email, password, role_id, status) VALUES (:companyId, 'company', :email, 'x', :roleId, 'active')`, {
    companyId,
    email: `company-${companyId}@test.invalid`,
    roleId,
  });
  if ((await companyWallet.companyId(connection)) !== companyId) {
    t.skip('another level-1 account sits below the test company in this database');
    return;
  }
  await q(`INSERT INTO staff_balances (staff_id, inr) VALUES (:companyId, '100000')`, { companyId });
  await models.Users.destroy({ where: { id: uid } });
  await models.Users.create({ id: uid, name: `wl-${uid}`, password: 'x', status: 'active' });
  await models.Credits.create({ uid, inr: '0' });
  await q(
    `INSERT INTO whitelabels (id, slug, name, site_domain, admin_domain, api_domain, template, company_role_name, company_name, company_email,
                              link_key, status, ports, plan, terms, hub_key, hub_secret)
     VALUES (:wlId, :slug, 'Hub Test', :site, :admin, :api, 'hash_game', 'Company', 'Co', 'co@test.invalid', 'x', 'live',
             CAST(:ports AS JSONB), CAST(:plan AS JSONB), CAST(:terms AS JSONB), :hubKey, :hubSecret)`,
    {
      wlId,
      slug: `hubtest-${wlId}`,
      site: `s${wlId}.test.invalid`,
      admin: `a${wlId}.test.invalid`,
      api: `p${wlId}.test.invalid`,
      ports: JSON.stringify({ user: copyPort }),
      plan: JSON.stringify(plan),
      terms: JSON.stringify(terms),
      hubKey,
      hubSecret: box.seal(hubSecret),
    }
  );
  await q(`UPDATE whitelabel_settings SET hub = NULL WHERE id = 1`);
  resetHubCache();

  const companyBalance = async () => money.fromStored((await q(`SELECT inr FROM staff_balances WHERE staff_id = :companyId`, { companyId }))[0].inr);
  const playerBalance = async () => money.fromStored((await models.Credits.findOne({ where: { uid }, raw: true })).inr);
  const statement = async () => q(`SELECT entry_type, direction, amount FROM owner_direct_ledger WHERE owner_id = :companyId ORDER BY id`, { companyId });
  const order = async (copyReference) => (await q(`SELECT * FROM whitelabel_gateway_orders WHERE copy_reference = :copyReference`, { copyReference }))[0];

  const copyOrders = new PaymentOrdersService(copyDeps);
  const parentPsp = new PspService(parentDeps);

  await t.test('a gateway deposit: player +10,000, company 1,00,000 → 1,09,600', async () => {
    const placed = await copyOrders.createDeposit({ userId: uid, provider: 'f2pay', currency: 'INR', amount: '10000', ip: '203.0.113.5' });
    assert.equal(placed.redirectUrl, 'https://cashier.f2pay.test/abc');
    const wlOrder = await order(placed.reference);
    assert.equal(wlOrder.status, 'pending');
    assert.equal(money.fromStored(wlOrder.charge_pct), '4.00000000');
    // The order ran on the PARENT's F2Pay account, with the parent's callback URL and reference.
    const biz = JSON.parse(gatewayCalls.at(-1).body.bizContent);
    assert.equal(biz.mchOrderNo, wlOrder.reference);
    assert.equal(biz.notifyUrl, 'https://api.example.test/api/v1/user/psp/f2pay/callback');

    const paid = f2paySigned({ mchOrderNo: wlOrder.reference, platNo: 'F2P-1', state: 'Paid', amount: '10000.00', utr: 'UTR1' });
    assert.equal((await parentPsp.handleCallback({ provider: 'f2pay', body: paid, ip: '203.0.113.9' })).settled, true);

    assert.equal(await playerBalance(), '10000.00000000');
    assert.equal(await companyBalance(), '109600.00000000');
    assert.deepEqual(
      (await statement()).map((r) => [r.entry_type, r.direction, money.fromStored(r.amount)]),
      [
        ['gateway_deposit', 'credit', '10000.00000000'],
        ['gateway_charge', 'debit', '400.00000000'],
      ]
    );
    const after = await order(placed.reference);
    assert.deepEqual([after.status, after.delivered], ['success', true]);
    assert.equal((await models.F2payDeposits.findOne({ where: { mch_order_no: placed.reference }, raw: true })).status, 'Success');

    // F2Pay retries, and the parent resends: nothing moves twice.
    assert.equal((await parentPsp.handleCallback({ provider: 'f2pay', body: paid, ip: '203.0.113.9' })).duplicate, true);
    await q(`UPDATE whitelabel_gateway_orders SET delivered = false WHERE id = :id`, { id: after.id });
    await deliverPending(parentDeps);
    assert.equal(await playerBalance(), '10000.00000000');
    assert.equal(await companyBalance(), '109600.00000000');
  });

  await t.test('a gateway withdrawal: company −10,500 at request; a failed payout gives both back once', async () => {
    const placed = await copyOrders.createWithdrawal({ userId: uid, provider: 'f2pay', currency: 'INR', amount: '10000', details: BANK });
    assert.equal(placed.status, 'pending');
    assert.equal(await playerBalance(), '0.00000000');
    assert.equal(await companyBalance(), '99100.00000000');
    const wlOrder = await order(placed.reference);
    assert.equal(wlOrder.flow, 'payout');
    assert.equal(money.fromStored(wlOrder.charge_pct), '5.00000000');

    const failed = f2paySigned({ mchOrderNo: wlOrder.reference, status: 'Failed', amount: '10000.00' });
    await parentPsp.handlePayoutCallback({ provider: 'f2pay', body: failed, ip: '203.0.113.9' });
    await parentPsp.handlePayoutCallback({ provider: 'f2pay', body: failed, ip: '203.0.113.9' });
    await q(`UPDATE whitelabel_gateway_orders SET delivered = false WHERE id = :id`, { id: wlOrder.id });
    await deliverPending(parentDeps);

    assert.equal(await playerBalance(), '10000.00000000');
    assert.equal(await companyBalance(), '109600.00000000');
    const rows = (await statement()).slice(2).map((r) => [r.entry_type, r.direction, money.fromStored(r.amount)]);
    assert.deepEqual(rows, [
      ['gateway_withdrawal', 'debit', '10000.00000000'],
      ['gateway_charge', 'debit', '500.00000000'],
      ['gateway_refund', 'credit', '10500.00000000'],
    ]);
  });

  await t.test('a paid withdrawal keeps the company debit', async () => {
    const placed = await copyOrders.createWithdrawal({ userId: uid, provider: 'f2pay', currency: 'INR', amount: '1000', details: BANK });
    const wlOrder = await order(placed.reference);
    await parentPsp.handlePayoutCallback({ provider: 'f2pay', body: f2paySigned({ mchOrderNo: wlOrder.reference, status: 'Completed', amount: '1000.00' }), ip: '203.0.113.9' });
    assert.equal(await playerBalance(), '9000.00000000');
    assert.equal(await companyBalance(), '108550.00000000');
    assert.equal((await models.F2payWithdrawals.findOne({ where: { mch_order_no: placed.reference }, raw: true })).status, 'Success');
  });

  await t.test('the company must cover amount + charge, or nothing is held', async () => {
    await q(`UPDATE staff_balances SET inr = '1000' WHERE staff_id = :companyId`, { companyId });
    await assert.rejects(
      () => copyOrders.createWithdrawal({ userId: uid, provider: 'f2pay', currency: 'INR', amount: '1000', details: BANK }),
      (err) => err.code === 'COMPANY_BALANCE_LOW'
    );
    assert.equal(await playerBalance(), '9000.00000000', 'the player hold rolled back with it');
    assert.equal(await companyBalance(), '1000.00000000');
  });

  await t.test('the parent refuses a gateway the plan leaves out, a changed charge, and a bad signature', async () => {
    const whitelabel = { id: wlId, plan: whitelabelPlan.cleanPlan(plan), terms };
    const parentOrders = new PaymentOrdersService(parentDeps);
    await assert.rejects(
      () => parentOrders.hubDeposit({ whitelabel, provider: 'apay', copyReference: 'DEP_X_1', userId: String(uid), currency: 'INR', amount: '100' }),
      (err) => err.code === 'PAYORDER_PROVIDER_DISABLED' || err.code === 'PROVIDER_DISABLED' || /DISABLED/.test(err.code)
    );
    await assert.rejects(
      () => parentOrders.hubPayout({ whitelabel, provider: 'f2pay', copyReference: 'WD_X_1', userId: String(uid), currency: 'INR', amount: '100', method: 'imps', details: BANK, chargePct: '1' }),
      (err) => err.code === 'HUB_CHARGE_CHANGED'
    );
    // A GET with a query, signed by the copy, end to end (its revenue-share report, order lookups).
    const report = await hubAuth.hubRequest({ baseUrl: `http://127.0.0.1:${parentPort}`, key: hubKey, secret: hubSecret, direction: 'c2p', method: 'GET', path: '/api/v1/user/wl-hub/report?from=2026-01-01&to=2027-01-01' });
    assert.ok(report.ledger && report.revenueShare, 'the parent answers a signed GET with a query');
    const forged = await hubAuth
      .hubRequest({ baseUrl: `http://127.0.0.1:${parentPort}`, key: hubKey, secret: 'f'.repeat(64), direction: 'c2p', method: 'GET', path: '/api/v1/user/wl-hub/payments/terms' })
      .catch((e) => e);
    assert.equal(forged.status, 401);
    const wrongWay = await hubAuth
      .hubRequest({ baseUrl: `http://127.0.0.1:${copyPort}`, key: hubKey, secret: hubSecret, direction: 'c2p', path: '/api/v1/user/wl-hub/in/payments', body: {} })
      .catch((e) => e);
    assert.equal(wrongWay.status, 401, 'the copy only takes the parent-to-copy signature');
  });
});
