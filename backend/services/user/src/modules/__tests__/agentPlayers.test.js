'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const express = require('express');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.RATE_LIMIT_ENABLED = 'false';

const db = require('@ibitplay/db');
const { createLogger, errorHandler, entitlements } = require('@ibitplay/common');
const {
  AGENT_PLAYER_RESTRICTIONS,
  PLAYER_CAPABILITIES,
  createAgentPlayerResolver,
  configureAgentPlayers,
  resetAgentPlayers,
  denyAgentPlayer,
  isAgentPlayer,
} = require('@ibitplay/auth');

/**
 * Players owned by the agent tree get no promotions, vault, deposits, swap or
 * withdrawals.
 *
 * Product rule: a player whose `parent_staff_id` is a SUPER_MASTER (4),
 * MASTER (5) or AGENT (6) — or an EXECUTIVE staff row under one — is funded by
 * that agent only. Direct signups and players owned by house staff (1–3) keep
 * everything.
 */

const PROMO = AGENT_PLAYER_RESTRICTIONS.promotions.code;
const VAULT = AGENT_PLAYER_RESTRICTIONS.vault.code;
const DEPOSIT = AGENT_PLAYER_RESTRICTIONS.deposit.code;
const SWAP = AGENT_PLAYER_RESTRICTIONS.swap.code;
const WITHDRAW = AGENT_PLAYER_RESTRICTIONS.withdraw.code;

test('the restriction table', () => {
  assert.deepEqual(PLAYER_CAPABILITIES, ['promotions', 'vault', 'deposit', 'swap', 'withdraw', 'tips', 'kyc']);
  assert.equal(PROMO, 'PROMOTIONS_NOT_FOR_AGENT_USERS');
  assert.equal(VAULT, 'VAULT_NOT_FOR_AGENT_USERS');
  assert.equal(DEPOSIT, 'DEPOSIT_NOT_FOR_AGENT_USERS');
  assert.equal(SWAP, 'SWAP_NOT_FOR_AGENT_USERS');
  assert.equal(WITHDRAW, 'WITHDRAW_NOT_FOR_AGENT_USERS');
  assert.throws(() => denyAgentPlayer('nope'), /Unknown player capability/);
});

test('createAgentPlayerResolver — who is in the agent tree', async (t) => {
  // player id -> owner staff id; staff id -> what admin-service answers.
  const OWNERS = { 1: 40, 2: 50, 3: 60, 4: 10, 5: 20, 6: 30, 7: null, 8: 70, 9: 71, 10: 72, 11: 404 };
  const STAFF = {
    10: { level: 1 },
    20: { level: 2 },
    30: { level: 3 },
    40: { level: 4 },
    50: { level: 5 },
    60: { level: 6 },
    70: { level: 7, parentLevel: 6 }, // executive row under an agent
    71: { level: 7, parentLevel: 2 }, // executive row under an admin
    72: { level: 7, parentLevel: null },
  };
  const calls = { owner: 0, staff: 0 };
  const resolver = createAgentPlayerResolver({
    loadOwnerStaffId: async (id) => {
      calls.owner += 1;
      return OWNERS[id];
    },
    loadStaff: async (id) => {
      calls.staff += 1;
      if (!STAFF[id]) {
        const error = new Error('Staff account not found');
        error.status = 404;
        throw error;
      }
      return STAFF[id];
    },
  });

  for (const [player, label] of [
    [1, 'SUPER_MASTER parent'],
    [2, 'MASTER parent'],
    [3, 'AGENT parent'],
    [8, "an agent's executive row as parent"],
    // 2026-10-17: koi bhi parent = child user (house staff ke neeche wala bhi).
    [4, 'SUPER_ADMIN parent'],
    [5, 'ADMIN parent'],
    [6, 'SUB_ADMIN parent'],
    [9, "an admin's executive row as parent"],
    [10, 'an executive row with no parent'],
    [11, 'a parent admin-service does not know'],
  ]) {
    await t.test(`${label} -> restricted`, async () => {
      assert.equal(await resolver.isAgentPlayer(player), true);
      assert.deepEqual(await resolver.capabilities(player), { promotions: false, vault: false, deposit: false, swap: false, withdraw: false, tips: false, kyc: false });
    });
  }

  for (const [player, label] of [[7, 'no parent (direct signup)']]) {
    await t.test(`${label} -> allowed`, async () => {
      assert.equal(await resolver.isAgentPlayer(player), false);
      assert.deepEqual(await resolver.capabilities(player), { promotions: true, vault: true, deposit: true, swap: true, withdraw: true, tips: true, kyc: true });
    });
  }

  await t.test('the owner lookup is cached', async () => {
    const before = { ...calls };
    for (let i = 0; i < 5; i += 1) await resolver.isAgentPlayer(3);
    assert.deepEqual(calls, before);
  });

  await t.test('a direct signup never asks admin-service', async () => {
    const before = calls.staff;
    resolver.invalidate(7);
    await resolver.isAgentPlayer(7);
    assert.equal(calls.staff, before);
  });

  await t.test('a failed owner read fails closed (throws), and is not cached', async () => {
    let down = true;
    const flaky = createAgentPlayerResolver({
      loadOwnerStaffId: async () => {
        if (down) throw Object.assign(new Error('owner lookup is unavailable'), { status: 503 });
        return 60;
      },
      loadStaff: async () => ({ level: 6 }),
    });
    await assert.rejects(flaky.isAgentPlayer(1), /unavailable/);
    down = false;
    assert.equal(await flaky.isAgentPlayer(1), true);
  });

  await t.test('unconfigured, nobody is an agent player', async () => {
    resetAgentPlayers();
    assert.equal(await isAgentPlayer(1), false);
  });
});

