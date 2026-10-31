'use strict';

// These cases exercise the SEPARATE transaction password (`staff.transaction_password`);
// login mode (the default) is covered in staff-auth/__tests__/txnPasswordMode.test.js.
process.env.TXN_PASSWORD_MODE = 'separate';

const test = require('node:test');
const assert = require('node:assert');

const { STAFF_LEVELS, configureAgentPlayers, resetAgentPlayers } = require('@ibitplay/auth');

const { createAdminController } = require('../controllers/admin.controller');
const { WalletService } = require('../wallet.service');

/**
 * `POST /admin/user/wallet/adjust` — who gets which path (B2B fix 1).
 *
 * ONLY the platform owner (Super Admin, level 1, its own session) keeps the
 * operator adjustment, for coins other than INR, behind its transaction
 * password once one is set. Owner INR goes to admin-service (migration 099):
 * the owner's `credits` wallet pays for a child, a direct user is not charged. Everyone else — Admin and Sub Admin included, and every
 * executive — goes to admin-service as a transfer from its own float to its
 * DIRECT player, with the transaction password REQUIRED there.
 */

const call = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(body) { resolve({ status: this.statusCode, body }); return this; },
    };
    handler(req, res, (err) => (err ? reject(err) : resolve({ status: res.statusCode, body: null })));
  });

const body = {
  userId: 42, currency: 'INR', amount: '100', operation: 'credit', description: 'test', transactionPassword: 'tp',
};

const fakeService = () => {
  const calls = [];
  return {
    calls,
    assertPlayerVisible: async (...args) => { calls.push(['visible', ...args]); },
    agentAdjust: async (...args) => { calls.push(['agentAdjust', ...args]); return { transferId: '1' }; },
    checkTransactionPassword: async (...args) => { calls.push(['checkTxn', ...args]); return { set: true, verified: true }; },
    adminAdjust: async (...args) => { calls.push(['adminAdjust', ...args]); return { ledgerId: 1 }; },
  };
};

