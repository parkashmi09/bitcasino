'use strict';

const { money } = require('@ibitplay/common');

/**
 * The pro-rating rule every per-stake item follows when its stake is (partly) refunded.
 *
 * An item written for one stake — its rakeback accrual, its bonus wagering allocations, its
 * affiliate commission row — keeps `amount` (what still counts) and `reversed_amount` (what
 * a reversal took back out), so its original is always `amount + reversed_amount`.
 *
 * With `reversedStake` of `stake` refunded so far, the item's reversed part must be
 * `original × reversedStake / stake` (rounded down to 10^-8), or the whole original once the
 * stake is fully reversed — so the rounding remainder lands on the last slice and the slices
 * always add up to the original exactly. The target depends only on the cumulative figure,
 * so settling an item is idempotent and order-independent: a retry, a late side effect or a
 * reversal that raced it all converge on the same value, and a stale (smaller) figure never
 * puts anything back.
 */

const ZERO = '0.00000000';

/** Minor-unit BigInt of the reversed part `original` should have. */
function reversedTarget(original, reversedStake, stake, full) {
  const orig = money.toMinorQuantised(String(original ?? '0'));
  if (orig <= 0n) return 0n;
  if (full) return orig;
  const s = money.toMinorQuantised(String(stake ?? '0'));
  if (s <= 0n) return orig;
  const r = money.toMinorQuantised(String(reversedStake ?? '0'));
  if (r <= 0n) return 0n;
  const share = (orig * r) / s;
  return share > orig ? orig : share;
}

/**
 * How much more to take out of an item `{ amount, reversed_amount }` to reach its target.
 *
 * @returns {{ delta: string, amount: string, reversed: string } | null}  null = nothing to do
 */
function settleItem(item, { reversedStake, stake, full }) {
  const amount = money.toMinorQuantised(String(item.amount ?? '0'));
  const already = money.toMinorQuantised(String(item.reversed_amount ?? '0'));
  const target = reversedTarget(money.toDecimalString(amount + already), reversedStake, stake, full);
  const delta = target - already;
  if (delta <= 0n) return null;
  return {
    delta: money.toDecimalString(delta),
    amount: money.toDecimalString(amount - delta),
    reversed: money.toDecimalString(target),
  };
}

module.exports = { reversedTarget, settleItem, ZERO };
