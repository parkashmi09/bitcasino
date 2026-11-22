'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { StaffService } = require('../staff.service');

/**
 * A child's partnership percentage may not exceed its parent's (checked on create; there is no
 * update path for it). A parent with no percentage (null, or the column default 0 — the Super Admin) sets no cap. Stub models:
 * actor 10 is a Master (level 5) with 40%, creating an Agent (level 6).
 */
function service(parentPercentage) {
  const created = [];
  const models = {
    Roles: { findByPk: async () => ({ id: 6, level: 6 }) },
    Staff: {
      findByPk: async () => ({ id: 10, role_id: 5, percentage: parentPercentage }),
      findOne: async () => null,
      create: async (row) => { created.push(row); return { id: 99, ...row, get: () => ({ id: 99, ...row }) }; },
    },
  };
  const svc = new StaffService({ models, db: { transaction: (fn) => fn({}) }, logger: null, config: {} });
  return { svc, created };
}
const input = (percentage) => ({ actor: { id: 10, level: 5 }, name: 'a', email: 'a@x.io', password: 'longenough1', roleId: 6, percentage });

test('above the parent: 422 PERCENTAGE_ABOVE_PARENT, nothing created', async () => {
  const { svc, created } = service('40.000');
  await assert.rejects(svc.create(input('40.5')), (e) => /PERCENTAGE_ABOVE_PARENT/.test(e.code));
  assert.equal(created.length, 0);
});

test('equal to or below the parent, or a parent with none: passes the check', async () => {
  for (const [parent, child] of [['40', '40'], ['40', '12.5'], [null, '90'], ['0.00', '90']]) {
    const { svc, created } = service(parent);
    await svc.create(input(child)).catch(() => {}); // later steps of create may need more stubs
    assert.equal(created.length, 1, `${child} under ${parent}`);
  }
});
