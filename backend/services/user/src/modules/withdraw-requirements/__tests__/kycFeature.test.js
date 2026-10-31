'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { entitlements } = require('@ibitplay/common');
const { createWithdrawRequirements } = require('../withdrawRequirements');

// Policy `kyc`, an unverified player: KYC is required only while the owner's KYC feature is in the plan.
function requirementsWith(features) {
  entitlements.configureEntitlements({ read: async () => ({ features, flags: {}, version: 1, source: 'owner' }) });
  return createWithdrawRequirements({
    models: { SiteFeature: { findByPk: async () => ({ variant: 'kyc' }) }, UserKyc: { findOne: async () => ({ status: 'Pending' }) } },
    db: { sequelize: { query: async () => [] } },
    config: { WITHDRAW_REQUIRE_KYC: true },
    logger: null,
    wagerService: { getTasks: async () => ({ tasks: [], multiplier: null }) },
    playerBonuses: { openWagering: async () => [] },
    rewardMoney: { toUsd: async (a) => a },
    capFigures: { figures: async () => ({ deposited: '0', withdrawn: '0', wagered: '0' }), currencies: async () => [] },
    dailyFigures: { used: async () => '0' },
  });
}

test.afterEach(() => entitlements.resetEntitlements());

test('KYC feature on + policy kyc: an unverified player is refused', async () => {
  const r = requirementsWith({ kyc: 'document_cockpit' });
  assert.equal((await r.rules()).kyc, true);
  await assert.rejects(r.assertMet(1, { amount: '100', currency: 'INR', kycError: () => new Error('KYC_REQUIRED') }), /KYC_REQUIRED/);
});

test('KYC feature switched off: the kyc policy no longer blocks withdrawals', async () => {
  const r = requirementsWith({ kyc: false });
  assert.equal((await r.rules()).kyc, false);
  await r.assertMet(1, { amount: '100', currency: 'INR', kycError: () => new Error('KYC_REQUIRED') });
});
