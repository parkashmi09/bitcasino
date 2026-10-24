'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { marketLabel, marketName, rateText } = require('../betLabels');

test('market: "NULL" fancy name falls through to a readable market label', () => {
  assert.strictEqual(marketName({ fancy_name: 'NULL', market_type: 'MATCH_ODDS' }), 'Match Odds');
  assert.strictEqual(marketName({ fancy_name: 'NULL', market_type: 'Bookmaker' }), 'Bookmaker');
  assert.strictEqual(marketName({ fancy_name: '10 over run AFG adv', market_type: 'Normal' }), '10 over run AFG adv');
  assert.strictEqual(marketName({ fancy_name: null, market_type: null, game_type: 'FAN' }), 'Fancy');
  assert.strictEqual(marketName({ fancy_name: 'NULL' }), null);
  assert.strictEqual(marketLabel('OVER_UNDER_15'), 'Over/Under 1.5');
  assert.strictEqual(marketLabel('oddeven'), 'Odd / Even');
  assert.strictEqual(marketLabel('fancy1'), 'Fancy 1');
});

test('rate: each market in its own scale', () => {
  assert.strictEqual(rateText({ market_type: 'Bookmaker', odds: '40.0000' }), '1.40');
  assert.strictEqual(rateText({ market_type: 'Bookmaker', odds: '12.0000' }), '1.12');
  assert.strictEqual(rateText({ market_type: 'Normal', odds: '55.0000', size: '100' }), '55 @ 100');
  assert.strictEqual(rateText({ market_type: 'Normal', odds: '55.0000' }), '55');
  assert.strictEqual(rateText({ market_type: 'MATCH_ODDS', odds: '1.5300' }), '1.53');
  assert.strictEqual(rateText({ market_type: 'oddeven', odds: '1.95', size: '1000000' }), '1.95');
  assert.strictEqual(rateText({ market_type: 'MATCH_ODDS', odds: null }), null);
});
