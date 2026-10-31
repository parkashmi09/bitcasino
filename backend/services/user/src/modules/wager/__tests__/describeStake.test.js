'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { describeStake } = require('../wagerActivity.service');

test('a stake is described by category, provider, odds and house edge (migration 132)', () => {
  assert.deepEqual(describeStake({ source: 'inhouse' }), {
    category: 'originals', provider: null, game_ref: null, odds: null, house_edge: '0.01',
  });
  assert.deepEqual(describeStake({ source: 'sports', odds: '1.85' }), {
    category: 'sports', provider: null, game_ref: null, odds: '1.85', house_edge: '0.02',
  });
  assert.equal(describeStake({ source: 'gis', category: 'live', provider: 'Evolution' }).house_edge, '0.02');
  assert.equal(describeStake({ source: 'gis' }).category, 'slots');
  assert.equal(describeStake({ source: 'gis', houseEdge: '0.035' }).house_edge, '0.035');
});
