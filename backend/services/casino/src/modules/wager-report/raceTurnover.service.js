'use strict';

const { bucketCaseSql } = require('@ibitplay/common');

/**
 * Every player's casino turnover in a window, split by game bucket and
 * currency — the input to the wagering race's leaderboard.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS LIVES HERE, AND WHY IT RETURNS CURRENCIES RATHER THAN POINTS
 *
 * Same boundary as `WagerReportService`: casino-service owns the four tables a
 * casino bet can land in, and three separate features had previously each
 * written their own version of "how much has this player wagered", which had
 * drifted apart. The race would have been the fourth.
 *
 * It stops at turnover-per-currency for the same reason `turnover()` does:
 * casino-service has no authoritative view of exchange rates — user-service
 * owns `exchangerate` — and converting here would mean this service quietly
 * deciding what a BDT bet is worth. The caller converts, with the rate it is
 * already using for the rest of the calculation, and then applies the
 * multipliers, which are also user-service's configuration.
 *
 * ── THE SOURCES ─────────────────────────────────────────────────────
 *
 *   bets                   in-house originals. One row IS a round: `amount` is
 *                          the stake, so every row counts, with no kind column
 *                          to filter on.
 *   gis_transactions       Slotegrator. `action = 'bet'`, stake = ABS(amount), not rolled back.
 *   js_game_transactions   jsGames v1. `transaction_type = 'bet'` AND
 *                          `transaction_status = 'completed'`.
 *   game_transactions      jsGames v2. `amount` is the round's net, so the
 *                          stake is `additional_data.bet_amount` (negative on
 *                          a provider's negative-bet correction).
 *   seamless_transactions  the seamless wallet. `withdraw`/`pushbet` debits
 *                          that were not rolled back or cancelled.
 *
 * Only STAKES. Wins, refunds and rollbacks are excluded — a race scores
 * turnover, not profit, so a bet that won still counts as having been risked.
 * That is also what stops a player farming points by winning.
 *
 * ── AND THE GAME TYPE COMES FROM THE CATALOGUE, NOT THE TRANSACTION ──────
 *
 * None of the three provider tables stores a game type; they store a provider
 * id (`game_uid`, `game_uuid`). The type is on `js_games` / `gis_games`, so
 * each source is LEFT JOINed to its catalogue. Left, not inner: a transaction
 * whose game has since been removed from the catalogue is still turnover, and
 * an inner join would silently drop it. It lands in the `other` bucket, which
 * has a multiplier of its own.
 * ═════════════════════════════════════════════════════════════════════════
 */
class RaceTurnoverService {
  constructor({ db, logger }) {
    this.db = db;
    this.logger = logger;
  }

  /**
   * @param {object} options
   * @param {string|Date} options.from  inclusive
   * @param {string|Date} options.to    exclusive
   * @param {number} [options.maxRows]  hard cap, so a mis-specified window
   *   cannot try to materialise the whole history into one response.
   * @returns {Promise<{from, to, rows: Array<{userId, bucket, currency, amount, bets}>}>}
   */
  async racePoints({ from, to, maxRows = 50_000 }) {
    const start = new Date(from);
    const end = new Date(to);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      // A bad window is a caller bug, and returning [] would present it as
      // "nobody wagered" — which is exactly how a broken race looks correct.
      throw new Error(`racePoints: invalid window ${String(from)} .. ${String(to)}`);
    }

