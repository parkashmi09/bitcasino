'use strict';

const { Op, fn, col, literal } = require('sequelize');
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

  /**
   * Every player's sports turnover in a window — the sports half of the
   * wagering race's leaderboard input.
   *
   * ── ONE BUCKET, AND ALREADY IN USD ───────────────────────────────────
   *
   * Casino's counterpart returns per-currency amounts split across five game
   * buckets, because a casino bet could be any of them and casino-service
   * cannot price a currency. Neither applies here: every row is the `sports`
   * bucket, and `usd_amount` was converted when the stake was risked. Handing
   * back `original_amount` for the caller to convert at today's rate would
   * make a player's race points drift with the exchange rate after the bets
   * were placed.
   *
   * ── AND SETTLED BETS ONLY, WHICH IS A REAL RESTRICTION ───────────────
   *
   * `result_status IN ('won','loss')`, matching `turnover()` above: an OPEN
   * bet has been staked but not resolved, and a VOID one was refunded and
   * never really risked. For a race that means a bet placed inside the window
   * on a match that settles after it scores nothing — correct, since a player
   * could otherwise stake into a market they expect to be voided and collect
   * points for free, but worth knowing when a leaderboard looks thin on a
   * day with late fixtures.
   */
  async racePoints({ from, to, maxRows = 50_000 }) {
    const start = new Date(from);
    const end = new Date(to);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      // Returning [] for a bad window would present a caller bug as "nobody
      // bet", which is how a broken race looks correct.
      throw new Error(`racePoints: invalid window ${String(from)} .. ${String(to)}`);
    }

    const rows = await this.models.SportsBet.findAll({
      where: {
        result_status: ['won', 'loss'],
        created_at: { [Op.gte]: start, [Op.lt]: end },
      },
      attributes: [
        'user_id',
        [fn('SUM', col('usd_amount')), 'total'],
        [fn('COUNT', col('id')), 'count'],
      ],
      group: ['user_id'],
      limit: maxRows,
      raw: true,
    });

    if (rows.length >= maxRows) {
      this.logger?.warn({ maxRows, from: start, to: end }, 'racePoints hit its row cap — leaderboard may be incomplete');
    }

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      rows: rows.map((r) => ({
        userId: String(r.user_id),
        bucket: 'sports',
        // The one source that is already priced. `USD` rather than a wallet
        // currency code, so a caller cannot mistake it for something to
        // convert a second time.
        currency: 'USD',
        usd: money.toDecimalString(money.toMinor(r.total ?? '0')),
        bets: Number(r.count ?? 0),
      })),
    };
  }

  /**
   * One player's lifetime sports play, for their own profile page — the sports
   * half of user-service's `GET /user/profile/stats`.
   *
   * Settled bets only (won or lost), the same rule as `turnover()`. Per stake
   * currency, with the stake-time `usd_amount` beside the original so the
   * caller adds USD without re-pricing history. No biggest win: a bet row has
   * no payout column, and deriving one from odds would be wrong for lay bets.
   * One grouped scan on `idx_sportsbet_user_created`.
   */
  async profileStats({ userId }) {
    const rows = await this.models.SportsBet.findAll({
      where: { user_id: userId, result_status: ['won', 'loss'] },
      attributes: [
        'original_currency',
        [fn('SUM', col('original_amount')), 'amount'],
        [fn('SUM', col('usd_amount')), 'usd'],
        [fn('COUNT', col('id')), 'bets'],
        [literal(`COUNT(*) FILTER (WHERE result_status = 'won')`), 'wins'],
        [fn('MIN', col('created_at')), 'firstAt'],
        [fn('MAX', col('created_at')), 'lastAt'],
      ],
      group: ['original_currency'],
      raw: true,
    });

    const dec = (v) => money.toDecimalString(money.toMinorQuantised(String(v ?? '0')));
    const iso = (v) => (v ? new Date(v).toISOString() : null);

    return {
      userId: String(userId),
      byCurrency: rows.map((r) => ({
        // A bet placed before currencies were recorded was staked in USD.
        currency: String(r.original_currency || 'USD').toUpperCase(),
        wagered: dec(r.amount ?? r.usd),
        usd: dec(r.usd),
        bets: Number(r.bets ?? 0),
        wins: Number(r.wins ?? 0),
        firstAt: iso(r.firstAt),
        lastAt: iso(r.lastAt),
      })),
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
