'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createControllers } = require('../controllers');
const withdrawControllers = require('../../fiat-withdraw/controllers').createControllers;

// The handlers are asyncHandler-wrapped: run one and resolve with whatever reached next() or res.
function run(handler, req) {
  return new Promise((resolve) => {
    const res = { status: () => res, json: (body) => resolve({ body }), set: () => res };
    handler(req, res, (error) => resolve({ error }));
  });
}

test('approving a deposit checks the transaction password before crediting', async () => {
  const calls = [];
  const service = {
    wallet: {
      checkTransactionPassword: async (staffId, pw, opts) => {
        calls.push(['check', staffId, pw, opts.required]);
        if (pw !== 'right') throw Object.assign(new Error('bad'), { code: 'TXN_PASSWORD_INVALID' });
      },
    },
    approve: async (args) => {
      calls.push(['approve', args]);
      return { ok: true };
    },
  };
  const { approve } = createControllers({ service });

  const refused = await run(approve, { params: { depositId: 7 }, body: { transactionPassword: 'wrong' }, staff: { id: 1 } });
  assert.equal(refused.error?.code, 'TXN_PASSWORD_INVALID');
  assert.deepEqual(calls.map((c) => c[0]), ['check'], 'nothing is credited when the password is refused');
  assert.equal(calls[0][3], true, 'the password is required, not optional');

  calls.length = 0;
  await run(approve, { params: { depositId: 7 }, body: { transactionPassword: 'right', comment: 'ok' }, staff: { id: 1 } });
  assert.deepEqual(calls.map((c) => c[0]), ['check', 'approve']);
  assert.equal('transactionPassword' in calls[1][1], false, 'the password is not passed on to the service');
});

test('a withdrawal status change checks the transaction password first', async () => {
  let updated = false;
  const service = {
    wallet: { checkTransactionPassword: async () => { throw Object.assign(new Error('req'), { code: 'TXN_PASSWORD_REQUIRED' }); } },
    updateStatus: async () => { updated = true; },
  };
  const { updateStatus } = withdrawControllers({ service });
  const out = await run(updateStatus, { body: { withdrawalId: 1, status: 'Approved' }, staff: { id: 1 } });
  assert.equal(out.error?.code, 'TXN_PASSWORD_REQUIRED');
  assert.equal(updated, false);
});
