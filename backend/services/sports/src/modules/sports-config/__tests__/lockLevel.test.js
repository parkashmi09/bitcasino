'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { BetAdminService } = require('../../bet-admin/betAdmin.service');

/**
 * A sports lock is lifted only by the level that set it, or one above. Levels: 1 Super Admin,
 * 2 Admin, 6 Agent (smaller = higher). A lock from before migration 192 has no level and is not blocked.
 */
test('market / sport lock rows: an agent cannot lift an Admin lock; the Admin and above can', async () => {
  const { heldAbove, levelToRecord, actorLevel } = await import('../../../lib/helper/lockLevel.mjs');
  const adminLock = { is_locked: true, locked_level: 2 };
  assert.equal(heldAbove(adminLock, 6), true);
  assert.equal(heldAbove(adminLock, null), true); // unknown caller level fails closed
  assert.equal(heldAbove(adminLock, 2), false);
  assert.equal(heldAbove(adminLock, 1), false);
  assert.equal(heldAbove({ is_locked: true, locked_level: null }, 6), false); // pre-192 row
  assert.equal(heldAbove({ is_locked: false, locked_level: 1 }, 6), false);

  // re-locking keeps the higher setter, so a lower agent cannot take the lock over
  assert.equal(levelToRecord(adminLock, 6), 2);
  assert.equal(levelToRecord({ is_locked: true, locked_level: 6 }, 2), 2);
  assert.equal(levelToRecord(null, 6), 6);

  // an executive row acts with its parent's level
  assert.equal(actorLevel({ staff: { level: 7, parentLevel: 2 } }), 2);
  assert.equal(actorLevel({}), null);
});

// Caller tree from admin-service; one player row whose bet lock carries `lock_sources`.
function service(row, level) {
  const writes = [];
  const svc = new BetAdminService({
    models: {
      Users: {
        findAll: async () => [{ id: 100 }],
        findOne: async () => row,
        update: async (values) => { writes.push(values); return [1]; },
      },
    },
    db: { transaction: (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }) },
    clients: { admin: { get: async () => ({ ids: [10, 11] }) } },
  });
  return { writes, call: (locked) => svc.setUserLock({ staff: { id: 10, level }, userId: 100, locked }) };
}

test('player bet lock: an agent cannot lift a bet lock its Admin set; the Admin can', async () => {
  const adminLocked = { sports_betlocked: true, lock_sources: { sports_betlocked: { own: true, by: [], level: 2 } } };

  const agent = service(adminLocked, 6);
  await assert.rejects(agent.call(false), { code: 'BET_ADMIN_LOCKED_BY_UPLINE' });
  assert.equal(agent.writes.length, 0);

  const admin = service(adminLocked, 2);
  await admin.call(false);
  assert.equal(admin.writes[0].sports_betlocked, false);

  // a bet lock from before levels were recorded is lifted as before
  const legacy = service({ sports_betlocked: true, lock_sources: {} }, 6);
  await legacy.call(false);
  assert.equal(legacy.writes.length, 1);
});
