'use strict';

const { money } = require('@ibitplay/common');

const { TOP3_DECAY, REST_DECAY, PODIUM_SIZE } = require('./race.constants');

/**
 * How a prize pool is split between ranks.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THE CURVE IS COMPUTED ONCE AND STORED, NOT RECOMPUTED PER REQUEST
 *
 * The reference computed this in two places: once when an operator saved the
 * config, persisted into `race_config.rank_percentage` and shown to them as
 * "Rank-wise Distribution"; and again, from scratch, on every leaderboard
 * request. The two used different sources for the winner count — the stored
 * column in one, a request-scoped `limit` with its own fallback in the other —
 * so the table the operator approved and the "Reward" column the player saw
 * could disagree, and nothing anywhere would say which was right.
 *
 * `buildRankPrizes` is called on save. `race_config.rank_percentage` is what
 * every reader uses afterwards. The curve a player sees is the curve somebody
 * approved.
 *
 * ── THE SHAPE ────────────────────────────────────────────────────────────
 *
 *   1. net pool   = pool × (1 − fee%)
 *   2. the podium (ranks 1..3) takes `top3Percentage` of it; the rest share
 *      what is left. With three or fewer winners the podium takes all of it.
 *   3. inside each group the weights are geometric — `decay^0, decay^1, …` —
 *      normalised to that group's share.
 *   4. the LAST rank in each group absorbs the rounding remainder, so the
 *      parts always add up to the whole. Distributing the dust evenly instead
 *      leaves a few satoshi unassigned, which over a year of daily races is a
 *      slowly growing discrepancy nobody can account for.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * @param {object} config
 * @param {string|number} config.prizePool           gross, before the fee
 * @param {number} config.winnerCount
 * @param {string|number} config.platformFeePercent
 * @param {string|number} config.top3Percentage
 * @returns {{netPool: string, ranks: Array<{rank, percentage, amount}>}}
 *   `percentage` is a share of the NET pool, to 4dp. `amount` is a decimal
 *   string in the prize currency.
 */
function buildRankPrizes({ prizePool, winnerCount, platformFeePercent, top3Percentage }) {
  const winners = Math.max(0, Math.trunc(Number(winnerCount ?? 0)));

  const gross = money.toMinor(prizePool ?? '0');
  const fee = money.percentOf(gross, platformFeePercent ?? 0);
  const net = gross - fee;

  if (winners < 1 || net <= 0n) {
    return { netPool: money.toDecimalString(net > 0n ? net : 0n), ranks: [] };
  }

  const podiumCount = Math.min(PODIUM_SIZE, winners);
  const restCount = winners - podiumCount;

  /**
   * With nobody below the podium, the podium is the whole prize. Otherwise the
   * operator's split applies. Without this a race with 3 winners and a 60%
   * podium share would quietly pay out only 60% of its pool.
   */
  const podiumShare = restCount === 0 ? 100 : Number(top3Percentage ?? 0);
  const restShare = 100 - podiumShare;

  const ranks = [
    ...groupSlice({ net, count: podiumCount, sharePercent: podiumShare, decay: TOP3_DECAY, firstRank: 1 }),
    ...groupSlice({
      net, count: restCount, sharePercent: restShare, decay: REST_DECAY, firstRank: podiumCount + 1,
    }),
  ];

  capTail(ranks, podiumCount, net);
  return { netPool: money.toDecimalString(net), ranks };
}

/**
 * A lower rank never pays more than a higher one.
 *
 * With a short tail (pool 5, 5 ranks, 60% podium) the tail's share split over two ranks gave
 * rank 4 1.11 against rank 3's 0.43. So every tail rank is capped at the podium's last amount and
 * the excess goes to the podium in proportion to what each podium rank already has (the rounding
 * dust to rank 1): order kept, sum still exactly the net pool. A long tail never hits the cap.
 */