/**
 * Every guarded player route family, mounted for real over the test database.
 * The agent player and the direct player are real `users` rows; only
 * admin-service's answer about the owner's level is stubbed.
 */
test('guarded player routes: agent-tree player refused, direct player served', async (t) => {
  const logger = createLogger({ name: 'agent-players', level: 'silent' });
  const TEST_DB = process.env.TEST_DB_NAME || 'ibitplay_test';

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
  t.after(async () => {
    resetAgentPlayers();
    entitlements.resetEntitlements();
    if (connection) await connection.close();
  });
  entitlements.resetEntitlements();

  const { Users } = connection.models;
  const agentUser = await Users.findOne({
    where: { parent_staff_id: { [db.Op.ne]: null } },
    attributes: ['id', 'parent_staff_id'],
    raw: true,
  });
  const directUser = await Users.findOne({ where: { parent_staff_id: null }, attributes: ['id'], raw: true });
  if (!agentUser || !directUser) {
    t.skip('Test database has no owned and no direct player to use');
    return;
  }
  const AGENT_STAFF = Number(agentUser.parent_staff_id);

  configureAgentPlayers({
    loadOwnerStaffId: async (userId) =>
      (await Users.findByPk(userId, { attributes: ['parent_staff_id'], raw: true }))?.parent_staff_id ?? null,
    // admin-service's answer: the owner is an AGENT (level 6).
    loadStaff: async (staffId) => (Number(staffId) === AGENT_STAFF ? { id: AGENT_STAFF, level: 6 } : null),
  });

  const deps = {
    config: {
      SERVICE_NAME: 'user-service',
      NODE_ENV: 'test',
      ROOT_STAFF_ID: 1,
      RATE_LIMIT_ENABLED: false,
      CLUB_BANNER_STORAGE_DIR: '/tmp/ibitplay-test-club-banners',
      KYC_STORAGE_DIR: '/tmp/ibitplay-test-kyc',
      FIAT_DEPOSIT_STORAGE_DIR: '/tmp/ibitplay-test-fiat-deposits',
      P2P_STORAGE_DIR: '/tmp/ibitplay-test-p2p',
    },
    logger,
    db: connection,
    models: connection.models,
    clients: {
      admin: { get: async () => ({}), post: async () => ({}) },
      casino: { get: async () => ({}), post: async () => ({}) },
      sports: { get: async () => ({}), post: async () => ({}) },
    },
    wallet: {},
    auth: {},
  };

  /** [module, method, path, refusal code, body, { anyStatus }] */
  const ROUTES = [
    ['bonus', 'GET', '/', PROMO],
    ['bonus', 'POST', '/redeem', PROMO, { code: 'NOPE' }],
    ['bonus', 'POST', '/claim/daily', PROMO, {}],
    ['gift-cards', 'GET', '/', PROMO],
    ['gift-cards', 'POST', '/redeem', PROMO, { code: 'NOPE' }],
    ['gift-cards', 'POST', '/claim', PROMO, {}],
    ['spin-wheel', 'GET', '/eligibility', PROMO],
    ['spin-wheel', 'POST', '/spin', PROMO, {}],
    ['vip', 'GET', '/', PROMO],
    ['club', 'GET', '/me', PROMO],
    ['affiliate', 'GET', '/team', PROMO],
    ['affiliate', 'POST', '/rewards/claim-all', PROMO, {}],
    ['race', 'GET', '/rewards', PROMO],
    ['rakeback', 'GET', '/', PROMO],
    ['profile', 'GET', '/referral', PROMO],
    ['vault', 'GET', '/lock-options', VAULT],
    ['vault', 'POST', '/transfer-in', VAULT, {}],
    ['fiat-deposit', 'POST', '/', DEPOSIT, {}],
    ['payment-orders', 'POST', '/deposits', DEPOSIT, {}],
    ['p2p', 'POST', '/orders', DEPOSIT, {}],
    ['p2p', 'POST', '/orders/1/paid', DEPOSIT, {}],
    ['bank-details', 'GET', '/INR', DEPOSIT],
    ['swap', 'GET', '/balances', SWAP],
    // The test database may hold no exchange rates (409 SWAP_RATE_UNAVAILABLE):
    // for the direct player only "not refused by the rule" is asserted.
    ['swap', 'GET', '/estimate?fromCurrency=USDT&toCurrency=BTC&amount=1', SWAP, undefined, { anyStatus: true }],
    ['swap', 'POST', '/', SWAP, {}],
    // Withdrawals: an EMPTY body must still get the 403, not a 422 — the rule
    // runs before validation.
    ['fiat-withdraw', 'POST', '/', WITHDRAW, {}],
    ['payment-orders', 'POST', '/withdrawals', WITHDRAW, {}],
    ['p2p', 'POST', '/sell-orders', WITHDRAW, {}],
    ['withdrawal-whitelist', 'POST', '/', WITHDRAW, {}],
    ['withdrawal-whitelist', 'PUT', '/enforcement', WITHDRAW, {}],
    ['withdrawal-whitelist', 'PATCH', '/1', WITHDRAW, {}],
    ['withdrawal-whitelist', 'DELETE', '/1', WITHDRAW, {}],
    ['bank-accounts', 'POST', '/', WITHDRAW, {}],
    ['bank-accounts', 'PUT', '/1/default', WITHDRAW, {}],
    ['bank-accounts', 'DELETE', '/1', WITHDRAW, {}],
  ];

  const app = express();
  app.use(express.json());
  // Stands in for the loader's `authenticate()` + `requireActive()`.
  app.use((req, _res, next) => {
    req.user = { id: Number(req.headers['x-test-user']), role: 'player', status: 'active' };
    next();
  });
  for (const name of new Set([...ROUTES.map(([m]) => m), 'crypto-withdraw'])) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    app.use(`/${name}`, require(`../${name}/routes/user.routes`)(deps));
  }
  app.use(errorHandler({ logger }));

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, path, userId, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-test-user': String(userId) },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, code: json?.error?.code ?? json?.code };
  };

  const AGENT_CODES = new Set([PROMO, VAULT, DEPOSIT, SWAP, WITHDRAW]);

  for (const [name, method, route, refusal, body, opts = {}] of ROUTES) {
    const path = `/${name}${route === '/' ? '' : route}`;

    await t.test(`${method} ${path}: agent-tree player gets 403 ${refusal}`, async () => {
      const r = await call(method, path, agentUser.id, body);
      assert.equal(r.status, 403, `${method} ${path}: ${r.status} ${r.code}`);
      assert.equal(r.code, refusal);
    });

    await t.test(`${method} ${path}: direct player is not refused by the rule`, async () => {
      const r = await call(method, path, directUser.id, body);
      assert.ok(!AGENT_CODES.has(r.code), `${method} ${path}: ${r.status} ${r.code}`);
      if (method === 'GET' && !opts.anyStatus) assert.equal(r.status, 200, `${method} ${path}: ${r.status} ${r.code}`);
    });
  }

  await t.test('GET /swap/history stays readable for an agent-tree player', async () => {
    const r = await call('GET', '/swap/history', agentUser.id);
    assert.equal(r.status, 200, `${r.status} ${r.code}`);
  });

  for (const [name, route] of [
    ['fiat-withdraw', '/'],
    ['crypto-withdraw', '/'],
    ['crypto-withdraw', '/summary'],
    ['payment-orders', '/orders'],
    ['p2p', '/sell-orders'],
    ['withdrawal-whitelist', '/'],
    ['bank-accounts', '/'],
  ]) {
    const path = `/${name}${route === '/' ? '' : route}`;
    await t.test(`GET ${path} (withdrawal history) stays readable for an agent-tree player`, async () => {
      const r = await call('GET', path, agentUser.id);
      assert.equal(r.status, 200, `${r.status} ${r.code}`);
    });
  }

  await t.test('the SUBMIT_NEW_WITHDRAWL socket refuses an agent-tree player before anything else', async () => {
    const { EVENTS } = require('@ibitplay/socket');
    const handlers = {};
    require('../crypto-withdraw/sockets').register({ on: (event, def) => (handlers[event] = def), deps });
    const submit = handlers[EVENTS.SUBMIT_NEW_WITHDRAWL].handle;
    const agent = await submit({}, { userId: agentUser.id });
    assert.equal(agent.status, AGENT_PLAYER_RESTRICTIONS.withdraw.message);
    assert.equal(agent.error.code, WITHDRAW);
    // The direct player gets past the rule and fails on the empty payload instead.
    const direct = await submit({}, { userId: directUser.id }).catch((e) => ({ error: { code: e.code } }));
    assert.ok(direct.error?.code && direct.error.code !== WITHDRAW, JSON.stringify(direct));
  });

  await t.test('SwapService.swap (the SUBMIT_NEW_SWAP socket path) refuses an agent-tree player', async () => {
    const { SwapService } = require('../swap/swap.service');
    const swap = new SwapService(deps);
    await assert.rejects(
      swap.swap({ userId: String(agentUser.id), fromCurrency: 'USDT', toCurrency: 'BTC', amount: '1' }),
      (e) => e.code === SWAP && e.status === 403
    );
  });

  await t.test('VIP level-up / rank-up is not credited to an agent-tree player', async () => {
    const { VipService } = require('../vip/vip.service');
    const vip = new VipService(deps);
    const result = await vip.onWager({ userId: agentUser.id, previousWager: '0', newWager: '1000000000' });
    assert.equal(result.skipped, 'AGENT_TREE_PLAYER');
    assert.deepEqual(result.granted, []);
    assert.ok(result.vip.level > 0, 'the level itself still moves');
    const periodic = await vip.awardPeriodic({ userId: agentUser.id });
    assert.equal(periodic.awarded, 0);
  });

  await t.test('affiliate payouts are not credited to an agent-tree player', async () => {
    const { AffiliateService } = require('../affiliate/affiliate.service');
    const affiliate = new AffiliateService(deps);
    await assert.rejects(affiliate.claimAllRewards({ userId: agentUser.id }), (e) => e.code === PROMO);
    await assert.rejects(affiliate.claimReward({ userId: agentUser.id, rewardId: 1 }), (e) => e.code === PROMO);
    const reg = await affiliate.applyRegistrationBonuses({ userId: agentUser.id });
    assert.equal(reg.registerBonus, false);
  });

  await t.test('/auth/me carries the capabilities', async () => {
    const { AuthService } = require('../auth/auth.service');
    const service = new AuthService({
      ...deps,
      config: {
        ...deps.config,
        JWT_ACCESS_SECRET: `test-access-${'a'.repeat(40)}`,
        JWT_REFRESH_SECRET: `test-refresh-${'r'.repeat(40)}`,
        JWT_ISSUER: 'ibitplay',
        JWT_AUDIENCE: 'ibitplay-api',
      },
      mailer: null,
    });
    const agent = await service.me(agentUser.id);
    // manualDeposit / manualWithdraw: admin ke Manual switch (manual_payment_control), default ON.
    assert.deepEqual(agent.capabilities, { promotions: false, vault: false, deposit: false, swap: false, withdraw: false, tips: false, kyc: false, manualDeposit: true, manualWithdraw: true });
    const direct = await service.me(directUser.id);
    assert.deepEqual(direct.capabilities, { promotions: true, vault: true, deposit: true, swap: true, withdraw: true, tips: true, kyc: true, manualDeposit: true, manualWithdraw: true });
  });
});