test('wallet adjust routing', async (t) => {
  for (const level of [STAFF_LEVELS.ADMIN, STAFF_LEVELS.SUB_ADMIN, STAFF_LEVELS.SUPER_MASTER, STAFF_LEVELS.MASTER, STAFF_LEVELS.AGENT]) {
    await t.test(`level ${level} is a transfer from its own float`, async () => {
      const service = fakeService();
      const ctrl = createAdminController({ service });
      await call(ctrl.adjust, { body, staff: { id: 9, level, permissions: ['*'] } });

      const names = service.calls.map((c) => c[0]);
      assert.deepEqual(names, ['visible', 'agentAdjust']);
      assert.deepEqual(service.calls[1][2], { staffId: 9, executiveId: null });
    });
  }

  await t.test('an executive row acting for an agent takes the agent path', async () => {
    const service = fakeService();
    const ctrl = createAdminController({ service });
    await call(ctrl.adjust, { body, staff: { id: 9, level: STAFF_LEVELS.EXECUTIVE, parentLevel: STAFF_LEVELS.AGENT, permissions: ['*'] } });
    assert.ok(service.calls.some((c) => c[0] === 'agentAdjust'));
    assert.ok(!service.calls.some((c) => c[0] === 'adminAdjust'));
  });

  await t.test('the Super Admin cannot adjust a non-INR coin for a CHILD user (any parent) — Sports Exchange INR only', async () => {
    configureAgentPlayers({ isAgentPlayer: async (id) => Number(id) === 42 });
    try {
      const service = fakeService();
      const ctrl = createAdminController({ service });
      await assert.rejects(
        () => call(ctrl.adjust, { body: { ...body, currency: 'USDT' }, staff: { id: 3, level: STAFF_LEVELS.SUPER_ADMIN, permissions: ['*'] } }),
        (err) => err.code === 'DEPOSIT_NOT_FOR_AGENT_USERS' && err.status === 403
      );
      assert.ok(!service.calls.some((c) => c[0] === 'adminAdjust'));
    } finally {
      resetAgentPlayers();
    }
  });

  await t.test('the Super Admin adjusts a non-INR coin (operator adjustment), after the transaction-password check', async () => {
    const service = fakeService();
    const ctrl = createAdminController({ service });
    await call(ctrl.adjust, { body: { ...body, currency: 'USDT' }, staff: { id: 3, level: STAFF_LEVELS.SUPER_ADMIN, permissions: ['*'] } });

    const names = service.calls.map((c) => c[0]);
    assert.deepEqual(names, ['visible', 'checkTxn', 'adminAdjust']);
    assert.deepEqual(service.calls[1].slice(1), [3, 'tp', { required: true, executiveId: null }]);
  });

  await t.test('the Super Admin adjusting INR goes to admin-service (owner wallet / direct user)', async () => {
    const service = fakeService();
    const ctrl = createAdminController({ service });
    await call(ctrl.adjust, { body, staff: { id: 3, level: STAFF_LEVELS.SUPER_ADMIN, permissions: ['*'] } });

    const names = service.calls.map((c) => c[0]);
    assert.deepEqual(names, ['visible', 'agentAdjust']);
    assert.deepEqual(service.calls[1][2], { staffId: 3 });
  });

  await t.test("an executive acting for the Super Admin does not mint", async () => {
    const service = fakeService();
    const ctrl = createAdminController({ service });
    await call(ctrl.adjust, { body, staff: { id: 3, level: STAFF_LEVELS.SUPER_ADMIN, executiveId: 5, permissions: ['*'] } });
    assert.ok(service.calls.some((c) => c[0] === 'agentAdjust'));
    assert.ok(!service.calls.some((c) => c[0] === 'adminAdjust'));
  });

  await t.test('a refused transaction password stops the owner adjustment', async () => {
    const service = fakeService();
    service.checkTransactionPassword = async () => {
      const err = new Error('The transaction password is not correct');
      err.status = 403;
      err.code = 'TXN_PASSWORD_INVALID';
      throw err;
    };
    const ctrl = createAdminController({ service });
    await assert.rejects(() => call(ctrl.adjust, { body: { ...body, currency: 'USDT' }, staff: { id: 3, level: STAFF_LEVELS.SUPER_ADMIN, permissions: ['*'] } }), (e) => e.code === 'TXN_PASSWORD_INVALID');
    assert.ok(!service.calls.some((c) => c[0] === 'adminAdjust'));
  });

  await t.test('agentAdjust forwards the caller\'s per-submit idempotency key, namespaced by staff', async () => {
    const posted = [];
    const service = Object.create(WalletService.prototype);
    service.clients = { admin: { post: async (path, payload) => { posted.push([path, payload]); return { replayed: true }; } } };

    await service.agentAdjust({ ...body, idempotencyKey: 'ui-0f2c9a7e-1111' }, { staffId: 9 });
    assert.equal(posted[0][0], '/internal/admin/accounts/player-adjust');
    assert.equal(posted[0][1].staffId, 9);
    assert.equal(posted[0][1].transactionPassword, 'tp');
    assert.equal(posted[0][1].idempotencyKey, 'adm:9:ui-0f2c9a7e-1111');
  });

  await t.test('identical adjusts without a key are NOT deduplicated (no per-minute bucket)', async () => {
    const posted = [];
    const service = Object.create(WalletService.prototype);
    service.clients = { admin: { post: async (path, payload) => { posted.push(payload); return { replayed: false }; } } };
    service.pushBalances = async () => {};
    await service.agentAdjust(body, { staffId: 9 }).catch(() => {});
    await service.agentAdjust(body, { staffId: 9 }).catch(() => {});
    assert.equal(posted.length, 2);
    assert.notEqual(posted[0].idempotencyKey, posted[1].idempotencyKey);
    assert.match(posted[0].idempotencyKey, /^adm:9:auto-/);
  });

  await t.test('adminAdjust uses the same key for a retry and a new key for a new submit', async () => {
    const service = Object.create(WalletService.prototype);
    const keys = [];
    service.credit = async (input) => { keys.push(input.idempotencyKey); return {}; };
    await service.adminAdjust({ ...body, idempotencyKey: 'submit-aaaaaaaa' }, { staffId: 1 });
    await service.adminAdjust({ ...body, idempotencyKey: 'submit-aaaaaaaa' }, { staffId: 1 });
    await service.adminAdjust({ ...body, idempotencyKey: 'submit-bbbbbbbb' }, { staffId: 1 });
    assert.deepEqual(keys, ['adm:1:submit-aaaaaaaa', 'adm:1:submit-aaaaaaaa', 'adm:1:submit-bbbbbbbb']);
  });

  await t.test('the controller takes the key from the Idempotency-Key header when the body has none', async () => {
    const svc = fakeService();
    const ctrl = createAdminController({ service: svc });
    await call(ctrl.adjust, {
      staff: { id: 9, level: STAFF_LEVELS.AGENT, permissions: ['*'] },
      body: { ...body },
      headers: { 'idempotency-key': 'hdr-12345678' },
    });
    const agentCall = svc.calls.find((c) => c[0] === 'agentAdjust');
    assert.equal(agentCall[1].idempotencyKey, 'hdr-12345678');
  });

  await t.test('a one-direction grant cannot move money the other way', async () => {
    for (const [granted, operation] of [[['wallet:credit'], 'debit'], [['wallet:debit'], 'credit']]) {
      const svc = fakeService();
      const ctrl = createAdminController({ service: svc });
      await assert.rejects(
        () => call(ctrl.adjust, { body: { ...body, operation }, staff: { id: 9, level: STAFF_LEVELS.EXECUTIVE, permissions: granted } }),
        (e) => e.status === 403
      );
      assert.deepEqual(svc.calls, []);
    }
    const svc = fakeService();
    await call(createAdminController({ service: svc }).adjust, { body: { ...body, operation: 'debit' }, staff: { id: 9, level: STAFF_LEVELS.EXECUTIVE, permissions: ['wallet:debit'] } });
    assert.deepEqual(svc.calls.map((c) => c[0]), ['visible', 'agentAdjust']);
  });

  await t.test('the validator accepts a per-submit key and refuses a malformed one', () => {
    const v = require('../wallet.validators');
    assert.equal(v.adminAdjust.body.safeParse({ ...body, idempotencyKey: 'ab12cd34-ef56' }).success, true);
    assert.equal(v.adminAdjust.body.safeParse({ ...body, idempotencyKey: 'bad key with spaces' }).success, false);
  });
});

test('a whitelabel company cannot credit another coin with no deduction; it can still debit', async () => {
  const service = fakeService();
  const ctrl = createAdminController({ service, config: { WHITELABEL_MODE: true } });
  const owner = { id: 1, level: STAFF_LEVELS.SUPER_ADMIN, permissions: ['*'] };

  await assert.rejects(
    () => call(ctrl.adjust, { body: { ...body, currency: 'USDT' }, staff: owner }),
    (err) => err.code === 'WHITELABEL_NO_SELF_FUNDING' && err.status === 403
  );
  assert.equal(service.calls.some((c) => c[0] === 'adminAdjust'), false, 'nothing credited');

  await call(ctrl.adjust, { body: { ...body, currency: 'USDT', operation: 'debit' }, staff: owner });
  assert.equal(service.calls.at(-1)[0], 'adminAdjust');

  await call(ctrl.adjust, { body, staff: owner });
  assert.equal(service.calls.at(-1)[0], 'agentAdjust', 'INR still goes to admin-service, which debits the company');
});
