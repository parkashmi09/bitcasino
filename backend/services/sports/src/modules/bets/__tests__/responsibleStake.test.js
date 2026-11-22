'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { responsibleStake, slipStake } = require('../responsibleStake');

/**
 * Exchange placement debits `credits` itself, so the player's own breaks and limits are asked of
 * user-service before /place and /place-combined (sports: true covers SPORTS + PLATFORM). A
 * refusal, or user-service down, stops the bet: the handler (and the debit) never runs.
 */

function run(body, post, user = { account: { id: 42 } }) {
  return new Promise((resolve) => {
    responsibleStake({ clients: { user: { post } } })({ user, body }, {}, (err) => resolve(err));
  });
}

test('single bet: asks with the player coin and stake, sports=true', async () => {
  const calls = [];
  const err = await run({ stake_amount: '150', original_currency: 'INR' }, async (path, body) => calls.push([path, body]));
  assert.strictEqual(err, undefined);
  assert.deepStrictEqual(calls, [['/internal/user/responsible-gambling/check', { userId: '42', currency: 'INR', amount: '150', sports: true }]]);
});

test('a RESPONSIBLE_* refusal reaches next(err): the bet is not placed', async () => {
  const refusal = Object.assign(new Error('On a break'), { statusCode: 403, code: 'RESPONSIBLE_SELF_EXCLUDED' });
  const err = await run({ stake_amount: 10, currency: 'INR' }, async () => { throw refusal; });
  assert.strictEqual(err, refusal);
});

test('user-service unreachable fails closed', async () => {
  const err = await run({ stake_amount: 10, currency: 'INR' }, async () => { throw new Error('ECONNREFUSED'); });
  assert.ok(err instanceof Error);
});

test('combined slip: legs summed; a badlo slip counts its largest leg', () => {
  assert.deepStrictEqual(slipStake({ bets: [{ stake_amount: 100, currency: 'INR' }, { stake_amount: 50 }] }), { currency: 'INR', amount: 150 });
  assert.deepStrictEqual(
    slipStake({ bets: [{ stake_amount: 100, currency: 'INR', badlo: true }, { stake_amount: 300, market_type: 'badlo' }] }),
    { currency: 'INR', amount: 300 }
  );
});

test('no currency / no stake: passed to the handler, which refuses it before any debit', async () => {
  let called = false;
  const err = await run({ stake_amount: 0, currency: 'INR' }, async () => { called = true; });
  assert.strictEqual(err, undefined);
  assert.strictEqual(called, false);
});
