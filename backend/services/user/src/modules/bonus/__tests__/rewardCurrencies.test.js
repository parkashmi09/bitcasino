'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createRewardCurrencyResolver, DEFAULTS } = require('../rewardCurrencies');
const { BONUS_CURRENCY } = require('../bonus.constants');
const { RAKEBACK_CURRENCY } = require('../../rakeback/rakeback.constants');

test('rewardCurrencies', async (t) => {
  await t.test('one reward currency: bonus and rakeback follow rewardCurrency()', async () => {
    const resolver = createRewardCurrencyResolver({
      clients: {
        admin: {
          // The old per-feature siteconfig fields no longer choose a wallet.
          get: async () => ({ rewardCurrency: 'inr', bonusCurrency: 'EUR', rakebackCurrency: 'BTC' }),
        },
      },
    });

    assert.equal(await resolver.rewardCurrency(), 'INR');
    assert.equal(await resolver.bonusCurrency(), 'INR');
    assert.equal(await resolver.rakebackCurrency(), 'INR');
  });

  await t.test('no rewardCurrency configured reads as USDT, whatever bonus_currency says', async () => {
    const resolver = createRewardCurrencyResolver({
      clients: { admin: { get: async () => ({ bonusCurrency: 'INR', rakebackCurrency: 'INR' }) } },
    });
    assert.equal(await resolver.rewardCurrency(), 'USDT');
    assert.equal(await resolver.bonusCurrency(), 'USDT');
    assert.equal(await resolver.rakebackCurrency(), 'USDT');
  });

  await t.test('a retired coin from admin reads as the default — never BJB', async () => {
    // The wallet refuses to credit BJB, so honouring a stale setting would
    // fail every claim.
    const resolver = createRewardCurrencyResolver({
      clients: { admin: { get: async () => ({ rewardCurrency: 'BJB', bonusCurrency: 'BJB', rakebackCurrency: 'bjb' }) } },
    });
    assert.equal(await resolver.bonusCurrency(), BONUS_CURRENCY);
    assert.equal(await resolver.rakebackCurrency(), RAKEBACK_CURRENCY);
    assert.equal(BONUS_CURRENCY, 'USDT');
  });

  await t.test('falls back to constants when admin is unreachable', async () => {
    const resolver = createRewardCurrencyResolver({
      logger: { warn: () => {} },
      clients: {
        admin: {
          get: async () => {
            throw new Error('down');
          },
        },
      },
    });

    assert.equal(await resolver.bonusCurrency(), DEFAULTS.bonusCurrency);
    assert.equal(await resolver.rakebackCurrency(), DEFAULTS.rakebackCurrency);
    assert.equal(DEFAULTS.bonusCurrency, BONUS_CURRENCY);
    assert.equal(DEFAULTS.rakebackCurrency, RAKEBACK_CURRENCY);
  });

  await t.test('uses defaults when no admin client is wired', async () => {
    const resolver = createRewardCurrencyResolver({});
    assert.equal(await resolver.bonusCurrency(), BONUS_CURRENCY);
    assert.equal(await resolver.rakebackCurrency(), RAKEBACK_CURRENCY);
  });
});
