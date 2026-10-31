'use strict';

const { Op, fn, col } = require('sequelize');
const { money } = require('@ibitplay/common');

/**
 * How much a player has wagered in casino, over a period.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS IS AN INTERNAL API AND NOT A SHARED QUERY
 *
 * Three separate legacy features needed this number — gift cards, bonuses and
 * club membership — and all three answered it by reaching directly into
 * `gis_transactions` and `js_game_transactions` from user-facing code. Each
 * wrote its own version, and the versions disagreed:
 *
 *   GiftCards/controller.js  counts gis `action = 'bet'` and js `transaction_type = 'bet'`
 *   bonus/calculatewagerbonus.js  counts the same rows but nets off wins
 *   clubmembership              counts only gis, ignoring js games entirely
 *
 * So the same player had three different wager totals depending on which
 * feature was asking. Answering it in one place, in the service that owns the
 * tables, is the point of the split.
 *
 * ── ON "WAGERED" ─────────────────────────────────────────────────────────
 * This returns TURNOVER — the sum of stakes placed — not net loss. That is the
 * definition the gift-card and bonus conditions use ("wager 30x your deposit"),
 * and it is the one a player expects: a bet that wins still counts as having
 * been wagered. Anything wanting net position should ask for it explicitly
 * rather than reinterpreting this number.
 * ─────────────────────────────────────────────────────────────────────────
 */
class WagerReportService {
  constructor({ models, logger }) {
    this.models = models;
    this.logger = logger;
  }

  /**
   * Total turnover for one player, per currency, between two instants.
   *
   * Returned per currency rather than converted. Casino-service has no
   * authoritative view of exchange rates — user-service owns `exchangerate` —
   * and converting here would mean this service quietly deciding what a BDT
   * bet is worth. The caller converts, with the rate it is already using for
   * everything else in the same calculation.
   */
  async turnover({ userId, from, to }) {
    const window = this.#window(from, to);

    const [gis, js] = await Promise.all([
      this.models.GisTransactions.findAll({
        where: {
          user_id: userId,
          action: 'bet',
          ...(window ? { created_at: window } : {}),
        },
        attributes: ['currency', [fn('SUM', col('amount')), 'total'], [fn('COUNT', col('id')), 'count']],
        group: ['currency'],
        raw: true,
      }),
      this.models.JsGameTransactions.findAll({
        where: {
          user_id: userId,
          transaction_type: 'bet',
          // This table timestamps with `timestamp`, not `created_at`. Using the
          // wrong column silently returns everything ever, which reads as a
          // player who has met every wagering requirement.
          ...(window ? { timestamp: window } : {}),
        },
        attributes: ['currency', [fn('SUM', col('amount')), 'total'], [fn('COUNT', col('id')), 'count']],
        group: ['currency'],
        raw: true,
      }),
    ]);

    const byCurrency = {};
    let bets = 0;

    for (const row of [...gis, ...js]) {
      const currency = String(row.currency ?? '').toUpperCase() || 'UNKNOWN';
      const previous = byCurrency[currency] ?? '0';
      byCurrency[currency] = money.toDecimalString(money.add(previous, row.total ?? '0'));
      bets += Number(row.count ?? 0);
    }

    return { userId, from: from ?? null, to: to ?? null, bets, byCurrency };
  }

  /**
   * A half-open window: `>= from`, `< to`.
   *
   * The legacy queries used `BETWEEN $2 AND $3`, which is inclusive at both
   * ends — so a bet placed at exactly the end instant counted towards two
   * adjacent periods.
   */
  #window(from, to) {
    if (!from && !to) return null;
    const range = {};
    if (from) range[Op.gte] = new Date(from);
    if (to) range[Op.lt] = new Date(to);
    return range;
  }
}

module.exports = { WagerReportService };
