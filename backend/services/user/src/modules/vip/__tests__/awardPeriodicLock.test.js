'use strict';

const test = require('node:test');
const assert = require('node:assert');

// vip.service destructures this at require time; the real one reads the DB.
require('@ibitplay/auth').promotionsBlocked = async () => false;
const { VipService } = require('../vip.service');

/**
 * Two overlapping reads must not both write a period's award: each award
 * transaction takes the per-(player, type) advisory lock BEFORE its re-check,
 * since FOR UPDATE on a row that does not exist yet locks nothing. Mocked models.
 */
test('awardPeriodic takes the advisory lock before the existence re-check, in both modes', async () => {
  for (const mode of ['hash', 'legacy']) {
    const log = [];
    const sequelize = {
      transaction: (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }),
      query: async (sql, { replacements }) => {
        if (sql.includes('pg_advisory_xact_lock')) log.push(`lock:${replacements.key}`);
        return [{ edge: '100', loss: '0' }];
      },
    };
    const BonusClaim = {
      sequelize,
      findOne: async ({ transaction }) => {
        if (transaction) log.push('recheck');
        return null;
      },
      create: async ({ bonus_type: type }) => log.push(`create:${type}`),
    };
    const vip = new VipService({
      models: { BonusClaim },
      db: {},
      logger: null,
      rewardMoney: {},
      rewardFormula: async () => ({ mode }),
    });
    vip.standing = async () => ({ card: 'diamond', level: 30 });

    await vip.awardPeriodic({ userId: 42 });

    const created = log.filter((e) => e.startsWith('create:'));
    assert.ok(created.length > 0, `${mode}: expected at least one award`);
    for (const c of created) {
      const type = c.slice('create:'.length);
      const lockAt = log.indexOf(`lock:vip-award:42:${type}`);
      assert.ok(lockAt >= 0 && log[lockAt + 1] === 'recheck', `${mode}/${type}: lock then re-check, got ${log}`);
    }
  }
});
