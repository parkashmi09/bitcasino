'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { manageableStaffIds, visibleStaffIds } = require('../staffDirectory.service');

/**
 * A level-1 Super Admin sees and manages EVERY staff tree on the site.
 *
 * The bootstrap Super Admin and a seeded `demo_superadmin` are both roots
 * (`parent_id` NULL). Staff scope walked down from the caller's own row, so the
 * bootstrap account listed none of the demo staff. Every lower level keeps its
 * own subtree.
 *
 *   boot(SA, root) ── admin ── subAdmin ── agent
 *   demo(SA, root) ── demoAdmin ── demoAgent
 */
const ROLE_LEVEL = { 1: 1, 2: 2, 3: 3, 6: 6 };
const STAFF = [
  { id: 1, parent_id: null, role_id: 1 },
  { id: 2, parent_id: 1, role_id: 2 },
  { id: 3, parent_id: 2, role_id: 3 },
  { id: 4, parent_id: 3, role_id: 6 },
  { id: 8, parent_id: null, role_id: 1 },
  { id: 9, parent_id: 8, role_id: 2 },
  { id: 10, parent_id: 9, role_id: 6 },
];
const ALL = STAFF.map((s) => s.id).sort((a, b) => a - b);

const models = {
  Staff: {
    async findAll({ where }) {
      const want = [].concat(where.parent_id);
      return STAFF.filter((s) => want.includes(s.parent_id)).map(({ id }) => ({ id }));
    },
    async findByPk(id) {
      return STAFF.find((s) => s.id === Number(id)) ?? null;
    },
    async findAndCountAll({ where }) {
      const ids = [].concat(where.id).map(Number);
      const rows = STAFF.filter((s) => ids.includes(s.id)).map((s) => ({ ...s, name: `s${s.id}`, status: 'active' }));
      return { count: rows.length, rows };
    },
  },
  Roles: {
    async findByPk(id) {
      return ROLE_LEVEL[id] ? { level: ROLE_LEVEL[id] } : null;
    },
  },
};

const sorted = async (fn, id, opts) => (await fn(models, id, opts)).map(Number).sort((a, b) => a - b);

test('manageableStaffIds', async (t) => {
  await t.test('a Super Admin manages every staff tree, not just the one under its own row', async () => {
    assert.deepEqual(await sorted(manageableStaffIds, 1), ALL);
    assert.deepEqual(await sorted(manageableStaffIds, 8), ALL);
  });

  await t.test("a Super Admin's player scope is site-wide too", async () => {
    assert.deepEqual(await sorted(visibleStaffIds, 1), ALL);
  });

  await t.test('Admin, Sub Admin and agent keep their own subtree for staff', async () => {
    assert.deepEqual(await sorted(manageableStaffIds, 2), [2, 3, 4]);
    assert.deepEqual(await sorted(manageableStaffIds, 3), [3, 4]);
    assert.deepEqual(await sorted(manageableStaffIds, 4), [4]);
    assert.deepEqual(await sorted(manageableStaffIds, 9), [9, 10]);
  });

  await t.test('the session level, when given, decides; a bad id reaches nothing', async () => {
    assert.deepEqual(await sorted(manageableStaffIds, 2, { level: 2 }), [2, 3, 4]);
    assert.deepEqual(await sorted(manageableStaffIds, 1, { level: 1 }), ALL);
    assert.deepEqual(await manageableStaffIds(models, 0), []);
  });

});
