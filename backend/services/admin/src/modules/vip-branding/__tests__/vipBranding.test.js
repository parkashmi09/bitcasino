'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { VIP_LADDERS, rebrandVipLadder } = require('@ibitplay/common');
const { NAMES } = require('../../../../../../packages/db/migrations/120-vip-branding');
const v = require('../vipBranding.validators');

const platform = VIP_LADDERS.platform;

test('the seed names cover every platform level, reference names first', () => {
  // Seeded for the old 41-level ladder; migration 133 drops the rows past L33. Every level has one.
  assert.ok(NAMES.length >= platform.levels.length + 1);
  assert.deepStrictEqual(NAMES.slice(0, 3), ['Beginner', 'Bronze I', 'Bronze II']);
  assert.strictEqual(NAMES[33], 'Eternal X');
});

test('rebrand renames and badges without touching bands, cards or thresholds', () => {
  const ladder = rebrandVipLadder(platform, { names: new Map([[0, 'Beginner'], [2, 'Bronze II']]), badges: new Map([['bronze', 'abc']]) });
  assert.strictEqual(ladder.unranked.name, 'Beginner');
  const two = ladder.levels.find((b) => b.level === 2);
  assert.strictEqual(two.name, 'Bronze II');
  assert.strictEqual(two.card, platform.levels.find((b) => b.level === 2).card);
  assert.strictEqual(two.minXp, platform.levels.find((b) => b.level === 2).minXp);
  assert.match(two.badgeUrl, /\/badges\/bronze\/image\?v=abc$/);
  const standing = ladder.levelFor('3000');
  assert.strictEqual(standing.name, 'Bronze II');
  assert.ok(standing.badgeUrl);
  // A level with no override keeps its built-in name; no badges, no URL.
  assert.strictEqual(ladder.levels.find((b) => b.level === 3).name, platform.levels.find((b) => b.level === 3).name);
  assert.strictEqual(ladder.levels.find((b) => b.card === 'silver').badgeUrl, null);
});

test('no overrides returns the same ladder', () => {
  assert.strictEqual(rebrandVipLadder(platform, { names: new Map(), badges: new Map() }), platform);
});

test('validators: known cards only, names 1–40 chars', () => {
  assert.ok(v.CARDS.includes('bronze') && v.CARDS.includes('unranked'));
  assert.ok(!v.badge.params.safeParse({ card: '../x' }).success);
  assert.ok(!v.rename.body.safeParse({ name: '' }).success);
  assert.ok(!v.rename.body.safeParse({ name: 'x'.repeat(41) }).success);
  assert.ok(v.rename.body.safeParse({ name: 'Bronze II' }).success);
});
