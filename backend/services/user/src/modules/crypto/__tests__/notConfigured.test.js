'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CryptoService } = require('../crypto.service');

test('an unconfigured CCPayment refuses with 503 and keeps the missing names out of the public error', async () => {
  const logged = [];
  const service = new CryptoService({ models: {}, db: { sequelize: {} }, config: {}, logger: { error: (o) => logged.push(o), warn() {}, info() {} } });
  const error = await service.chains().then(() => null, (e) => e);
  assert.ok(error, 'chains() should refuse');
  assert.equal(error.status, 503);
  assert.equal(error.code, 'CRYPTO_NOT_CONFIGURED');
  assert.doesNotMatch(JSON.stringify({ message: error.message, details: error.details }), /CCPAYMENT/);
  assert.ok(logged.some((o) => o.missing?.includes('CCPAYMENT_APP_SECRET')), 'the names go to the server log');
});