    /**
     * One UNION ALL, aggregated once at the end.
     *
     * Four separate queries would mean four round trips and four partial
     * groupings to merge in JavaScript; the merge is the part that goes wrong,
     * because each source spells `user_id` and `currency` differently and the
     * same player appears in several.
     */
    const sql = `
      WITH stakes AS (
        -- in-house originals: one row is a whole round, 'amount' is the stake
        SELECT b.uid            AS user_id,
               ${bucketCaseSql('b.game')} AS bucket,
               UPPER(b.coin)    AS currency,
               b.amount         AS amount
          FROM bets b
         WHERE b.created >= :start AND b.created < :end
           AND b.uid IS NOT NULL
           AND b.amount > 0
           -- a refunded round never happened: not turnover, same as the rollover
           AND (b.result IS NULL OR b.result::text <> '"refunded"')

        UNION ALL

        -- Slotegrator. gis.service writes a bet as a DEBIT (negative amount; legacy rows were
        -- unsigned), so the stake is ABS(amount); a bet it rolled back (its 'rb:<id>' row) never
        -- happened. The type comes from the lobby's catalogue (gisgamesnew), the legacy gis_games
        -- after it — gis_games is emptied by its own sync, which left every slot in 'other'.
        SELECT g.user_id,
               ${bucketCaseSql('COALESCE(gn.type, gg.type)')},
               UPPER(g.currency),
               ABS(g.amount)
          FROM gis_transactions g
          LEFT JOIN gisgamesnew gn ON gn.uuid = g.game_uuid
          LEFT JOIN gis_games gg ON gg.uuid = g.game_uuid
         WHERE g.created_at >= :start AND g.created_at < :end
           AND LOWER(g.action) = 'bet'
           AND g.amount <> 0
           AND NOT EXISTS (SELECT 1 FROM gis_transactions r WHERE r.transaction_id = 'rb:' || g.transaction_id)

        UNION ALL

        -- jsGames v1
        SELECT j.user_id,
               ${bucketCaseSql('jg.game_type')},
               UPPER(j.currency),
               j.amount
          FROM js_game_transactions j
          LEFT JOIN js_games jg ON jg.game_uid = j.game_uid
         WHERE j.timestamp >= :start AND j.timestamp < :end
           AND LOWER(j.transaction_type) = 'bet'
           AND LOWER(j.transaction_status) = 'completed'
           AND j.amount > 0

        UNION ALL

        -- jsGames v2. The stored 'amount' is the round's NET (win − bet), so a
        -- stake is negative there and a 'loss' row (bet 0, win 0) is 0 — the
        -- stake has to come from the callback's own 'bet_amount'. Every row that
        -- carries one counts it: a positive stake ('bet', 'bet_result',
        -- 'bet_with_negative_result') adds, a provider's negative-bet
        -- correction ('negative_bet*') takes it back out.
        SELECT v.user_id,
               ${bucketCaseSql('jg2.game_type')},
               UPPER(v.currency),
               (v.additional_data->>'bet_amount')::numeric
          FROM game_transactions v
          LEFT JOIN js_games jg2 ON jg2.game_uid = v.game_uid
         WHERE v.created_at >= :start AND v.created_at < :end
           AND (v.additional_data->>'bet_amount') ~ '^-?[0-9]+([.][0-9]+)?$'
           AND (v.additional_data->>'bet_amount')::numeric <> 0

        UNION ALL

        -- Original Games aggregator (migration 130): an applied bet that was not
        -- rolled back — the same rule as the profile stats.
        SELECT o.user_id,
               ${bucketCaseSql('o.game_code')},
               UPPER(o.currency),
               o.amount
          FROM og_transactions o
         WHERE o.created_at >= :start AND o.created_at < :end
           AND o.kind = 'bet' AND o.status = 'applied' AND o.amount > 0
           AND NOT EXISTS (
                 SELECT 1 FROM og_transactions r
                  WHERE r.kind = 'rollback' AND r.status = 'applied'
                    AND r.reference_transaction_id = o.transaction_id)

        UNION ALL

        -- Seamless (the casino provider's seamless wallet, a casino product).
        -- A stake is a 'withdraw' / 'pushbet' debit (amount < 0, settlement
        -- coin USDT), and one that was rolled back or cancelled never happened.
        SELECT s.user_id,
               ${bucketCaseSql('NULL')},
               'USDT',
               -s.amount
          FROM seamless_transactions s
         WHERE s.created_at >= :start AND s.created_at < :end
           AND s.user_id IS NOT NULL
           AND LOWER(s.action) IN ('withdraw', 'pushbet')
           AND s.amount < 0
           AND NOT EXISTS (
                 SELECT 1 FROM seamless_transactions r
                  WHERE r.reverses_id = s.transaction_id
                    AND LOWER(r.action) IN ('rollback', 'cancel'))
      )
      SELECT user_id, bucket, currency,
             SUM(amount)  AS amount,
             -- a correction row is not another bet
             COUNT(*) FILTER (WHERE amount > 0) AS bets
        FROM stakes
       GROUP BY user_id, bucket, currency
       ORDER BY user_id
       LIMIT :maxRows`;

    const rows = await this.db.sequelize.query(sql, {
      replacements: { start, end, maxRows },
      type: this.db.QueryTypes.SELECT,
    });

    if (rows.length >= maxRows) {
      // Truncation here means a leaderboard missing players, which looks like
      // a correct board rather than a broken one. Loud on purpose.
      this.logger?.warn({ maxRows, from: start, to: end }, 'racePoints hit its row cap — leaderboard may be incomplete');
    }

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      rows: rows.map((r) => ({
        userId: String(r.user_id),
        bucket: r.bucket,
        currency: r.currency,
        // Decimal strings on the wire — never a float for money.
        amount: String(r.amount ?? '0'),
        bets: Number(r.bets ?? 0),
      })),
    };
  }
}

module.exports = { RaceTurnoverService };
