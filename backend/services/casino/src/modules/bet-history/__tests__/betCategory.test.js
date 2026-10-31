'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { categoryOf, BET_CATEGORIES } = require('../betHistory.constants');
const v = require('../betHistory.validators');

/**
 * The player's Bet History "Type" filter (`?category=`) and its coin filter (`?currency=`).
 * Pure: no database.
 */

test('an in-house round is original, from either table', () => {
  assert.equal(categoryOf({ sourceKey: 'inhouse' }), 'original');
  assert.equal(categoryOf({ sourceKey: 'jsgames', vendor: 'in-house', type: 'limbo' }), 'original');
  assert.equal(categoryOf({ sourceKey: 'jsgames', vendor: ' In-House ', type: 'crash' }), 'original');
});

test('live is the lobby rule: a live provider, a live type, or a type naming live', () => {
  // Slotegrator types a live blackjack table `blackjack`, like an RNG one: the provider decides.
  assert.equal(categoryOf({ sourceKey: 'gis', vendor: 'Evolution Gaming', type: 'blackjack' }), 'live');
  assert.equal(categoryOf({ sourceKey: 'gis', vendor: 'Some Studio', type: 'live dealer' }), 'live');
  assert.equal(categoryOf({ sourceKey: 'gis', vendor: 'Some Studio', type: 'Game Shows' }), 'live');
  assert.equal(categoryOf({ sourceKey: 'jsgamesv2', type: 'Live Casino' }), 'live');
});

test('every other third-party game is slots, including an unknown one', () => {
  assert.equal(categoryOf({ sourceKey: 'gis', vendor: 'BGaming', type: 'slots' }), 'slots');
  assert.equal(categoryOf({ sourceKey: 'gis', vendor: 'BGaming', type: 'blackjack' }), 'slots');
  assert.equal(categoryOf({ sourceKey: 'jsgamesv2', type: 'Slot' }), 'slots');
  assert.equal(categoryOf({ sourceKey: 'gis' }), 'slots');
  // "deliver" contains "live" but is not the word.
  assert.equal(categoryOf({ sourceKey: 'gis', type: 'delivery' }), 'slots');
});

test('the player route takes category and currency, and nothing else new', () => {
  const ok = v.myHistory.query.parse({ category: 'live', currency: 'usdt' });
  assert.equal(ok.category, 'live');
  assert.equal(ok.currency, 'USDT');
  assert.deepEqual([...BET_CATEGORIES], ['original', 'live', 'slots']);

  assert.throws(() => v.myHistory.query.parse({ category: 'lottery' }));
  assert.throws(() => v.myHistory.query.parse({ currency: "INR' OR 1=1" }));
  assert.throws(() => v.myHistory.query.parse({ type: '4' })); // still strict
});
