'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const express = require('express');

const db = require('@ibitplay/db');
const { createLogger, money, hubAuth } = require('@ibitplay/common');
const { createSecretBox } = require('@ibitplay/auth');

const publicRoutes = require('../routes/public.routes');
const { resetHubCache } = require('../hubCredentials');
const { buildGisService, providerFor } = require('../../gis/gis.factory');
const { buildOriginalGamesService } = require('../../original-games/originalGames.factory');
const { sign: ogSign } = require('../../original-games/provider/client');

/**
 * The casino hub, both sides in one test database: a whitelabel COPY opens Slotegrator and
 * original games on the PARENT's accounts, and the providers' signed callbacks for the copy's
 * players (`wl<id>_<player>`) reach the parent, which passes them to the copy and answers with the
 * copy's own answer — recording each accepted round for the GGR report.
 */

const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';
const logger = createLogger({ name: 'casino-hub-test', level: process.env.TEST_LOG_LEVEL || 'silent' });
const BASE = 7_600_000 + (process.pid % 10_000) * 10;

/** A wallet standing in for user-service (balances by player, idempotent per key). */
const makeWallet = (balances) => {
  const applied = new Map();
  const move = (sign) =>
    async function ({ userId, amount, reason, ref }) {
      const key = `${reason}:${ref?.type}:${ref?.id}`;
      if (applied.has(key)) return applied.get(key);
      const current = balances.get(String(userId)) ?? '0';
      if (sign < 0 && money.lt(current, amount)) {
        const error = new Error('Insufficient funds');
        error.code = 'WALLET_INSUFFICIENT_FUNDS';
        throw error;
      }
      const next = money.toDecimalString(sign < 0 ? money.subtract(current, amount) : money.add(current, amount));
      balances.set(String(userId), next);
      const movement = { ledgerId: applied.size + 1, newBalance: next };
      applied.set(key, movement);
      return movement;
    };
  return { balance: async (userId) => ({ balance: balances.get(String(userId)) ?? null }), credit: move(1), debit: move(-1) };
};

