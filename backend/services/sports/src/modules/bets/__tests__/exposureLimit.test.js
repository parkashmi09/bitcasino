'use strict';

const test = require('node:test');
const assert = require('node:assert');

test('exposureLimitExceeded: 0 = no limit, hedge always allowed, liability above limit rejected', async () => {
  const { exposureLimitExceeded } = await import('../../../lib/helper/exposureLimit.mjs');
  const check = (limit, totalExposure, addsLiability = true) => exposureLimitExceeded({ limit, totalExposure, addsLiability });

  // No limit set
  assert.strictEqual(check(0, -1_000_000), false);
  assert.strictEqual(check('0', -1_000_000), false);
  assert.strictEqual(check(null, -1_000_000), false);

  // Within / exactly at / above the limit (exposure is stored negative)
  assert.strictEqual(check(5000, -4999.99), false);
  assert.strictEqual(check('5000.00', -5000), false);
  assert.strictEqual(check(5000, -5000.01), true);
  assert.strictEqual(check('5000', '-7500'), true);

  // A bet that lowers exposure (hedge / cashout) is never rejected, even above the limit
  assert.strictEqual(check(5000, -9000, false), false);

  // Net profit position has no liability
  assert.strictEqual(check(100, 250), false);
});
