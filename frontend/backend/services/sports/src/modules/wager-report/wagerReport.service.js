'use strict';

const { Op, fn, col } = require('sequelize');
const { money } = require('@ibitplay/common');

/**
 * How much a player has wagered on sports, over a period.
 *
 * The sports counterpart to casino-service's module of the same name. See that
 * one for why this is an internal API rather than three copies of the same
 * query scattered through the reward features.
 *
 * ── ONE DIFFERENCE WORTH KNOWING ─────────────────────────────────────────
 * `SportsBet` already carries `usd_amount`, converted when the bet was placed.
 * That is the RIGHT number to use — it is what the stake was worth at the
 * moment it was risked, not what it would be worth today. Recomputing it from
 * `original_amount` at a current rate would make a player's historical
 * wagering total drift with the exchange rate, so a condition they had already
 * met could quietly become unmet.
 *
 * So this returns USD directly, where the casino one returns per-currency
 * totals for the caller to convert. The shapes differ because the underlying
 * facts differ, and flattening that would mean throwing away the better one.
 */
class WagerReportService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  async turnover({ userId, from, to }) {
    const window = this.#window(from, to);

    const rows = await this.models.SportsBet.findAll({
      where: {
        user_id: userId,
        /**
         * Settled bets only — won or lost.
         *
         * An OPEN bet has been staked but not resolved, and a VOID one was
         * refunded and never really risked. Counting voids would let a player
         * meet a wagering requirement by placing large bets on markets they
         * expect to be voided. This matches the legacy condition
         * (`result_status IN ('won','loss')`), which was right.
         */
        result_status: ['won', 'loss'],
        ...(window ? { created_at: window } : {}),
      },
      attributes: [
        [fn('SUM', col('usd_amount')), 'total'],
        [fn('COUNT', col('id')), 'count'],
      ],
      raw: true,
    });

    const row = rows[0] ?? {};

    return {
      userId,
      from: from ?? null,
      to: to ?? null,
      bets: Number(row.count ?? 0),
      // Converted at stake time, by the service that placed the bet.
      usd: money.toDecimalString(money.toMinor(row.total ?? '0')),
    };
  }

  /** Half-open, for the reasons given in the casino module. */
  #window(from, to) {
    if (!from && !to) return null;
    const range = {};
    if (from) range[Op.gte] = new Date(from);
    if (to) range[Op.lt] = new Date(to);
    return range;
  }
}

module.exports = { WagerReportService };
