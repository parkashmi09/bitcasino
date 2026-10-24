'use strict';

const { money } = require('@ibitplay/common');

const { GAME_TYPE, SIDE, DRAW_NAMES } = require('./bets.constants');

/**
 * What a bet does to a player's position on a match.
 *
 * Pure functions over exact decimal strings. No database, no wallet, no
 * request — which is the point: this is the arithmetic that decides how much
 * money is blocked, and it should be readable and testable on its own.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE MODEL
 *
 * A player's exposure on a match is one number per possible outcome: what
 * their balance does if that outcome happens. Positive is a win, negative is a
 * loss. The amount the platform must block is the WORST case — the largest
 * negative across every outcome — because that is the most the player can lose.
 *
 *   BACK at odds O for stake S:   selection +S(O-1), every other outcome −S
 *   LAY  at odds O for stake S:   selection −S(O-1), every other outcome +S
 *
 * ── WHAT LEGACY GOT WRONG ────────────────────────────────────────────────
 *
 * THE OUTCOME LIST CAME FROM THE REQUEST. `count` — the number of runners —
 * arrived in the body, and the Draw leg was computed only `if (count == 3)`.
 * A three-way market bet with `count: 2` skipped the Draw entirely, so the
 * outcome where the player loses was not in the set the worst case was taken
 * over, and less money was blocked than the bet could lose. Here the outcome
 * list is derived from the market, and Draw is present iff the market has one.
 *
 * IT WAS ALL FLOATS. `stake * (oddN - 1)` on IEEE-754 doubles, then compared
 * against a balance. Exact decimals throughout here.
 *
 * FANCY EXPOSURE WAS SWITCHED OFF MID-FUNCTION. The fancy branch reads:
 *
 *     console.log("[FANCY] Bet disabled for exposer");
 *
 * with the real calculation commented out above it, so a fancy bet recorded no
 * exposure at all and blocked exactly the stake — regardless of what a NO bet
 * at those odds could actually lose. A NO bet's liability is stake × (odds−1),
 * which on a 3.0 line is twice the stake. That is computed here.
 */

/**
 * The exposure DELTA a single bet produces, per outcome.
 *
 * Returned as a map of `outcome -> decimal string`. Callers add it to the
 * player's existing position; nothing here reads or writes state.
 *
 * @param outcomes every possible result of the market, from the MARKET — not
 *   from the request. For match odds that is both teams plus the draw if the
 *   market has three runners.
 */
function betDelta({ gameType, side, selection, odds, stake, outcomes }) {
  const isLay = side === SIDE.LAY;

  if (gameType === GAME_TYPE.FANCY) {
    /**
     * Fancy / line markets are two-sided on one number: YES or NO.
     *
     * YES risks the stake and wins stake × (odds−1).
     * NO  risks stake × (odds−1) and wins the stake.
     *
     * Legacy blocked the stake for both, so a NO bet on a 3.0 line had twice
     * its liability unfunded.
     */
    const win = money.toDecimalString(money.multiply(money.toMinor(stake), oddsMinusOne(odds)));
    return isLay
      ? { YES: money.toDecimalString(money.toMinor(stake)), NO: `-${win}` }
      : { YES: `-${money.toDecimalString(money.toMinor(stake))}`, NO: win };
  }

  const profit = money.toDecimalString(money.multiply(money.toMinor(stake), oddsMinusOne(odds)));
  const staked = money.toDecimalString(money.toMinor(stake));

  const delta = {};
  for (const outcome of outcomes) {
    const isSelection = sameOutcome(outcome, selection);

    if (isSelection) {
      // Back wins the profit; lay owes it.
      delta[outcome] = isLay ? `-${profit}` : profit;
    } else {
      // Every other outcome: back loses the stake; lay keeps it.
      delta[outcome] = isLay ? staked : `-${staked}`;
    }
  }

  return delta;
}

/**
 * Add a delta to an existing position.
 *
 * Outcomes present in either side survive; an outcome the player had no
 * position on starts at zero.
 */
function applyDelta(position, delta) {
  const out = {};
  for (const outcome of new Set([...Object.keys(position), ...Object.keys(delta)])) {
    const before = money.toMinor(position[outcome] ?? '0');
    const change = money.toMinor(delta[outcome] ?? '0');
    out[outcome] = money.toDecimalString(money.add(before, change));
  }
  return out;
}

/**
 * The most this position can lose — the number that has to be funded.
 *
 * Zero when nothing is negative: a position that wins on every outcome blocks
 * nothing.
 */
function worstCase(position) {
  let worst = money.toMinor('0');
  for (const amount of Object.values(position)) {
    const value = money.toMinor(amount);
    if (money.lt(value, worst)) worst = value;
  }
  return money.toDecimalString(money.abs(worst));
}

/**
 * How much MORE has to be blocked to go from one position to another.
 *
 * Negative means the new bet reduces the worst case and money is released — a
 * hedge. Legacy computed this the same way and it is the one part of the
 * calculation it got right; it is stated here so it can be tested.
 */
function additionalLiability(before, after) {
  return money.toDecimalString(
    money.subtract(money.toMinor(worstCase(after)), money.toMinor(worstCase(before)))
  );
}

// ══════════════════════════════════════════════════════════════════════

/** `odds - 1`, in minor units, refusing anything that is not a real price. */
function oddsMinusOne(odds) {
  return money.subtract(money.toMinor(odds), money.toMinor('1'));
}

/**
 * Two outcome names that mean the same thing.
 *
 * The feed writes the draw as "The Draw", "Draw" and occasionally "DRAW"
 * depending on the endpoint, and legacy compared `selLower === 'the draw' ||
 * selLower === 'draw'` in one branch and raw `sel === team_one` in another — so
 * a draw selection matched in the branch that checked for it and fell through
 * as "some other team" in the branch that did not.
 */
function sameOutcome(a, b) {
  const norm = (value) => {
    const text = String(value ?? '').trim().toLowerCase();
    return DRAW_NAMES.has(text) ? 'the draw' : text;
  };
  return norm(a) === norm(b);
}

module.exports = { betDelta, applyDelta, worstCase, additionalLiability, sameOutcome };
