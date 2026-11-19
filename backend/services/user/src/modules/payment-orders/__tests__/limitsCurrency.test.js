'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createLogger } = require('@ibitplay/common');

const { PaymentOrdersService } = require('../paymentOrders.service');

/**
 * M13: DEPOSIT_/WITHDRAW_ MINIMUM/MAXIMUM are INR figures. A deposit in another currency is held
 * to their worth in that currency at the site's rates, not to the same number of units.
 * No DB: rates and settings are stubbed; the limit refuses before any gateway call.
 */
const make = (rateRows, calls) => {
  const rates = Object.fromEntries(rateRows.map(([c, usd]) => [c, { currency: c, usd_rate: usd }]));
  const models = {
    SiteFeature: { findByPk: async () => null },
    Exchangerate: {
      findOne: async ({ where }) => {
        // where(fn('UPPER', col('currency')), 'PHP'): the code is the logic's right-hand side.
        const code = String(where.logic ?? where.comparator ?? '').toUpperCase();
        return rates[code] ?? null;
      },
    },
  };
  const http = { post: async (url) => { calls.push(url); return { code: 1 }; }, get: async () => ({}), form: async () => ({}) };
  const service = new PaymentOrdersService({
    config: { DEPOSIT_MINIMUM: '100', DEPOSIT_MAXIMUM: '1000', WAYPAY_MERCHANT_KEY: 'k', WAYPAY_BASE_URL: 'https://waypay.test' },
    http,
    models,
    db: { sequelize: {} },
    logger: createLogger({ name: 'limits-test', level: 'silent' }),
  });
  service.settings = { value: (_k, f) => f, read: async (_k, f) => f };
  return service;
};

test('payment limits are INR figures, converted for another currency', async (t) => {
  // 1 INR = 0.012 USD, 1 PHP = 0.018 USD → 1000 INR = 666.67 PHP, 100 INR = 66.67 PHP.
  const RATES = [['INR', '0.012'], ['PHP', '0.018']];

  await t.test('above the converted maximum is refused, in PHP', async () => {
    const calls = [];
    await assert.rejects(
      () => make(RATES, calls).createDeposit({ userId: 1, provider: 'waypay', currency: 'PHP', amount: '700' }),
      (e) => e.code === 'PAYORDER_ABOVE_MAXIMUM' && e.details?.maximum === '666.66666666' && e.details?.currency === 'PHP'
    );
    assert.equal(calls.length, 0);
  });

  await t.test('below the converted minimum is refused', async () => {
    await assert.rejects(
      () => make(RATES, []).createDeposit({ userId: 1, provider: 'waypay', currency: 'PHP', amount: '50' }),
      (e) => e.code === 'PAYORDER_BELOW_MINIMUM' && e.details?.minimum === '66.66666666'
    );
  });

  await t.test('INR is unchanged', async () => {
    await assert.rejects(
      () => make(RATES, []).createDeposit({ userId: 1, provider: 'waypay', currency: 'INR', amount: '1001' }),
      (e) => e.code === 'PAYORDER_ABOVE_MAXIMUM' && e.details?.maximum === '1000'
    );
  });

  await t.test('no rate row: the raw figure applies, as before', async () => {
    await assert.rejects(
      () => make([['INR', '0.012']], []).createDeposit({ userId: 1, provider: 'waypay', currency: 'PHP', amount: '1001' }),
      (e) => e.code === 'PAYORDER_ABOVE_MAXIMUM' && e.details?.maximum === '1000'
    );
  });
});
