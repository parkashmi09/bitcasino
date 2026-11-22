'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { switchedOffMoneyCoin } = require('../entitlements.store');

/**
 * An owner document may not switch off the coin the site's default currency or reward currency
 * is in (USDT by default): crypto wallets off with both left on USDT is refused (422).
 */
test('crypto master off while default/reward stay USDT (explicit or by default): refused', () => {
  assert.match(switchedOffMoneyCoin({ flags: { cryptocoin: false }, variants: null }), /USDT/);
  assert.match(switchedOffMoneyCoin({ flags: { cryptocoin: false }, variants: { default_currency: 'INR', reward_currency: 'USDT' } }), /reward_currency/);
  assert.match(switchedOffMoneyCoin({ flags: { usdt: false }, variants: { default_currency: 'USDT', reward_currency: 'INR' } }), /default_currency/);
});

test('crypto off with both on a fiat coin that is on, or everything on: accepted', () => {
  assert.equal(switchedOffMoneyCoin({ flags: { cryptocoin: false }, variants: { default_currency: 'INR', reward_currency: 'INR' } }), null);
  assert.equal(switchedOffMoneyCoin({ flags: {}, variants: null }), null);
  assert.match(switchedOffMoneyCoin({ flags: { cryptocoin: false, inr: false }, variants: { default_currency: 'INR', reward_currency: 'INR' } }), /INR/);
});
