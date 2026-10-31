'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { evaluateMedals, longestDayStreak } = require('../medals.service');
const { MEDALS } = require('../medals.constants');

/**
 * The medal rules as pure functions of the facts: no database, no services.
 */

const NOW = Date.parse('2026-10-12T00:00:00Z');
const DAY = 86_400_000;

const base = (over = {}) => ({
  createdAt: new Date(NOW - 10 * DAY),
  wagerUsd: '0.00000000',
  topOtherWager: '0.00000000',
  vipLevel: 0,
  vipTopLevel: 41,
  chatDays: 0,
  tipRecipients: 0,
  raceStreak: 0,
  play: { bets: 0, casinoNetUsd: '0.00000000', maxMultiplier: null, partial: false, casinoDown: false },
  ...over,
});
const byKey = (results) => new Map(results.map((r) => [r.medal.key, r]));

test('medals: the catalogue is the UI\'s 23 keys, type 9 excluded', () => {
  assert.strictEqual(MEDALS.length, 23);
  const keys = MEDALS.map((m) => m.key);
  assert.ok(!keys.includes('9'));
  for (const k of ['1', '8', '15', '17_ETH', '17_BTC', '17_DOGE', '17_EOS', '18', '21']) assert.ok(keys.includes(k), k);
  assert.strictEqual(new Set(keys).size, 23);
  // Every medal either has a rule or says why it has none.
  for (const m of MEDALS) assert.ok(m.rule || m.unavailableReason, m.key);
});

test('medals: a fresh account meets nothing, and rule-less medals are unavailable', () => {
  const r = byKey(evaluateMedals(base(), NOW));
  for (const x of r.values()) assert.strictEqual(x.met, false, x.medal.key);
  assert.strictEqual(r.get('3').available, false);
  assert.strictEqual(r.get('17_BTC').available, false);
  assert.strictEqual(r.get('15').current, 10);
  assert.strictEqual(r.get('15').target, 365);
  assert.strictEqual(r.get('5').target, 41);
});

test('medals: thresholds are inclusive and measured on the right fact', () => {
  const r = byKey(evaluateMedals(base({
    createdAt: new Date(NOW - 400 * DAY),
    wagerUsd: '1000000.00000000',
    topOtherWager: '999999.99000000',
    vipLevel: 41,
    chatDays: 200,
    tipRecipients: 99,
    raceStreak: 3,
    play: { bets: 10_000_000, casinoNetUsd: '10000.00000000', maxMultiplier: '99000.00000000', partial: false, casinoDown: false },
  }), NOW));
  for (const key of ['1', '4', '5', '8', '12', '13', '14', '15', '16', '18']) assert.strictEqual(r.get(key).met, true, key);
  // Old-Timer's date is the anniversary, not "now".
  assert.strictEqual(r.get('15').achievedAt.toISOString(), new Date(NOW - 400 * DAY + 365 * DAY).toISOString());
  // A record medal has no progress.
  assert.strictEqual(r.get('4').current, null);
});

test('medals: one short of every line is locked', () => {
  const r = byKey(evaluateMedals(base({
    createdAt: new Date(NOW - 364 * DAY - 1000),
    wagerUsd: '999999.99999999',
    topOtherWager: '999999.99999999',
    vipLevel: 40,
    chatDays: 199,
    tipRecipients: 98,
    raceStreak: 2,
    play: { bets: 9_999_999, casinoNetUsd: '9999.99999999', maxMultiplier: '98999.9999', partial: false, casinoDown: false },
  }), NOW));
  for (const key of ['1', '4', '5', '8', '12', '13', '14', '15', '16', '18']) assert.strictEqual(r.get(key).met, false, key);
});

test('medals: a wager record needs to be strictly highest and above zero', () => {
  const tie = byKey(evaluateMedals(base({ wagerUsd: '50.00000000', topOtherWager: '50.00000000' }), NOW));
  assert.strictEqual(tie.get('4').met, false);
  const alone = byKey(evaluateMedals(base({ wagerUsd: '0.00000000', topOtherWager: '0.00000000' }), NOW));
  assert.strictEqual(alone.get('4').met, false);
});

test('medals: play totals missing or partial never unlock and show no progress', () => {
  const asked = byKey(evaluateMedals(base({ play: null }), NOW));
  for (const key of ['8', '12', '13']) {
    assert.strictEqual(asked.get(key).available, false, key);
    assert.strictEqual(asked.get(key).current, null, key);
  }
  const notAsked = byKey(evaluateMedals(base({ play: undefined }), NOW));
  assert.strictEqual(notAsked.get('13').available, false);

  const sportsDown = byKey(evaluateMedals(base({ play: { bets: 20_000_000, casinoNetUsd: '1', maxMultiplier: null, partial: true, casinoDown: false } }), NOW));
  assert.strictEqual(sportsDown.get('13').met, false, 'a partial bet count is not a count');
  assert.strictEqual(sportsDown.get('12').available, true, 'casino-only figures still stand');

  const casinoDown = byKey(evaluateMedals(base({ play: { bets: 1, casinoNetUsd: '0', maxMultiplier: null, partial: true, casinoDown: true } }), NOW));
  assert.strictEqual(casinoDown.get('8').available, false);
  assert.strictEqual(casinoDown.get('12').available, false);
});

test('medals: a casino loss shows as zero progress, not a negative bar', () => {
  const r = byKey(evaluateMedals(base({ play: { bets: 3, casinoNetUsd: '-250.00000000', maxMultiplier: '2.0000', partial: false, casinoDown: false } }), NOW));
  assert.strictEqual(r.get('12').current, 0);
  assert.strictEqual(r.get('8').current, 2);
});

test('medals: longest run of consecutive days', () => {
  assert.strictEqual(longestDayStreak([]), 0);
  assert.strictEqual(longestDayStreak(['2026-01-01']), 1);
  assert.strictEqual(longestDayStreak(['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05', '2026-01-06']), 3);
  // Across a month end.
  assert.strictEqual(longestDayStreak(['2026-01-31', '2026-02-01']), 2);
});
