'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { KycLevelService } = require('../kycLevels.service');

/** The service over in-memory rows: the identity KYC status and the level rows. */
function service({ identity = 'Verified', levels = [] } = {}) {
  return new KycLevelService({
    models: {
      UserKyc: { findOne: async () => (identity ? { status: identity } : null) },
      UserKycLevel: { findAll: async () => levels },
    },
    logger: null,
    config: { KYC_STORAGE_DIR: 'unused' },
  });
}

test('level 3 opens only once the identity KYC is verified', async () => {
  assert.equal((await service({ identity: 'Pending' }).status(1)).levels[0].unlocked, false);
  assert.equal((await service({ identity: 'Verified' }).status(1)).levels[0].unlocked, true);
});

test('level 4 opens only once level 3 is verified', async () => {
  const pending = await service({ levels: [{ level: 3, status: 'Pending' }] }).status(1);
  assert.equal(pending.levels[1].unlocked, false);
  const verified = await service({ levels: [{ level: 3, status: 'Verified' }] }).status(1);
  assert.equal(verified.levels[1].unlocked, true);
});

test('a locked or pending level refuses a new document', async () => {
  const file = { size: 10, buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]) };
  await assert.rejects(service({ identity: 'Pending' }).submit(1, 3, file), (e) => e.code === 'KYC_LEVEL_LOCKED');
  await assert.rejects(service({ levels: [{ level: 3, status: 'Pending' }] }).submit(1, 3, file), (e) => e.code === 'KYC_LEVEL_ALREADY_PENDING');
});

test('a rejected level shows its reason', async () => {
  const s = await service({ levels: [{ level: 3, status: 'Rejected', rejection_reason: 'Blurry' }] }).status(1);
  assert.equal(s.levels[0].rejectionReason, 'Blurry');
});

test('with levels switched off (siteconfig.kyclevels) nothing past the identity KYC is offered', async () => {
  const off = new KycLevelService({
    models: { UserKyc: { findOne: async () => ({ status: 'Verified' }) }, UserKycLevel: { findAll: async () => [] } },
    db: { sequelize: { query: async () => [{ kyclevels: false }], QueryTypes: { SELECT: 'SELECT' } } },
    logger: null,
    config: { KYC_STORAGE_DIR: 'unused' },
  });
  const s = await off.status(1);
  assert.equal(s.levelsOn, false);
  assert.deepEqual(s.levels, []);
  await assert.rejects(off.submit(1, 3, { size: 10, buffer: Buffer.alloc(5) }), (e) => e.code === 'KYC_LEVEL_LEVELS_OFF');
});
