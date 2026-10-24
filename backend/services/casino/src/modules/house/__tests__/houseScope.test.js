'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { HouseService } = require('../house.service');

/**
 * GET admin/casino/house lists in-house counters. It used to list EVERY
 * player's row to any `reports:read` caller — the whole agent tree holds that
 * grant — so an AGENT could read players in other trees. House staff (1–3)
 * keep all; the agent tree (4–6, and executives under it) sees its own tree.
 */

const HOUSE = [
  { id: 1, uid: '10', max: '50', current: '1' },
  { id: 2, uid: '20', max: '50', current: '2' },
  { id: 3, uid: '30', max: '50', current: '3' },
];
const USERS = [
  { id: '10', name: 'mine-a', parent_staff_id: 6 },
  { id: '20', name: 'mine-b', parent_staff_id: 7 },
  { id: '30', name: 'other', parent_staff_id: 99 },
];

function build({ descendants = [6, 7] } = {}) {
  const calls = { admin: [], houseWhere: [] };
  const inList = (value, list) => (Array.isArray(list) ? list.map(String).includes(String(value)) : String(list) === String(value));
  const models = {
    House: {
      async findAndCountAll({ where }) {
        calls.houseWhere.push(where);
        const rows = where ? HOUSE.filter((r) => inList(r.uid, where.uid)) : HOUSE;
        return { rows, count: rows.length };
      },
    },
    Users: {
      async findAll({ where }) {
        if (where.parent_staff_id) return USERS.filter((u) => inList(u.parent_staff_id, where.parent_staff_id));
        return USERS.filter((u) => inList(u.id, where.id));
      },
    },
  };
  const clients = {
    admin: {
      async get(path) {
        calls.admin.push(path);
        return { ids: descendants };
      },
    },
  };
  return { service: new HouseService({ models, clients, logger: null }), calls };
}

test('house staff (levels 1-3) see every row without a tree lookup', async () => {
  for (const level of [1, 2, 3]) {
    const { service, calls } = build();
    const out = await service.list({ limit: 100, offset: 0, staff: { id: 1, level } });
    assert.equal(out.total, 3, `level ${level}`);
    assert.equal(calls.admin.length, 0);
  }
});

test('agent tree (levels 4-6) sees only its own players', async () => {
  for (const level of [4, 5, 6]) {
    const { service, calls } = build();
    const out = await service.list({ limit: 100, offset: 0, staff: { id: 6, level } });
    assert.equal(out.total, 2, `level ${level}`);
    assert.deepEqual(out.rows.map((r) => r.userId).sort(), ['10', '20']);
    assert.ok(!out.rows.some((r) => r.name === 'other'));
    assert.deepEqual(calls.admin, ['/internal/admin/staff-directory/staff/6/descendants']);
  }
});

test('an executive under an agent is scoped too', async () => {
  const { service } = build({ descendants: [6] });
  const out = await service.list({ limit: 100, offset: 0, staff: { id: 6, level: 7, parentLevel: 6 } });
  assert.deepEqual(out.rows.map((r) => r.userId), ['10']);
});

test('an agent with no players gets an empty page, never everyone', async () => {
  const { service, calls } = build({ descendants: [] });
  const out = await service.list({ limit: 100, offset: 0, staff: { id: 6, level: 6 } });
  assert.deepEqual(out, { total: 0, rows: [] });
  assert.equal(calls.houseWhere.length, 0);
});

test('a failed tree lookup throws rather than listing everyone', async () => {
  const { service } = build();
  service.clients = { admin: { get: async () => { throw new Error('admin down'); } } };
  await assert.rejects(service.list({ limit: 100, offset: 0, staff: { id: 6, level: 6 } }), /admin down/);
});
