'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { mayOpenJsGame } = require('../gameLauncher');

const tile = { aggregator: 'js_games', provider: 'pragmatic' };

test('JSGames policy: every live lobby row may open', () => {
  assert.equal(mayOpenJsGame({ row: tile, provider: 'pragmatic', isBook: false, aggregator: 'js_games' }), true);
});

test('Slotegrator policy: only the always-live studios may open through JSGames', () => {
  assert.equal(mayOpenJsGame({ row: tile, provider: 'pragmatic', isBook: false, aggregator: 'slotegrator' }), false);
  assert.equal(mayOpenJsGame({ row: tile, provider: 'evolution', isBook: false, aggregator: 'slotegrator' }), true);
});

test('a uid outside the lobby opens only when it is a configured book', () => {
  assert.equal(mayOpenJsGame({ row: null, provider: '', isBook: true, aggregator: null }), true);
  assert.equal(mayOpenJsGame({ row: null, provider: '', isBook: false, aggregator: null }), false);
});
