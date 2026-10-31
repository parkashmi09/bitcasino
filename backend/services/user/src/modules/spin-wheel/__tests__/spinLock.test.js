'use strict';

const test = require('node:test');
const assert = require('node:assert');

// spinWheel.service destructures this at require time; the real one reads the DB.
require('@ibitplay/auth').assertPlayerCapability = async () => {};
const { SpinWheelService } = require('../spinWheel.service');

/**
 * Concurrent FIRST spins lock no claim row (there is none), so each passed the
 * one-spin rule and left its own ACTIVE code. The spin must take the per-player
 * advisory lock before it reads the claim history. Mocked models, no DB.
 */
test('spin takes the per-player advisory lock before reading the claim history', async () => {
  const log = [];
  const models = {
    SpinWheelSlices: { findAll: async () => [{ id: 1, label: '10%', reward_pct: '10', weight: 1 }] },
    SpinWheelClaims: {
      findOne: async () => (log.push('read-last'), null),
      create: async () => (log.push('claim'), { id: 1 }),
    },
    Redeembonus: { update: async () => log.push('expire'), create: async () => log.push('code') },
  };
  const db = {
    transaction: (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }),
    sequelize: { query: async (sql, { replacements }) => sql.includes('pg_advisory_xact_lock') && log.push(`lock:${replacements.key}`) },
  };
  const service = new SpinWheelService({
    models,
    db,
    logger: null,
    config: {},
    rewardMoney: {},
    spinWheelOptions: async () => ({ grant_on_registration: true }),
  });
  service.getConfig = async () => ({ isActive: true, claimCooldownDays: 7, minDeposit: '0' });

  await service.spin({ userId: 5 });

  assert.deepStrictEqual(log, ['lock:spin:5', 'read-last', 'expire', 'code', 'claim']);
});
