'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createLogger } = require('@ibitplay/common');

const { PaymentOrdersService } = require('../paymentOrders.service');
const v = require('../paymentOrders.validators');

/**
 * Settings → Payment Methods: A-Pay ke payment systems ka overview (sirf padhna).
 * DB nahi chahiye — gateway ka http nakli hai.
 */

const APAY = { APAY_API_KEY: 'apay-key', APAY_PROJECT_ID: '1234', APAY_BASE_URL: 'https://apay.test' };

const SYSTEMS = [
  { name: 'phonepe', currency: 'INR', deposit: true, withdrawal: false, min_deposit: '100', max_deposit: '50000' },
  { name: 'imps', currency: 'INR', deposit: true, withdrawal: true, min_withdrawals: 500, max_withdrawals: 200000 },
  { name: 'bkash_api_v', currency: 'BDT', deposit: false, withdrawal: true },
  { name: 'usdt_x', currency: 'USDT', deposit: true, withdrawal: false }
];

const make = (config, calls) => {
  const http = {
    get: async (url, opts) => {
      calls.push({ url, opts });
      return { success: true, payment_systems: SYSTEMS };
    }
  };
  return new PaymentOrdersService({ config, http, models: {}, db: { sequelize: {} }, logger: createLogger({ name: 'ps-test', level: 'silent' }) });
};

test('payment systems overview', async (t) => {
  await t.test('without A-Pay config it says not configured and calls nothing', async () => {
    const calls = [];
    const out = await make({}, calls).paymentSystemsOverview();
    assert.equal(out.configured, false);
    assert.deepEqual(out.currencies, []);
    assert.equal(calls.length, 0);
  });

  await t.test('groups by currency in business order and marks what the site uses', async () => {
    const calls = [];
    const out = await make(APAY, calls).paymentSystemsOverview({ fresh: true });
    assert.equal(out.configured, true);
    assert.equal(out.projectId, '1234');
    assert.match(calls[0].url, /\/Remotes\/payment-systems-info\?project_id=1234$/);
    assert.equal(calls[0].opts.headers.apikey, 'apay-key');

    assert.deepEqual(out.currencies.map((c) => c.currency), ['INR', 'PKR', 'NPR', 'BDT', 'USDT']);
    const inr = out.currencies[0].methods;
    const phonepe = inr.find((m) => m.name === 'phonepe');
    assert.equal(phonepe.label, 'PhonePe');
    assert.deepEqual(phonepe.deposit, { gatewayEnabled: true, siteOffered: true, min: 100, max: 50000 });
    const imps = inr.find((m) => m.name === 'imps');
    assert.equal(imps.deposit.siteOffered, false); // site INR deposit = phonepe
    assert.equal(imps.withdrawal.siteUsed, true);
    assert.equal(imps.withdrawal.max, 200000);

    // BDT: site deposit rail is bKash but the gateway has deposits off → note.
    const bkash = out.currencies[3].methods[0];
    assert.equal(bkash.deposit.siteOffered, false);
    assert.ok(bkash.notes.some((n) => n.includes('deposits')));
  });

  await t.test('second call within 5 minutes uses the cache; fresh skips it', async () => {
    const calls = [];
    const svc = make(APAY, calls);
    await svc.paymentSystemsOverview({ fresh: true });
    await svc.paymentSystemsOverview();
    assert.equal(calls.length, 1);
    await svc.paymentSystemsOverview({ fresh: true });
    assert.equal(calls.length, 2);
  });

  await t.test('query schema is strict', () => {
    assert.ok(v.paymentSystems.query.safeParse({ fresh: '1' }).success);
    assert.ok(!v.paymentSystems.query.safeParse({ fresh: '1', x: '2' }).success);
  });
});
