'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ipGuard } = require('../routes/public.routes');
const { RESPONSE_CODES } = require('../seamless.constants');

const run = (allowed, ip) => {
  let passed = false;
  let body = null;
  ipGuard(allowed)({ ip }, { json: (b) => (body = b) }, () => (passed = true));
  return { passed, body };
};

test('seamless callbacks: only the allowlisted provider IPs reach the wallet', () => {
  assert.equal(run(['203.0.113.7'], '203.0.113.7').passed, true);
  assert.equal(run(['203.0.113.7'], '::ffff:203.0.113.7').passed, true, 'IPv4-mapped spelling');
  const refused = run(['203.0.113.7'], '198.51.100.1');
  assert.equal(refused.passed, false);
  assert.equal(refused.body.code, RESPONSE_CODES.INVALID_SIGN, "refused in the provider's envelope");
  assert.equal(run([], '198.51.100.1').passed, true, 'unset = any source (local development)');
});
