'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Match Odds / Bookmaker: the per-runner book is built off the feed's runner list, never the slip's.
test('feedRunners: runner names come from the feed market, untrimmed, null when the market is absent', async () => {
  const { feedRunners } = await import('../buffer/betBufferRules.mjs');
  const list = [{ mid: 7, section: [{ sid: 1, nat: 'India ' }, { sid: 2, nat: 'Australia' }] }];
  assert.deepStrictEqual(feedRunners({ marketList: list, marketId: '7' }), ['India ', 'Australia']);
  assert.strictEqual(feedRunners({ marketList: list, marketId: 8 }), null);
  assert.strictEqual(feedRunners({ marketList: [{ mid: 7, section: [] }], marketId: 7 }), null);
});

// Khado: line (back1), band width (lay1) and rate (back1 size) are read off the feed runner, never the slip.
test('khadoQuote: line, band and rate from the feed runner by selection id, null when any is missing', async () => {
  const { khadoQuote } = await import('../buffer/betBufferRules.mjs');
  const odds = (back, lay, size = 100) => [{ otype: 'back', oname: 'back1', tno: 0, odds: back, size }, { otype: 'lay', oname: 'lay1', tno: 0, odds: lay, size: 100 }];
  const list = [{ mid: 9, gtype: 'khado', section: [{ sid: 2518, nat: '10 over Khado run PAK adv', odds: odds(50, 11) }, { sid: 2519, odds: odds(55, 0) }] }];
  assert.deepStrictEqual(khadoQuote({ marketList: list, marketId: '9', selectionId: '2518' }), { line: 50, band: 11, rate: 100 });
  assert.strictEqual(khadoQuote({ marketList: list, marketId: 9, selectionId: 2519 }), null);
  assert.strictEqual(khadoQuote({ marketList: list, marketId: 9, selectionId: 1 }), null);
  assert.strictEqual(khadoQuote({ marketList: list, marketId: 9 }), null);
});

// A lone badlo yes risks nothing, so it needs no legs that fund it.
test('badloSlipError: a yes leg needs a badlo no of at least its stake, in one currency, unmixed', async () => {
  const { badloSlipError, isBadloLeg } = await import('../../../lib/helper/badloMarket.mjs');
  const leg = (bet_type, odds, stake_amount, extra = {}) => ({ badlo: true, bet_type, odds, stake_amount, currency: 'INR', ...extra });
  assert.strictEqual(badloSlipError([leg('yes', 40, 100), leg('no', 42, 100)]), null);
  assert.strictEqual(badloSlipError([leg('no', 40, 100), leg('no', 42, 100)]), null);
  assert.ok(badloSlipError([leg('yes', 40, 100), leg('yes', 42, 100)]));
  assert.ok(badloSlipError([leg('yes', 40, 100), leg('yes', 41, 100), leg('no', 42, 100)]));
  assert.ok(badloSlipError([leg('yes', 40, 100), leg('no', 42, 100, { currency: 'BTC' })]));
  assert.ok(badloSlipError([leg('yes', 40, 100), { bet_type: 'yes', odds: 41, stake_amount: 100, currency: 'INR' }]));
  // the legacy market_type 'badlo' is badlo to placeBet, so it is to the guard too
  assert.ok(badloSlipError([{ market_type: 'badlo', bet_type: 'yes', stake_amount: 100 }, { market_type: 'badlo', bet_type: 'yes', stake_amount: 100 }]));
  assert.strictEqual(badloSlipError([{ bet_type: 'back', stake_amount: 1 }, { bet_type: 'back', stake_amount: 1 }]), null);
  assert.strictEqual(isBadloLeg({ market_type: 'Badlo' }), true);
});

// No matching engine: a stored bet is never unmatched, whatever the body says (cancel-bet keys on it).
test('placeBet stores unmatched=false, never the request value', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/sportbetscontroller.mjs'), 'utf8');
  assert.match(src, /^\s+unmatched: false,$/m);
  assert.doesNotMatch(src, /unmatched: unmatched/);
});

// game_type/market_type are client-set, so placeBet itself refuses a MO/BM book that omits the selection.
test('placeBet refuses a MO/BM bet whose selection is not in the (feed) runner list', () => {
  const src = fs.readFileSync(path.join(__dirname, '../controllers/sportbetscontroller.mjs'), 'utf8');
  assert.match(src, /\(normGameType === "MO" \|\| normGameType === "BM"\) && !\(Array\.isArray\(runners\) && runners\.length >= 2 && runners\.includes\(sel\)\)/);
});
