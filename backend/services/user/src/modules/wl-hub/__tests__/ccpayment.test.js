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
const { PaymentOrdersService } = require('../../payment-orders/paymentOrders.service');
const { CryptoService } = require('../../crypto/crypto.service');
const { CryptoWithdrawService } = require('../../crypto-withdraw/cryptoWithdraw.service');

/**
 * CCPayment (owner, 2026-11-01): crypto withdrawals sent through CCPayment from the review queue,
 * on the parent and — through the parent's account — on a whitelabel copy; and a copy's CCPayment
 * deposits, credited with what ARRIVED (it can come in parts). CCPayment is a fake that answers
 * like https://ccpayment.com/apitutorial.md; its webhooks are signed with the app secret.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const logger = createLogger({ name: 'ccpayment-test', level: 'silent' });
const BASE = 7_500_000 + (process.pid % 10_000) * 10;
const CC = { CCPAYMENT_APP_ID: 'cc-app', CCPAYMENT_APP_SECRET: 'cc-secret', CCPAYMENT_BASE_URL: 'https://ccpayment.test' };

test('CCPayment withdrawals and whitelabel CCPayment payments', async (t) => {
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

  // ── A fake CCPayment: what each order's record / order info says, set by the test ──
  const sent = [];
  const records = {}; // orderId → { status, txId }
  const orders = {}; // orderId → paidList
  let refuseWithdraw = null;
  const http = {
    raw: async (url, { body }) => {
      const path = new URL(url).pathname;
      const payload = body ? JSON.parse(body) : {};
      if (path.endsWith('/applyAppWithdrawToNetwork')) {
        if (refuseWithdraw) return { code: refuseWithdraw, msg: 'Not enough balance for withdrawal' };
        sent.push(payload);
        records[payload.orderId] = { status: 'Processing' };
        return { code: 10000, data: { recordId: `R-${payload.orderId}` } };
      }
      if (path.endsWith('/getAppWithdrawRecord')) return { code: 10000, data: { record: { orderId: payload.orderId, ...records[payload.orderId] } } };
      if (path.endsWith('/createAppOrderDepositAddress')) {
        orders[payload.orderId] = [];
        return { code: 10000, data: { address: 'TXaddress', memo: '', checkoutUrl: 'https://pay.ccpayment.test/x', confirmsNeeded: 1 } };
      }
      if (path.endsWith('/getAppOrderInfo')) return { code: 10000, data: { coinSymbol: 'USDT', paidList: orders[payload.orderId] ?? [] } };
      return { code: 10000, data: { coins: [] } };
    },
    post: async () => ({}),
    get: async () => ({}),
  };
  const webhook = (service, type, orderId) => {
    const rawBody = JSON.stringify({ type, msg: { orderId } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = crypto.createHmac('sha256', CC.CCPAYMENT_APP_SECRET).update(`${CC.CCPAYMENT_APP_ID}${timestamp}${rawBody}`).digest('hex');
    return service.handleWebhook({ rawBody, signature, timestamp });
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
  const serve = (deps) => {
    const app = express();
    app.use(express.json({ verify: (req, _res, buf) => { if (buf?.length) req.rawBody = buf; } }));
    app.use('/api/v1/user/wl-hub', publicRoutes(deps));
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: { code: err.code, message: err.message } }));
    const server = app.listen(0, '127.0.0.1');
    t.after(() => server.close());
    return new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  };
  const withdrawRequirements = { assertMet: async () => ({}), assertCapInTransaction: async () => {} };
  const parentDeps = { models, db: connection, logger, http, withdrawRequirements, config: { ...shared, ...CC, WHITELABEL_MODE: false } };
  const parentPort = await serve(parentDeps);
  const copyDeps = {
    models,
    db: connection,
    logger,
    withdrawRequirements,
    config: { ...shared, WHITELABEL_MODE: true, PARENT_HUB_URL: `http://127.0.0.1:${parentPort}`, PARENT_HUB_KEY: hubKey, PARENT_HUB_SECRET: hubSecret },
  };
  const copyPort = await serve(copyDeps);

  // ── Fixtures ──
  const wlId = BASE;
  const roleId = BASE + 1;
  const companyId = 2000 + (process.pid % 1000); // the copy's company is its LOWEST level-1 staff id
  const uid = BASE + 3;
  const plan = {
    products: { casino: true, sports: true, originals: true },
    features: { branch_management: false, bonus: false, affiliate: false, vip: false, promotions: false },
    payments: { manual: true, gateways: { ccpayment: true, f2pay: false, upi: false } },
  };
  const terms = whitelabelPlan.cleanTerms({ fees: { ccpayment: { deposit: '4', withdraw: '5' } } });
  const rates = await q(`SELECT currency, usd_rate FROM exchangerate WHERE UPPER(currency) IN ('INR', 'USDT')`);

  const cleanup = async () => {
    await q(`DELETE FROM whitelabel_gateway_orders WHERE whitelabel_id = :wlId`, { wlId });
    await q(`DELETE FROM whitelabels WHERE id = :wlId`, { wlId });
    await q(`DELETE FROM owner_direct_ledger WHERE owner_id = :companyId`, { companyId });
    await q(`DELETE FROM whitelabel_gateway_movements WHERE staff_id = :companyId`, { companyId });
    await q(`DELETE FROM staff_balances WHERE staff_id = :companyId`, { companyId });
    await q(`DELETE FROM withdrawals WHERE uid = :uid`, { uid });
    await q(`DELETE FROM ccdeposit WHERE userid = CAST(:uid AS VARCHAR)`, { uid });
    await models.Credits.destroy({ where: { uid } });
    await q(`DELETE FROM staff WHERE id = :companyId`, { companyId });
    await q(`DELETE FROM roles WHERE id = :roleId`, { roleId });
  };
  t.after(async () => {
    try {
      await cleanup();
      for (const r of rates) await q(`UPDATE exchangerate SET usd_rate = :rate WHERE currency = :currency`, { rate: r.usd_rate, currency: r.currency });
    } finally {
      await connection.close();
    }
  });
  await cleanup();

  // 1 USDT = 1 USD, 1 INR = 0.0125 USD → 1 USDT = 80 INR.
  await q(`UPDATE exchangerate SET usd_rate = '1' WHERE UPPER(currency) = 'USDT'`);
  await q(`UPDATE exchangerate SET usd_rate = '0.0125' WHERE UPPER(currency) = 'INR'`);
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
  await models.Users.create({ id: uid, name: `cc-${uid}`, password: 'x', status: 'active' });
  await models.Credits.create({ uid, inr: '0', usdt: '0' });
  await q(
    `INSERT INTO whitelabels (id, slug, name, site_domain, admin_domain, api_domain, template, company_role_name, company_name, company_email,
                              link_key, status, ports, plan, terms, hub_key, hub_secret)
     VALUES (:wlId, :slug, 'CC Test', :site, :admin, :api, 'hash_game', 'Company', 'Co', 'co@test.invalid', 'x', 'live',
             CAST(:ports AS JSONB), CAST(:plan AS JSONB), CAST(:terms AS JSONB), :hubKey, :hubSecret)`,
    {
      wlId,
      slug: `cctest-${wlId}`,
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

  const usdt = async () => money.fromStored((await models.Credits.findOne({ where: { uid }, raw: true })).usdt);
  const companyBalance = async () => money.fromStored((await q(`SELECT inr FROM staff_balances WHERE staff_id = :companyId`, { companyId }))[0].inr);
  const queued = async (amount) => {
    const row = await models.Withdrawals.create({ uid, amount, wallet: 'TXplayerAddress', status: 'In Queue', coin: 'USDT', chain: 'TRC20', date: new Date() });
    return row.id;
  };
  const row = async (id) => models.Withdrawals.findOne({ where: { id }, raw: true });
  const staff = { id: 1 };

  const parentWithdraw = new CryptoWithdrawService(parentDeps);
  const parentCrypto = new CryptoService(parentDeps);

  await t.test('this site: sent through CCPayment, its webhook marks it Sent with the txid', async () => {
    const id = await queued('25');
    const out = await parentWithdraw.sendViaGateway({ withdrawalId: id }, staff);
    assert.equal(out.status, 'Sending');
    const payload = sent.at(-1);
    assert.deepEqual([payload.orderId, payload.address, payload.chain, payload.amount, payload.merchantPayNetworkFee], [out.orderId, 'TXplayerAddress', 'TRX', '25', false]);
    assert.equal((await row(id)).gateway_record_id, `R-${out.orderId}`);

    // "Processing" is not final; Success is.
    assert.equal((await webhook(parentCrypto, 'ApiWithdrawal', out.orderId)).pending, true);
    records[out.orderId] = { status: 'Success', txId: `tx${id}abcdef0123456789` };
    await webhook(parentCrypto, 'ApiWithdrawal', out.orderId);
    const done = await row(id);
    assert.deepEqual([done.status, done.txid], ['Sent', `tx${id}abcdef0123456789`]);
    assert.equal((await webhook(parentCrypto, 'ApiWithdrawal', out.orderId)).duplicate, true);
  });

  await t.test('this site: CCPayment fails it → Rejected and the player refunded once', async () => {
    const id = await queued('10');
    const out = await parentWithdraw.sendViaGateway({ withdrawalId: id }, staff);
    records[out.orderId] = { status: 'Failed' };
    await webhook(parentCrypto, 'ApiWithdrawal', out.orderId);
    await parentWithdraw.applyGatewayOutcome({ orderId: out.orderId, outcome: 'failed' });
    assert.equal((await row(id)).status, 'Rejected');
    assert.equal(await usdt(), '10.00000000');
  });

  await t.test('this site: CCPayment refuses it → back in the queue, nothing sent', async () => {
    const id = await queued('5');
    refuseWithdraw = 14000;
    await assert.rejects(() => parentWithdraw.sendViaGateway({ withdrawalId: id }, staff), (err) => err.code === 'CCPAYMENT_REFUSED');
    refuseWithdraw = null;
    const back = await row(id);
    assert.deepEqual([back.status, back.gateway_order_id], ['In Queue', null]);
    await assert.rejects(() => parentWithdraw.checkGateway({ withdrawalId: id }), (err) => err.code === 'CRYPTO_WITHDRAW_NOT_SENDING');
  });

  await t.test('whitelabel: CCPayment deposit paid in two parts — player and company credited per part', async () => {
    await models.Credits.update({ usdt: '0' }, { where: { uid } });
    const placed = await new PaymentOrdersService(copyDeps).createDeposit({ userId: uid, provider: 'ccpayment', currency: 'USDT', amount: '10', chain: 'TRC20' });
    const [order] = await q(`SELECT * FROM whitelabel_gateway_orders WHERE copy_reference = :ref`, { ref: placed.reference });
    assert.equal(order.provider, 'ccpayment');

    orders[order.reference] = [{ recordId: 'P1', status: 'Success', amount: '6' }];
    await webhook(parentCrypto, 'ApiDeposit', order.reference);
    assert.equal(await usdt(), '6.00000000');
    // 6 USDT = 480 INR; 4% = 19.20 → 460.80.
    assert.equal(await companyBalance(), '100460.80000000');

    orders[order.reference].push({ recordId: 'P2', status: 'Success', amount: '4' });
    await webhook(parentCrypto, 'ApiDeposit', order.reference);
    await webhook(parentCrypto, 'ApiDeposit', order.reference);
    assert.equal(await usdt(), '10.00000000');
    // + 4 USDT = 320 INR − 12.80 = 307.20.
    assert.equal(await companyBalance(), '100768.00000000');
  });

  await t.test('whitelabel: crypto withdrawal sent through the parent’s CCPayment; company −amount −5%', async () => {
    const copyWithdraw = new CryptoWithdrawService(copyDeps);
    const id = await queued('5');
    const out = await copyWithdraw.sendViaGateway({ withdrawalId: id }, staff);
    assert.equal(out.status, 'Sending');
    // 5 USDT = 400 INR + 5% = 420.
    assert.equal(await companyBalance(), '100348.00000000');
    const [order] = await q(`SELECT * FROM whitelabel_gateway_orders WHERE copy_reference = :ref`, { ref: out.orderId });
    assert.equal(sent.at(-1).orderId, order.reference, 'sent on the PARENT account under the parent’s own order id');

    records[order.reference] = { status: 'Failed' };
    await webhook(parentCrypto, 'ApiWithdrawal', order.reference);
    assert.equal((await row(id)).status, 'Rejected');
    assert.equal(await usdt(), '15.00000000');
    assert.equal(await companyBalance(), '100768.00000000');
  });
});
