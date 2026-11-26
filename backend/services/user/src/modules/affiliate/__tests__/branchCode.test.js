'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { resolveBranchByCode } = require('../referrerResolver');

/**
 * A branch's sign-up code (`branches.referral_code`, migration 181). No database: the one query
 * and the owner's policy row are stubbed.
 */
const modelsWith = ({ rows, policy = 'on' }) => {
  const asked = [];
  return {
    asked,
    Users: {
      sequelize: {
        query: async (sql, { replacements }) => {
          asked.push({ sql, replacements });
          return [rows];
        },
      },
    },
    SiteFeature: { findByPk: async () => ({ variant: policy }) },
  };
};

test('an active branch code resolves, whatever its case', async () => {
  const models = modelsWith({ rows: [{ id: '2' }] });
  assert.deepEqual(await resolveBranchByCode(models, '  abhishek4821 '), { id: 2 });
  assert.equal(models.asked[0].replacements.code, 'ABHISHEK4821');
  assert.match(models.asked[0].sql, /status = 'active'/);
});

test('an unknown code, an empty one, and a code while branches are switched off resolve to nothing', async () => {
  assert.equal(await resolveBranchByCode(modelsWith({ rows: [] }), 'NOPE1234'), null);
  const empty = modelsWith({ rows: [{ id: 1 }] });
  assert.equal(await resolveBranchByCode(empty, '   '), null);
  assert.equal(empty.asked.length, 0);
  assert.equal(await resolveBranchByCode(modelsWith({ rows: [{ id: 1 }], policy: 'off' }), 'ABHISHEK4821'), null);
});
