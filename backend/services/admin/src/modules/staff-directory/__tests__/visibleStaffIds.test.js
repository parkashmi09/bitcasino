'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { visibleStaffIds } = require('../staffDirectory.service');

/**
 * In-memory `Staff` / `Roles` models — `visibleStaffIds` only reads
 * `Staff.findAll({ where: { parent_id } })`, `Staff.findByPk` and `Roles.findByPk`.
 *
 *   root(SA) ── admin ── execA (executive under the admin)
 *                    └── sm ── master ── agent ── execG (executive under the agent)
 *   other(SA root, no parent)
 */
const LEVEL = { 1: 1, 2: 2, 4: 4, 5: 5, 6: 6, 7: 7 };
const STAFF = [
  { id: 1, parent_id: null, role_id: 1 },
  { id: 2, parent_id: 1, role_id: 2 },
  { id: 3, parent_id: 2, role_id: 7 },
  { id: 4, parent_id: 2, role_id: 4 },
  { id: 5, parent_id: 4, role_id: 5 },
  { id: 6, parent_id: 5, role_id: 6 },
  { id: 7, parent_id: 6, role_id: 7 },
  { id: 8, parent_id: null, role_id: 1 },
];

const models = {
  Staff: {
    async findAll({ where }) {
      const want = [].concat(where.parent_id);
      return STAFF.filter((s) => want.includes(s.parent_id)).map(({ id }) => ({ id }));
    },
    async findByPk(id) {
      return STAFF.find((s) => s.id === Number(id)) ?? null;
    },
  },
  Roles: {
    async findByPk(id) {
      return LEVEL[id] ? { level: LEVEL[id] } : null;
    },
  },
};

const sorted = async (id) => (await visibleStaffIds(models, id)).map(Number).sort((a, b) => a - b);

test('visibleStaffIds', async (t) => {
  await t.test('an agent sees only itself and what is under it', async () => {
    assert.deepEqual(await sorted(6), [6, 7]);
  });

  await t.test('only the Super Admin sees every root tree', async () => {
    assert.deepEqual(await sorted(1), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(await sorted(8), [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  await t.test('an admin sees its OWN subtree only — not the root, not another tree', async () => {
    assert.deepEqual(await sorted(2), [2, 3, 4, 5, 6, 7]);
  });

  await t.test('a sub admin sees its own subtree only', async () => {
    STAFF.push({ id: 9, parent_id: 2, role_id: 3 }, { id: 10, parent_id: 9, role_id: 4 });
    LEVEL[3] = 3;
    try {
      assert.deepEqual(await sorted(9), [9, 10]);
    } finally {
      STAFF.splice(STAFF.findIndex((s) => s.id === 9), 2);
    }
  });

  await t.test('an executive under an admin sees what the admin sees, not an empty tree', async () => {
    assert.deepEqual(await sorted(3), [2, 3, 4, 5, 6, 7]);
  });

  await t.test("an executive under an agent sees that agent's tree only", async () => {
    assert.deepEqual(await sorted(7), [6, 7]);
  });

  await t.test('an unknown staff id reaches no other tree; a bad id reaches nothing', async () => {
    assert.deepEqual(await sorted(999), [999]);
    assert.deepEqual(await visibleStaffIds(models, 0), []);
  });
});
