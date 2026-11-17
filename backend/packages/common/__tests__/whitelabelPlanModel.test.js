'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { cleanPlan, policiesOf, allowsModel } = (() => {
  const plan = require('../src/whitelabelPlan');
  const { ALLOWS } = require('../src/sitePolicy');
  return { ...plan, allowsModel: (model, channel) => ALLOWS.business_model[channel].includes(model) };
})();

const base = {
  products: { casino: true, sports: true, originals: false },
  features: { branch_management: true, bonus: true, affiliate: true, vip: true, promotions: true },
  payments: { manual: true, gateways: { ccpayment: true, f2pay: false, upi: false } },
};

test('a plan from before the business model reads as hybrid and keeps everything', () => {
  const p = cleanPlan(base);
  assert.equal(p.model, 'hybrid');
  assert.equal(p.features.bonus, true);
  assert.deepEqual(policiesOf(p), { business_model: 'hybrid', branch_management: 'on', whitelabel: 'off', deposit_mode: 'both', withdrawal_mode: 'both' });
});

test('B2C: direct players and the cashier, no agent accounts', () => {
  const p = cleanPlan({ ...base, model: 'b2c' });
  assert.equal(policiesOf(p).business_model, 'b2c');
  assert.equal(policiesOf(p).deposit_mode, 'both');
  assert.equal(allowsModel('b2c', 'public_signup'), true);
  assert.equal(allowsModel('b2c', 'agent_accounts'), false);
});

test('B2B: promotions and the player cashier are forced off, agents allowed, no public sign-up', () => {
  const p = cleanPlan({ ...base, model: 'b2b' });
  assert.deepEqual(p.features, { branch_management: true, bonus: false, affiliate: false, vip: false, promotions: false });
  assert.deepEqual(p.payments, { manual: false, gateways: { ccpayment: false, f2pay: false, upi: false } });
  const pol = policiesOf(p);
  assert.equal(pol.business_model, 'b2b');
  assert.equal(pol.deposit_mode, 'none');
  assert.equal(pol.withdrawal_mode, 'none');
  assert.equal(allowsModel('b2b', 'public_signup'), false);
  assert.equal(allowsModel('b2b', 'agent_accounts'), true);
});

test('an unknown model reads as hybrid', () => {
  assert.equal(cleanPlan({ ...base, model: 'b2x' }).model, 'hybrid');
});
