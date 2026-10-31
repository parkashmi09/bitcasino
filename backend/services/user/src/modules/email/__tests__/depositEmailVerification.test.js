'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.RATE_LIMIT_ENABLED = 'false';

const db = require('@ibitplay/db');
const { createLogger, errorHandler, entitlements, Mailer } = require('@ibitplay/common');
const { EVENTS } = require('@ibitplay/socket');

/**
 * The owner's `deposit_email_verification` policy (migration 180): `none` changes nothing,
 * `required` refuses every deposit entry point with 403 EMAIL_NOT_VERIFIED until the player
 * confirms a `verify-email` code (POST /user/email/verify/request + /confirm).
 */
const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const POLICY = 'deposit_email_verification';

test('deposit email verification', async (t) => {
  const logger = createLogger({ name: 'deposit-email-test', level: 'silent' });
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
  entitlements.resetEntitlements();
  const { models } = connection;

  const [before] = await connection.sequelize.query(`SELECT variant FROM site_features WHERE feature = '${POLICY}'`, { type: 'SELECT' });
  const setPolicy = (variant) =>
    models.SiteFeature.upsert({ feature: POLICY, variant, enabled: variant !== 'none', config: {}, secrets: {}, updated_by: 'test' });

  const uid = 940_000_000 + Math.floor(process.pid % 100_000) * 10;
  const email = `verify-${uid}@test.local`;
  await models.UserOtps.destroy({ where: { email } });
  await models.Users.destroy({ where: { id: uid } });
  await models.Users.create({ id: uid, name: `verify-${uid}`, email, password: 'x', status: 'active' });

  t.after(async () => {
    await models.UserOtps.destroy({ where: { email } });
    await models.Users.destroy({ where: { id: uid } });
    if (before) await setPolicy(before.variant);
    else await connection.sequelize.query(`DELETE FROM site_features WHERE feature = '${POLICY}'`);
    entitlements.resetEntitlements();
    await connection.close();
  });

  const outbox = [];
  const transport = { async sendMail(message) { outbox.push(message); return { messageId: `t-${outbox.length}` }; } };
  const deps = {
    config: {
      SERVICE_NAME: 'user-service',
      NODE_ENV: 'test',
      ROOT_STAFF_ID: 1,
      RATE_LIMIT_ENABLED: false,
      FIAT_DEPOSIT_STORAGE_DIR: '/tmp/ibitplay-test-fiat-deposits',
      P2P_STORAGE_DIR: '/tmp/ibitplay-test-p2p',
    },
    logger,
    db: connection,
    models,
    mailer: new Mailer({ config: { MAIL_FROM: 'test@local' }, logger, transport }),
    clients: {
      admin: { get: async () => ({}), post: async () => ({}) },
      casino: { get: async () => ({}), post: async () => ({}) },
      sports: { get: async () => ({}), post: async () => ({}) },
    },
    wallet: {},
    auth: {},
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: uid, role: 'player', status: 'active' };
    next();
  });
  for (const name of ['fiat-deposit', 'payment-orders', 'email']) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    app.use(`/${name}`, require(`../../${name}/routes/user.routes`)(deps));
  }
  app.use(errorHandler({ logger }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, body = {}) => {
    const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => null);
    return { status: res.status, code: json?.error?.code ?? json?.code, data: json?.data };
  };

  const handlers = {};
  require('../../crypto-withdraw/sockets').register({ on: (event, def) => (handlers[event] = def), deps });
  const address = () => handlers[EVENTS.GET_ADDRESS].handle({ coin: 'USDT' }, { userId: uid });

  await t.test('policy none (the default): deposits are not refused for an unverified email', async () => {
    await setPolicy('none');
    for (const path of ['/payment-orders/deposits', '/fiat-deposit']) {
      const r = await call(path);
      assert.notEqual(r.code, 'EMAIL_NOT_VERIFIED', `${path}: ${r.status} ${r.code}`);
    }
    assert.notEqual((await address())?.error?.code, 'EMAIL_NOT_VERIFIED');
  });

  await t.test('policy required: every deposit entry point is 403 EMAIL_NOT_VERIFIED', async () => {
    await setPolicy('required');
    for (const path of ['/payment-orders/deposits', '/fiat-deposit']) {
      const r = await call(path);
      assert.equal(r.status, 403, `${path}: ${r.status} ${r.code}`);
      assert.equal(r.code, 'EMAIL_NOT_VERIFIED');
    }
    assert.equal((await address())?.error?.code, 'EMAIL_NOT_VERIFIED');
  });

  await t.test('request + confirm verifies the account address, then deposits open', async () => {
    const asked = await call('/email/verify/request');
    assert.equal(asked.status, 200, `${asked.status} ${asked.code}`);
    const mail = outbox.at(-1);
    assert.equal(mail.to, email, 'the code goes to the account address');
    assert.ok(!JSON.stringify(asked.data).match(/\d{6}/), 'the code is never in the response');
    const code = String(mail.text).match(/code is (\d{6})/)[1];

    const wrong = await call('/email/verify/confirm', { code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.code, 'EMAIL_OTP_INVALID');

    const ok = await call('/email/verify/confirm', { code });
    assert.equal(ok.status, 200, `${ok.status} ${ok.code}`);
    assert.equal(ok.data.emailVerified, true);
    assert.ok((await models.Users.findByPk(uid, { raw: true })).email_verified_at);

    const r = await call('/payment-orders/deposits');
    assert.notEqual(r.code, 'EMAIL_NOT_VERIFIED', `${r.status} ${r.code}`);
    assert.notEqual((await address())?.error?.code, 'EMAIL_NOT_VERIFIED');
    assert.equal((await call('/email/verify/request')).data.emailVerified, true, 'already verified: nothing sent');
  });

  await t.test('MAIL_DRY_RUN: no SMTP, the code is in the log and the request succeeds', async () => {
    await models.Users.update({ email_verified_at: null }, { where: { id: uid } });
    await models.UserOtps.destroy({ where: { email } });
    const lines = [];
    const spy = { info: (obj) => lines.push(obj), warn() {}, error() {}, debug() {}, child() { return spy; } };
    const { EmailService } = require('../email.service');
    const service = new EmailService({ ...deps, logger: spy, mailer: new Mailer({ config: { MAIL_DRY_RUN: true }, logger: spy }) });
    const result = await service.requestEmailVerification({ userId: uid });
    assert.equal(result.requested, true);
    const preview = lines.find((l) => l?.mailPreview)?.mailPreview;
    assert.equal(preview.to, email);
    assert.match(preview.body, /code is \d{6}/);
  });
});
