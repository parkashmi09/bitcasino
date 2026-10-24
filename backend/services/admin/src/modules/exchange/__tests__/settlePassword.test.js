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
    service.settle({ actor: { id: 1, canIssueFunds: true }, accountType: 'user', accountId: '1', points: 10, remark: 'x' }),
    (e) => e.code === 'TXN_PASSWORD_NOT_SET'
  );
  assert.equal(settled, false);
});
