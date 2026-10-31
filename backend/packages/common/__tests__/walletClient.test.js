'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { ServiceClient, WalletClient } = require('../src');

/**
 * The wire shape of a wallet movement.
 *
 * `ServiceClient.post(path, body)` already makes its second argument the
 * request body. `WalletClient` used to pass `{ body: {...} }`, so user-service
 * received `{"body":{...}}` and its strict schema answered 422 "Unrecognized
 * key(s) in object: 'body'" — every casino stake and payout failed. This pins
 * what actually goes over the wire, through a real ServiceClient.
 */
async function capture(run) {
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ success: true, data: { ledgerId: 7, newBalance: '90.00' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const client = new ServiceClient({ name: 'user-service', baseUrl: 'http://user.test', internalKey: 'k', callerName: 'casino-service', retries: 0 });
    const wallet = new WalletClient({ client, service: 'casino-service' });
    const result = await run(wallet);
    return { calls, result };
  } finally {
    global.fetch = realFetch;
  }
}

test('WalletClient wire shape', async (t) => {
  await t.test('debit sends the movement as the top-level JSON body', async () => {
    const { calls, result } = await capture((w) =>
      w.debit({ userId: 5, currency: 'INR', amount: '10.00', reason: 'BET_STAKE', ref: { type: 'JSGAMES', id: 'v2:r1:bet' }, description: 'd' })
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].url, 'http://user.test/internal/user/wallet/debit');
    assert.equal(calls[0].body.body, undefined, 'no { body: … } wrapper');
    assert.deepEqual(calls[0].body, {
      userId: 5,
      currency: 'INR',
      amount: '10.00',
      reason: 'BET_STAKE',
      description: 'd',
      idempotencyKey: 'casino-service:BET_STAKE:JSGAMES:v2:r1:bet',
      refType: 'JSGAMES',
      refId: 'v2:r1:bet',
    });
    assert.equal(result.ledgerId, 7, 'the envelope is unwrapped');
  });

  await t.test('credit sends the movement as the top-level JSON body', async () => {
    const { calls } = await capture((w) =>
      w.credit({ userId: 5, currency: 'USDT', amount: '2', reason: 'BET_PAYOUT', ref: { type: 'GIS', id: 9 } })
    );
    assert.equal(calls[0].url, 'http://user.test/internal/user/wallet/credit');
    assert.equal(calls[0].body.body, undefined);
    assert.equal(calls[0].body.userId, 5);
    assert.equal(calls[0].body.idempotencyKey, 'casino-service:BET_PAYOUT:GIS:9');
    assert.equal(calls[0].body.refId, '9');
  });

  await t.test('rollback sends the movement as the top-level JSON body', async () => {
    const { calls } = await capture((w) => w.rollback({ ledgerId: 42, reason: 'r' }));
    assert.equal(calls[0].url, 'http://user.test/internal/user/wallet/rollback');
    assert.deepEqual(calls[0].body, { ledgerId: 42, reason: 'r', idempotencyKey: 'casino-service:ROLLBACK:LEDGER:42' });
  });

  await t.test('the body passes user-service\'s strict movement schema', async () => {
    let schemas;
    try {
      schemas = require('../../../services/user/src/modules/wallet/wallet.validators');
    } catch {
      return; // user-service not present in this checkout
    }
    const { calls } = await capture(async (w) => {
      await w.debit({ userId: 5, currency: 'INR', amount: '10.00', reason: 'BET_STAKE', ref: { type: 'INHOUSE', id: 1 } });
      await w.rollback({ ledgerId: 3 });
    });
    assert.equal(schemas.movement.body.safeParse(calls[0].body).success, true);
    assert.equal(schemas.rollback.body.safeParse(calls[1].body).success, true);
    // And the old wrapped shape is exactly what the schema refused.
    assert.equal(schemas.movement.body.safeParse({ body: calls[0].body }).success, false);
  });
});
