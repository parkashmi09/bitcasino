'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ExchangeService } = require('../exchange.service');

test('points settle refuses an owner who has no transaction password set (no silent skip)', async () => {
  process.env.TXN_PASSWORD_MODE = 'separate'; // login mode always asks; the gap was separate mode
  let settled = false;
  const service = new ExchangeService({
    models: { Staff: { findByPk: async () => ({ transaction_password: null }) } },
    db: { transaction: async () => { settled = true; } },
    logger: { info() {} },
    config: {},
  });
  await assert.rejects(
    service.settle({ actor: { id: 1, canIssueFunds: true, permissions: ['*'] }, accountType: 'user', accountId: '1', points: 10, remark: 'x' }),
    (e) => e.code === 'TXN_PASSWORD_NOT_SET'
  );
  assert.equal(settled, false);
});

test('points settle binds the direction to its grant: credit-only cannot W, debit-only cannot D', async () => {
  let reached = false;
  const service = new ExchangeService({
    models: { Staff: { findByPk: async () => { reached = true; return null; } } },
    db: { transaction: async () => { reached = true; } },
    logger: { info() {} },
    config: {},
  });
  for (const [permissions, points] of [[['wallet:credit'], -10], [['wallet:debit'], 10]]) {
    await assert.rejects(
      service.settle({ actor: { id: 9, permissions }, accountType: 'user', accountId: '1', points, remark: 'x' }),
      (e) => e.status === 403
    );
  }
  assert.equal(reached, false);
});
