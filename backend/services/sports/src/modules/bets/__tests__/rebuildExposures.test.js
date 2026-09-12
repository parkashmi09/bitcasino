'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { outcomesFor, sideOf, wasInferred, OPEN_STATUSES } = require('../../../../../../scripts/rebuild-exposures');
const { betDelta, applyDelta, worstCase } = require('../exposure');
const { GAME_TYPE, SIDE } = require('../bets.constants');

/**
 * The exposure rebuild — `scripts/rebuild-exposures.js`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE IS FOR
 *
 * The rebuild replays historical bets through `betDelta`/`applyDelta`, which
 * are already tested in `exposure.test.js`. What is NOT tested there is the
 * part the rebuild adds: reconstructing the outcome set of a market that no
 * longer exists, from the columns the bet happened to store.
 *
 * That reconstruction decides how much money the platform blocks. If it drops
 * an outcome, the worst case is taken over a smaller set and comes out too
 * small — which is exactly the bug legacy shipped by trusting `count` from the
 * request body.
 *
 * The last test replays the flattening that migration 005 caused and shows the
 * rebuild undoing it.
 * ═════════════════════════════════════════════════════════════════════════
 */

test('exposure rebuild — reconstructing the outcome set', async (t) => {
  await t.test('a two-way market is both teams', () => {
    const outcomes = outcomesFor({
      game_type: GAME_TYPE.MATCH_ODDS,
      team_one: 'India',
      team_two: 'Australia',
      selection_name: 'India',
      counts: 2,
    });

    assert.deepStrictEqual(outcomes, ['India', 'Australia']);
  });

  await t.test('a three-runner market gets the draw', () => {
    // The outcome legacy dropped whenever the body said `count: 2`.
    const outcomes = outcomesFor({
      game_type: GAME_TYPE.MATCH_ODDS,
      team_one: 'Arsenal',
      team_two: 'Chelsea',
      selection_name: 'Arsenal',
      counts: 3,
    });

    assert.deepStrictEqual(outcomes, ['Arsenal', 'Chelsea', 'The Draw']);
  });

  await t.test('a draw already recorded is not added twice', () => {
    const outcomes = outcomesFor({
      game_type: GAME_TYPE.MATCH_ODDS,
      team_one: 'Arsenal',
      team_two: 'Chelsea',
      selection_name: 'The Draw',
      counts: 3,
    });

    assert.deepStrictEqual(outcomes, ['Arsenal', 'Chelsea', 'The Draw']);
    assert.strictEqual(outcomes.filter((name) => /draw/i.test(name)).length, 1);
  });

  await t.test('a selection that is neither recorded team still becomes an outcome', () => {
    // Otherwise `betDelta` would treat the selection as "some other outcome"
    // and price the bet as a loss on every branch.
    const outcomes = outcomesFor({
      game_type: GAME_TYPE.MATCH_ODDS,
      team_one: 'India',
      team_two: 'Australia',
      selection_name: 'England',
      counts: 2,
    });

    assert.ok(outcomes.includes('England'));
  });

  await t.test('fancy is always YES/NO regardless of what the row stored', () => {
    assert.deepStrictEqual(
      outcomesFor({ game_type: GAME_TYPE.FANCY, team_one: 'India', team_two: null, counts: 9 }),
      ['YES', 'NO']
    );
  });

  await t.test('a bet missing a team is flagged as inferred', () => {
    assert.strictEqual(wasInferred({ game_type: GAME_TYPE.MATCH_ODDS, team_one: 'India', team_two: null }), true);
    assert.strictEqual(wasInferred({ game_type: GAME_TYPE.MATCH_ODDS, team_one: 'India', team_two: 'Aus' }), false);
    // Fancy carries its outcomes in the market kind, so nothing is inferred.
    assert.strictEqual(wasInferred({ game_type: GAME_TYPE.FANCY, team_one: null, team_two: null }), false);
  });
});

