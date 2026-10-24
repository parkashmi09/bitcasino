'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { betDelta, applyDelta, worstCase, additionalLiability, sameOutcome } = require('../exposure');
const { GAME_TYPE, SIDE } = require('../bets.constants');
const { normaliseOdds } = require('../bets.service');
const v = require('../bets.validators');

/**
 * The arithmetic that decides how much of a player's money is blocked.
 *
 * No database and no wallet — this is the calculation on its own, which is how
 * it should be readable. Legacy did it in floats, inside a 300-line request
 * handler, with the outcome list taken from the request body.
 */

const MATCH = ['India', 'Australia', 'The Draw'];

test('exposure arithmetic', async (t) => {
  await t.test('a back bet wins the profit and loses the stake elsewhere', async () => {
    const delta = betDelta({
      gameType: GAME_TYPE.MATCH_ODDS,
      side: SIDE.BACK,
      selection: 'India',
      odds: '2.5',
      stake: '100',
      outcomes: MATCH,
    });

    assert.equal(delta.India, '150.00000000');
    assert.equal(delta.Australia, '-100.00000000');
    assert.equal(delta['The Draw'], '-100.00000000');
  });

  await t.test('a lay bet owes the liability and keeps the stake elsewhere', async () => {
    const delta = betDelta({
      gameType: GAME_TYPE.MATCH_ODDS,
      side: SIDE.LAY,
      selection: 'India',
      odds: '2.5',
      stake: '100',
      outcomes: MATCH,
    });

    assert.equal(delta.India, '-150.00000000');
    assert.equal(delta.Australia, '100.00000000');
    assert.equal(delta['The Draw'], '100.00000000');
  });

  await t.test('the amount blocked is the WORST outcome, not the sum', async () => {
    const position = applyDelta(
      {},
      betDelta({
        gameType: GAME_TYPE.MATCH_ODDS, side: SIDE.BACK, selection: 'India',
        odds: '2.5', stake: '100', outcomes: MATCH,
      })
    );

    // Two outcomes lose 100 each; the player can only lose one of them.
    assert.equal(worstCase(position), '100.00000000');
  });

  await t.test('a position that wins on every outcome blocks nothing', async () => {
    assert.equal(worstCase({ India: '50', Australia: '10' }), '0.00000000');
  });

  await t.test('a hedge RELEASES money rather than taking more', async () => {
    // Back India, then back Australia. The second bet turns a -100 outcome
    // into a winning one, so less has to be held, not more.
    const first = applyDelta(
      {},
      betDelta({
        gameType: GAME_TYPE.MATCH_ODDS, side: SIDE.BACK, selection: 'India',
        odds: '2.0', stake: '100', outcomes: MATCH,
      })
    );
    const second = applyDelta(
      first,
      betDelta({
        gameType: GAME_TYPE.MATCH_ODDS, side: SIDE.BACK, selection: 'Australia',
        odds: '3.0', stake: '100', outcomes: MATCH,
      })
    );

    const change = additionalLiability(first, second);
    assert.ok(Number(change) > 0, 'the draw leg still loses both stakes, so more is held');

    // And a third bet covering the draw brings the worst case down.
    const third = applyDelta(
      second,
      betDelta({
        gameType: GAME_TYPE.MATCH_ODDS, side: SIDE.BACK, selection: 'The Draw',
        odds: '5.0', stake: '100', outcomes: MATCH,
      })
    );
    assert.ok(Number(additionalLiability(second, third)) < 0, 'covering every outcome releases money');
  });

  await t.test('the draw is included whether or not a caller says so', async () => {
    /**
     * Legacy computed the draw leg only `if (count == 3)`, and `count` came
     * from the REQUEST BODY. A three-way market bet with `count: 2` produced
     * an exposure set with no draw in it — so the outcome where the player
     * loses was not among the ones the worst case was taken over, and less
     * money was blocked than the bet could lose.
     *
     * There is no `count` parameter here. The outcome list comes from the
     * market.
     */
    const twoWay = betDelta({
      gameType: GAME_TYPE.MATCH_ODDS, side: SIDE.BACK, selection: 'India',
      odds: '2.0', stake: '100', outcomes: ['India', 'Australia'],
    });
    const threeWay = betDelta({
      gameType: GAME_TYPE.MATCH_ODDS, side: SIDE.BACK, selection: 'India',
      odds: '2.0', stake: '100', outcomes: MATCH,
    });

    assert.equal(Object.keys(twoWay).length, 2);
    assert.equal(Object.keys(threeWay).length, 3);
    assert.equal(threeWay['The Draw'], '-100.00000000');
  });

  await t.test('a NO fancy bet risks the liability, not the stake', async () => {
    /**
     * Legacy's fancy branch is:
     *
     *     console.log("[FANCY] Bet disabled for exposer");
     *
     * with the calculation commented out above it, and then blocks exactly the
     * stake. A NO bet on a 3.0 line risks stake × 2 — so two thirds of the
     * liability was never funded.
     */
    const no = betDelta({
      gameType: GAME_TYPE.FANCY, side: SIDE.LAY, selection: 'NO',
      odds: '3.0', stake: '100', outcomes: ['YES', 'NO'],
    });

    assert.equal(no.NO, '-200.00000000');
    assert.equal(worstCase(applyDelta({}, no)), '200.00000000', 'not 100');
  });

  await t.test('a YES fancy bet risks the stake', async () => {
    const yes = betDelta({
      gameType: GAME_TYPE.FANCY, side: SIDE.BACK, selection: 'YES',
      odds: '3.0', stake: '100', outcomes: ['YES', 'NO'],
    });
    assert.equal(worstCase(applyDelta({}, yes)), '100.00000000');
  });

  await t.test('money keeps full precision — no float drift', async () => {
    // `stake * (odds - 1)` on doubles: 0.1 * 2 is not 0.2 in IEEE-754.
    const delta = betDelta({
      gameType: GAME_TYPE.MATCH_ODDS, side: SIDE.BACK, selection: 'India',
      odds: '1.3', stake: '0.1', outcomes: ['India', 'Australia'],
    });
    assert.equal(delta.India, '0.03000000');
  });

  await t.test('the draw matches under any of its spellings', async () => {
    // The feed writes it three ways; legacy matched two of them in one branch
    // and none in another.
    assert.ok(sameOutcome('The Draw', 'draw'));
    assert.ok(sameOutcome('DRAW', 'the draw'));
    assert.ok(!sameOutcome('India', 'The Draw'));
  });

  await t.test('bookmaker integer prices are normalised', async () => {
    // The feed quotes 150 for 2.50 on bookmaker markets. Legacy normalised it
    // in the exposure maths but wrote the RAW value onto the bet row, so the
    // row said 150 and the liability was computed from 2.50.
    assert.equal(normaliseOdds(150), '2.5');
    assert.equal(normaliseOdds(236), '3.36');
    assert.equal(normaliseOdds('2.5'), '2.5', 'a decimal price is left alone');
  });

  // ══════════════════════════════════════════════════════════════════════
  //  The request shape
  // ══════════════════════════════════════════════════════════════════════

  /**
   * The place-bet body is the LEGACY payload, unchanged, because the service
   * is a verbatim port of `legacy/sportsmain/API/controller.js → placeBet`.
   * The schema's job is to not get in its way — see the note on
   * `bets.validators.js`.
   */
  await t.test('the board\'s own payload is accepted as sent', async () => {
    const fromTheBoard = {
      sports: 'Cricket', event_name: 'Riku Higashi - Kotaro Matsumura', event_id: 659405353,
      amount: 100, back_size: 10000000, bet_type: 'back', category: '0', count: 2,
      eventid: '659405353', fancy_name: '', fixed: 0, game_type: 'MATCH', gtype: 'match',
      lay_size: 10000000, market_id: 7614218935702, market_name: 'MATCH_ODDS',
      market_type: 'MATCH_ODDS', match_id: '7614218935702',
      match_title: 'Riku Higashi - Kotaro Matsumura', mname: 'MATCH_ODDS', nat: 'Riku Higashi ',
      odds: 5.74, original_amount: 100, original_currency: 'INR',
      place_date: '2026-08-07 06:09:16', runner_odds: [],
      runners: ['Riku Higashi ', 'Kotaro Matsumura'], section: '[]',
      selection_name: 'Riku Higashi ', settlened: 'pending', sid: '2', size: 0,
      stake_amount: 100, team: 'Riku Higashi ', team_one: 'Riku Higashi',
      team_two: 'Kotaro Matsumura', unmatched: false, unmatched_odds: null,
      usd_amount: 1.18, user_id: '2744836158', user_rate: 5.74,
    };

    const parsed = v.place.body.parse(fromTheBoard);

    // Numbers stay numbers: the exposure maths is `Number(stake_amount)` and
    // `Number(odds)` on floats, exactly as legacy had it. Coercing here would
    // change the arithmetic.
    assert.equal(parsed.odds, 5.74);
    assert.equal(parsed.stake_amount, 100);
    assert.deepEqual(parsed.runners, ['Riku Higashi ', 'Kotaro Matsumura']);

    // `.passthrough()`, so the fields the handler never reads survive rather
    // than turning the request into a 422.
    assert.equal(parsed.settlened, 'pending');
    assert.equal(parsed.user_rate, 5.74);
  });

  await t.test('user_id is accepted and then overwritten by the token', async () => {
    /**
     * Legacy read `user_id` from the body on an UNAUTHENTICATED route, and that
     * id was whose wallet got debited. The field still parses — the board sends
     * it — but `controllers/index.js` overwrites it with `req.user.id` before
     * the service ever sees it, so it cannot name anybody.
     */
    const parsed = v.place.body.parse({ user_id: '999', stake_amount: 10, odds: 2 });
    assert.equal(parsed.user_id, '999', 'parsed, not refused');

    const asTheControllerBuildsIt = { ...parsed, user_id: 4242 };
    assert.equal(asTheControllerBuildsIt.user_id, 4242, 'the token wins');
  });
});
