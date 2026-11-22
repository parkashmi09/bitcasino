'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { upheldAbove } = require('../lockSources');

/**
 * A lock is lifted only by the level that set it, or one above. The direct lock records the
 * setter's level in `lock_sources[col].level`; a cascade names the agent whose subtree lock holds it.
 * Levels: 2 Admin, 4 Super Master, 6 Agent (smaller = higher).
 */
const lockedBy = (level, by = []) => ({ casino_locked: true, lock_sources: { casino_locked: { own: true, by, level } } });

test('an agent cannot lift a lock an Admin set directly; the Admin and the Super Admin can', () => {
  const row = lockedBy(2);
  assert.deepEqual(upheldAbove(row, { casino_locked: false }, 6, [6]).blocked, ['casino_locked']);
  assert.deepEqual(upheldAbove(row, { casino_locked: false }, 2, [2, 6]).blocked, []);
  assert.deepEqual(upheldAbove(row, { casino_locked: false }, 1, [1, 2, 6]).blocked, []);
});

test('the agent lifts its own lock', () => {
  assert.deepEqual(upheldAbove(lockedBy(6), { casino_locked: false }, 6, [6]).blocked, []);
});

test('re-locking keeps the higher setter, so a lower agent cannot take the lock over', () => {
  assert.deepEqual(upheldAbove(lockedBy(2), { casino_locked: true }, 6, [6]).levels, { casino_locked: 2 });
  assert.deepEqual(upheldAbove({ casino_locked: false }, { casino_locked: true }, 6, [6]).levels, { casino_locked: 6 });
});

test("a cascade from an upline agent (outside the caller's tree, or the caller's own account) blocks the unlock", () => {
  const row = { casino_locked: true, lock_sources: { casino_locked: { own: false, by: ['40'] } } };
  assert.deepEqual(upheldAbove(row, { casino_locked: false }, 6, [6, 7]).blocked, ['casino_locked']);
  assert.deepEqual(upheldAbove({ ...row, lock_sources: { casino_locked: { own: false, by: ['suspend:40'] } } }, { casino_locked: false }, 6, [6]).blocked, ['casino_locked']);
  assert.deepEqual(upheldAbove(row, { casino_locked: false }, 4, [4, 40]).blocked, []);
});

test('a lock from before levels were recorded is not blocked; an unlocked column is not blocked', () => {
  assert.deepEqual(upheldAbove({ casino_locked: true, lock_sources: null }, { casino_locked: false }, 6, [6]).blocked, []);
  assert.deepEqual(upheldAbove({ casino_locked: false, lock_sources: { casino_locked: { own: true, level: 1 } } }, { casino_locked: false }, 6, [6]).blocked, []);
});