test('whitelabel casino through the parent', async (t) => {
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
      service: 'casino-service',
    });
    await connection.ping();
  } catch (error) {
    t.skip(`No test database reachable (${error.message})`);
    return;
  }
  const { models } = connection;
  const q = (sql, replacements = {}) => connection.sequelize.query(sql, { replacements, type: connection.sequelize.QueryTypes.SELECT });

  // ── The providers, faked at their HTTP edge ──
  const upstream = [];
  const fetchImpl = async (url, options) => {
    const { pathname } = new URL(url);
    const body = options.body ? (typeof options.body === 'string' && options.body.startsWith('{') ? JSON.parse(options.body) : Object.fromEntries(new URLSearchParams(String(options.body)))) : {};
    upstream.push({ pathname, body });
    const answer = pathname.endsWith('/games/init')
      ? { url: 'https://game.gis.test/play' }
      : pathname.endsWith('/v1/sessions/launch')
        ? { launch_url: 'https://originals.test/play', session_id: `og-${crypto.randomUUID()}` }
        : {};
    return { ok: true, status: 200, text: async () => JSON.stringify(answer), json: async () => answer };
  };

  const shared = { SERVICE_NAME: 'casino-service', GIS_MAX_SKEW_SECONDS: 300, RATE_LIMIT_ENABLED: false, TOTP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') };
  const PARENT = {
    GIS_BASE_URL: 'https://gis.test/v1',
    GIS_MERCHANT_ID: 'test-merchant',
    GIS_MERCHANT_KEY: 'test-merchant-key',
    GIS_RATE_LIMIT_MS: 0,
    OG_BASE_URL: 'https://originals.test',
    OG_API_KEY: 'og-key',
    OG_API_SECRET: 'og-secret',
    OG_WEBHOOK_SECRET: 'og-webhook',
    OG_ENV: 'production',
  };
  const { key: hubKey, secret: hubSecret } = hubAuth.newCredentials();
  const box = createSecretBox({ config: shared, logger });

  const copyBalances = new Map();
  const serve = (deps) => {
    const app = express();
    app.use(express.json({ verify: (req, _res, buf) => { if (buf?.length) req.rawBody = buf; } }));
    app.use('/api/v1/casino/wl-hub', publicRoutes(deps));
    app.use((err, _req, res, _next) => res.status(err.status ?? 500).json({ error: { code: err.code, message: err.message } }));
    const server = app.listen(0, '127.0.0.1');
    t.after(() => server.close());
    return new Promise((resolve) => server.once('listening', () => resolve(server.address().port)));
  };
  const games = { recordPlay: async () => {}, recordActivity: async () => {}, reverseActivity: async () => {} };
  const parentDeps = { models, db: connection, logger, fetchImpl, games, wallet: makeWallet(new Map()), config: { ...shared, ...PARENT, WHITELABEL_MODE: false } };
  const parentPort = await serve(parentDeps);
  const copyDeps = {
    models,
    db: connection,
    logger,
    games,
    wallet: makeWallet(copyBalances),
    config: { ...shared, WHITELABEL_MODE: true, PARENT_HUB_URL: 'http://127.0.0.1:1', PARENT_HUB_CASINO_URL: `http://127.0.0.1:${parentPort}`, PARENT_HUB_KEY: hubKey, PARENT_HUB_SECRET: hubSecret },
  };
  const copyPort = await serve(copyDeps);

  // ── Fixtures ──
  const wlId = BASE;
  const uid = BASE + 3;
  const plan = (casino, originals) => ({
    products: { casino, sports: true, originals },
    features: { branch_management: false, bonus: false, affiliate: false, vip: false, promotions: false },
    payments: { manual: true, gateways: { ccpayment: false, f2pay: false, upi: false } },
  });
  const cleanup = async () => {
    await q(`DELETE FROM whitelabel_casino_rounds WHERE whitelabel_id = :wlId`, { wlId });
    await q(`DELETE FROM whitelabels WHERE id = :wlId`, { wlId });
    await q(`DELETE FROM og_sessions WHERE user_id = :uid`, { uid: String(uid) }).catch(() => {});
  };
  t.after(async () => {
    try {
      await cleanup();
    } finally {
      await connection.close();
    }
  });
  await cleanup();
  await models.Users.destroy({ where: { id: uid } });
  await models.Users.create({ id: uid, name: `hub-${uid}`, password: 'x', status: 'active' });
  copyBalances.set(String(uid), '1000.00000000');
  await q(
    `INSERT INTO whitelabels (id, slug, name, site_domain, admin_domain, api_domain, template, company_role_name, company_name, company_email,
                              link_key, status, ports, plan, hub_key, hub_secret)
     VALUES (:wlId, :slug, 'Casino Hub', :site, :admin, :api, 'hash_game', 'Company', 'Co', 'co@test.invalid', 'x', 'live',
             CAST(:ports AS JSONB), CAST(:plan AS JSONB), :hubKey, :hubSecret)`,
    {
      wlId,
      slug: `casinohub-${wlId}`,
      site: `s${wlId}.test.invalid`,
      admin: `a${wlId}.test.invalid`,
      api: `p${wlId}.test.invalid`,
      ports: JSON.stringify({ casino: copyPort }),
      plan: JSON.stringify(plan(true, true)),
      hubKey,
      hubSecret: box.seal(hubSecret),
    }
  );
  await q(`UPDATE whitelabel_settings SET hub = NULL WHERE id = 1`);
  resetHubCache();

  const parentGis = buildGisService(parentDeps);
  const signer = providerFor(parentDeps);
  let seq = 0;
  const gisCallback = (body) => {
    const headers = { 'x-merchant-id': 'test-merchant', 'x-timestamp': String(Math.floor(Date.now() / 1000)), 'x-nonce': `n-${process.pid}-${(seq += 1)}` };
    headers['x-sign'] = signer.sign(body, { 'X-Merchant-Id': headers['x-merchant-id'], 'X-Timestamp': headers['x-timestamp'], 'X-Nonce': headers['x-nonce'] });
    return parentGis.handleTransaction({ body, headers });
  };
  const rounds = () => q(`SELECT kind, amount FROM whitelabel_casino_rounds WHERE whitelabel_id = :wlId ORDER BY id`, { wlId });
  const tx = (tag) => `HUB-${process.pid}-${tag}`;

  let gisSession = null;
  await t.test('a copy opens a Slotegrator game on the parent account, as wl<id>_<player>', async () => {
    const out = await buildGisService(copyDeps).launch({ userId: uid, gameUuid: 'game-1', playerName: 'p', currency: 'INR', device: 'desktop' });
    gisSession = out.sessionId;
    assert.equal(out.url, 'https://game.gis.test/play');
    const sent = upstream.findLast((u) => u.pathname.endsWith('/games/init'));
    assert.equal(sent.body.player_id, `wl${wlId}_${uid}`);
  });

  await t.test('Slotegrator callbacks for the copy’s player settle on the copy; the parent records the rounds once', async () => {
    const base = { player_id: `wl${wlId}_${uid}`, currency: 'INR', game_uuid: 'game-1', session_id: gisSession };
    const balance = await gisCallback({ ...base, action: 'balance' });
    assert.equal(balance.balance, '1000.0000');

    const bet = { ...base, action: 'bet', amount: '100', transaction_id: tx('b1') };
    const first = await gisCallback(bet);
    assert.equal(first.balance, '900.0000', JSON.stringify(first));
    assert.equal((await gisCallback(bet)).balance, '900.0000', 'a provider retry is not a second bet');
    assert.equal((await gisCallback({ ...base, action: 'win', amount: '250', transaction_id: tx('w1') })).balance, '1150.0000');
    assert.equal(copyBalances.get(String(uid)), '1150.00000000');
    assert.deepEqual(
      (await rounds()).map((r) => [r.kind, money.fromStored(r.amount)]),
      [
        ['bet', '100.00000000'],
        ['win', '250.00000000'],
      ]
    );
    // A forged callback (bad signature) never reaches the copy.
    const forged = await parentGis.handleTransaction({ body: { ...bet, transaction_id: tx('b2') }, headers: { 'x-sign': 'nope', 'x-timestamp': String(Math.floor(Date.now() / 1000)) } });
    assert.ok(forged.error_code);
    assert.equal(copyBalances.get(String(uid)), '1150.00000000');
  });

  await t.test('original games: launch on the parent account, callbacks settle on the copy', async () => {
    const launched = await buildOriginalGamesService(copyDeps).launch({ userId: uid, gameCode: 'crash', currency: 'INR', device: 'desktop' });
    assert.equal(launched.gameLaunchUrl, 'https://originals.test/play');
    const sent = upstream.findLast((u) => u.pathname.endsWith('/v1/sessions/launch'));
    assert.deepEqual([sent.body.player.id, sent.body.mode], [`wl${wlId}_${uid}`, 'real']);

    const parentOg = buildOriginalGamesService(parentDeps);
    const body = { player_id: `wl${wlId}_${uid}`, currency: 'INR', session_id: launched.sessionId };
    const rawBody = Buffer.from(JSON.stringify(body));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = crypto.randomBytes(16).toString('hex');
    const path = '/api/v1/casino/original-games/wallet/balance';
    const headers = { 'x-timestamp': timestamp, 'x-nonce': nonce, 'x-signature': ogSign('og-webhook', { method: 'POST', path, query: '', timestamp, nonce, body: rawBody }) };
    const answer = await parentOg.callback('balance', { body, rawBody, headers, method: 'POST', path, query: '' });
    assert.deepEqual([answer.status, answer.body.status, answer.body.balance], [200, 'OK', 115000], JSON.stringify(answer));
  });

  await t.test('the parent refuses what the plan or the allow-list leaves out', async () => {
    const call = (path, body) => hubAuth.hubRequest({ baseUrl: `http://127.0.0.1:${parentPort}`, key: hubKey, secret: hubSecret, direction: 'c2p', path: `/api/v1/casino/wl-hub${path}`, body }).catch((e) => e);
    assert.equal((await call('/gis/provider', { method: 'POST', path: '/freespins/set', params: {} })).code, 'HUB_NOT_ALLOWED');
    await q(`UPDATE whitelabels SET plan = CAST(:plan AS JSONB) WHERE id = :wlId`, { wlId, plan: JSON.stringify(plan(false, false)) });
    assert.equal((await call('/gis/provider', { method: 'POST', path: '/games/init', params: { player_id: String(uid) } })).code, 'NOT_ENTITLED');
    assert.equal((await call('/og/provider', { method: 'GET', path: '/v1/games' })).code, 'NOT_ENTITLED');
    const wrongWay = await hubAuth
      .hubRequest({ baseUrl: `http://127.0.0.1:${copyPort}`, key: hubKey, secret: hubSecret, direction: 'c2p', path: '/api/v1/casino/wl-hub/in/gis', body: { action: 'win', player_id: String(uid) } })
      .catch((e) => e);
    assert.equal(wrongWay.status, 401, 'the copy only takes the parent’s signature');
  });
});

test('casino-service reads the secret box key the hub secrets are sealed with', () => {
  // The parent seals each whitelabel's hub secret with TOTP_ENCRYPTION_KEY (admin-service, setup
  // worker); a casino config without it falls back to another key and refuses every copy (401).
  const before = process.env.TOTP_ENCRYPTION_KEY;
  process.env.TOTP_ENCRYPTION_KEY = 'c'.repeat(64);
  try {
    const { loadEnv, secretEncryptionEnvShape } = require('@ibitplay/common');
    assert.equal(loadEnv(secretEncryptionEnvShape).TOTP_ENCRYPTION_KEY, 'c'.repeat(64));
    const source = require('node:fs').readFileSync(require.resolve('../../../config'), 'utf8');
    assert.match(source, /\.\.\.secretEncryptionEnvShape/);
  } finally {
    if (before === undefined) delete process.env.TOTP_ENCRYPTION_KEY;
    else process.env.TOTP_ENCRYPTION_KEY = before;
  }
});