test('exposure rebuild — reading the side off a historical row', async (t) => {
  await t.test('every spelling in the column maps to a side', () => {
    // The column holds all of these across the history.
    for (const spelling of ['back', 'BACK', 'Back', ' back ']) {
      assert.strictEqual(sideOf({ bet_type: spelling }), SIDE.BACK, spelling);
    }
    for (const spelling of ['lay', 'LAY', 'Lay']) {
      assert.strictEqual(sideOf({ bet_type: spelling }), SIDE.LAY, spelling);
    }
  });

  await t.test("fancy's yes/no are the same two sides", () => {
    assert.strictEqual(sideOf({ bet_type: 'yes' }), SIDE.BACK);
    assert.strictEqual(sideOf({ bet_type: 'no' }), SIDE.LAY);
  });

  await t.test('an unreadable side falls back to back, not to lay', () => {
    /**
     * Deliberate. A back bet's liability is the stake; a lay bet's is
     * stake × (odds−1), which is larger. Guessing "back" on a corrupt row
     * under-blocks by a bounded amount; guessing "lay" would invent a
     * liability that may not exist and could block a player's whole balance.
     * Neither is right — the row gets counted in the report either way.
     */
    assert.strictEqual(sideOf({ bet_type: null }), SIDE.BACK);
    assert.strictEqual(sideOf({ bet_type: 'garbage' }), SIDE.BACK);
  });
});

test('exposure rebuild — undoing the flattening from migration 005', async (t) => {
  /**
   * Two back bets on opposite sides of the same two-way market.
   *
   *   100 on India   @ 2.0   → India +100, Australia −100
   *   100 on Australia @ 3.0 → India −100, Australia +200
   *
   * Position: India 0, Australia +100. The worst case is 0 — the player cannot
   * lose, they have hedged. NOTHING should be blocked.
   */
  const bets = [
    { selection_name: 'India', odds: '2.0', stake_amount: '100' },
    { selection_name: 'Australia', odds: '3.0', stake_amount: '100' },
  ];

  let position = {};
  for (const bet of bets) {
    position = applyDelta(
      position,
      betDelta({
        gameType: GAME_TYPE.MATCH_ODDS,
        side: SIDE.BACK,
        selection: bet.selection_name,
        odds: bet.odds,
        stake: bet.stake_amount,
        outcomes: outcomesFor({
          game_type: GAME_TYPE.MATCH_ODDS,
          team_one: 'India',
          team_two: 'Australia',
          selection_name: bet.selection_name,
          counts: 2,
        }),
      })
    );
  }

  await t.test('the rebuilt position is one row per outcome', () => {
    assert.deepStrictEqual(Object.keys(position).sort(), ['Australia', 'India']);
  });

  await t.test('the hedged position blocks nothing', () => {
    // Eight decimal places — `money` carries crypto precision throughout.
    assert.strictEqual(Number(position.India), 0);
    assert.strictEqual(Number(position.Australia), 100);
    assert.strictEqual(Number(worstCase(position)), 0);
  });

  await t.test('the flattened row migration 005 produced was the sum, and wrong', () => {
    /**
     * 005 collapsed the two rows into one holding their SUM. On this position
     * that is 0 + 100 = 100 on a single row labelled with whichever outcome
     * survived — a player who has hedged to zero risk showing 100 blocked.
     *
     * Summing exposures is meaningless in both directions: here it invents a
     * liability, and on a one-sided position it doubles a real one.
     */
    const flattened = Object.values(position).reduce((sum, value) => sum + Number(value), 0);

    assert.strictEqual(flattened, 100);
    assert.notStrictEqual(flattened, Number(worstCase(position)));
  });
});

test('exposure rebuild — only unsettled bets carry exposure', () => {
  /**
   * `open` and `manual` both mean the stake has left the wallet with nothing
   * settling it. Everything else has resolved.
   */
  assert.deepStrictEqual(OPEN_STATUSES, ['open', 'manual']);

  for (const settled of ['settled', 'won', 'lost', 'void', 'cancelled', 'closed']) {
    assert.ok(!OPEN_STATUSES.includes(settled), `${settled} must not count as open`);
  }
});
