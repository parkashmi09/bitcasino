'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { categoryFromType, resolveCategory } = require('../src/wagerCategory');

test('a live studio is live whatever the type says', () => {
  assert.equal(categoryFromType('roulette', 'Ezugi'), 'live');
  assert.equal(categoryFromType('poker', 'Betgames'), 'live');
  assert.equal(categoryFromType('other', 'ICONIC21'), 'live');
  assert.equal(categoryFromType('baccarat', 'SA Gaming'), 'live');
  assert.equal(categoryFromType('Live Casino', 'evolution'), 'live');
});

test('dealer and game-show types are live', () => {
  assert.equal(categoryFromType('teen patti', 'SA Gaming'), 'live');
  assert.equal(categoryFromType('live dealer', 'Some Studio'), 'live');
  assert.equal(categoryFromType('game_shows'), 'live');
});

test('an RNG studio table game is a 3rd-party slot; without a provider it stays live (old rule)', () => {
  assert.equal(categoryFromType('roulette', 'BGaming'), 'slots');
  assert.equal(categoryFromType('blackjack', 'Platipus2'), 'slots');
  assert.equal(categoryFromType('roulette'), 'live');
});

test('slots, crash and sports', () => {
  assert.equal(categoryFromType('slots', 'NetEnt'), 'slots');
  assert.equal(categoryFromType('crash', 'Spribe'), 'slots');
  assert.equal(categoryFromType('virtual sport', 'ExcellentReel'), 'sports');
  assert.equal(categoryFromType(null), null);
});

test('resolveCategory: explicit > source > type + provider > slots', () => {
  assert.equal(resolveCategory({ category: 'sports', type: 'slots' }), 'sports');
  assert.equal(resolveCategory({ source: 'inhouse', type: 'roulette' }), 'originals');
  assert.equal(resolveCategory({ source: 'gis', type: 'roulette', provider: 'Ezugi' }), 'live');
  assert.equal(resolveCategory({ source: 'gis', type: 'roulette', provider: 'BGaming' }), 'slots');
  assert.equal(resolveCategory({ source: 'gis' }), 'slots');
});