function capTail(ranks, podiumCount, net) {
  const podium = ranks.slice(0, podiumCount);
  if (podium.length < podiumCount || ranks.length === podiumCount) return;

  const cap = money.toMinor(podium[podium.length - 1].amount);
  let excess = 0n;
  for (const row of ranks.slice(podiumCount)) {
    const amount = money.toMinor(row.amount);
    if (amount > cap) {
      excess += amount - cap;
      row.amount = money.toDecimalString(cap);
    }
  }
  if (excess <= 0n) return;

  const amounts = podium.map((r) => money.toMinor(r.amount));
  const podiumTotal = amounts.reduce((a, b) => a + b, 0n);
  const extra = amounts.map((a) => (excess * a) / podiumTotal);
  extra[0] += excess - extra.reduce((a, b) => a + b, 0n);
  podium.forEach((row, i) => { row.amount = money.toDecimalString(amounts[i] + extra[i]); });

  for (const row of ranks) {
    row.percentage = Number(((Number(money.toMinor(row.amount)) / Number(net)) * 100).toFixed(4));
  }
}

/**
 * One geometrically-tapering group.
 *
 * Amounts are apportioned in MINOR UNITS (BigInt at 8dp) rather than by
 * multiplying the pool by a rounded percentage. Rounding each rank's percentage
 * first and then multiplying is what makes the parts fail to add up — and the
 * error is systematic, not random, because rounding a taper truncates in the
 * same direction every time.
 */
function groupSlice({ net, count, sharePercent, decay, firstRank }) {
  if (count < 1 || sharePercent <= 0) return [];

  const groupTotal = money.percentOf(net, sharePercent);
  if (groupTotal <= 0n) return [];

  const weights = Array.from({ length: count }, (_, i) => decay ** i);
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const rows = [];
  let assigned = 0n;

  for (let i = 0; i < count; i += 1) {
    const isLast = i === count - 1;

    /**
     * The last rank takes whatever is left rather than its own computed share.
     * That is what makes the group sum exact — and it is the only rank whose
     * amount can move when the ones above it round.
     */
    const amount = isLast
      ? groupTotal - assigned
      : (groupTotal * BigInt(Math.round(weights[i] * 1e12))) / BigInt(Math.round(weightSum * 1e12));

    assigned += amount;

    rows.push({
      rank: firstRank + i,
      // Share of the NET pool, which is the number that means something to a
      // player: it is the fraction of what is actually paid out.
      percentage: net > 0n ? Number(((Number(amount) / Number(net)) * 100).toFixed(4)) : 0,
      amount: money.toDecimalString(amount),
    });
  }

  return rows;
}

/**
 * An operator's own payout ladder: one share (% of the NET pool) per rank, in rank order.
 *
 * The shares must add up to 100 and never rise down the ladder (rank N never pays more than
 * rank N-1); `null` + a reason otherwise. The last rank takes the rounding remainder, so the
 * amounts add up to exactly the net pool, like the curve. Entries are marked `custom` so a later
 * save of the pool re-prices this ladder instead of replacing it with the curve.
 */
function buildCustomLadder({ prizePool, platformFeePercent, shares }) {
  const list = (shares ?? []).map(Number);
  if (!list.length) return { error: 'the ladder has no ranks' };
  if (list.some((v) => !Number.isFinite(v) || v <= 0)) return { error: 'every rank needs a share above 0%' };
  for (let i = 1; i < list.length; i += 1) {
    if (list[i] > list[i - 1]) return { error: `rank ${i + 1} would pay more than rank ${i}` };
  }
  const total = list.reduce((a, b) => a + b, 0);
  if (Math.abs(total - 100) > 0.01) return { error: `the shares add up to ${total.toFixed(2)}%, not 100%` };

  const gross = money.toMinor(prizePool ?? '0');
  const net = gross - money.percentOf(gross, platformFeePercent ?? 0);
  const scaled = list.map((v) => BigInt(Math.round(v * 1e4)));
  const scaledTotal = scaled.reduce((a, b) => a + b, 0n);

  let assigned = 0n;
  const ranks = list.map((share, i) => {
    const amount = i === list.length - 1 ? net - assigned : (net * scaled[i]) / scaledTotal;
    assigned += amount;
    return { rank: i + 1, percentage: Number(share.toFixed(4)), amount: money.toDecimalString(amount > 0n ? amount : 0n), custom: true };
  });

  return { netPool: money.toDecimalString(net > 0n ? net : 0n), ranks };
}

module.exports = { buildRankPrizes, buildCustomLadder };
