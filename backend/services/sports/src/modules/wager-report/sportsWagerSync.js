'use strict';

/**
 * Sports stakes into the platform wager — `userwager` / `wager_activity` (user-service).
 *
 * Casino paths post every stake to `/internal/user/wager/record` as it happens; the sports
 * settlement never did, so a player's sports turnover never reached the Rollover target, VIP,
 * rakeback or the admin's wager columns. Settlement has many paths (auto, manual declare, fancy,
 * void before / after settle), so rather than a call in each, this sweep reconciles the bets
 * table with the wager ledger:
 *
 *   counted   a SETTLED bet (won / loss — the rule `turnover()` uses) with no `sports:<betId>`
 *             activity row → record its stake, in the currency it was staked in.
 *   reversed  a counted bet that has since been voided → reverse it.
 *
 * Both calls are exactly-once per `(source, ref)` in user-service, so a sweep that overlaps or
 * repeats changes nothing, and the first run backfills every bet settled before this existed.
 * Open bets are not wagered yet; a bet voided before it settled was never counted.
 */
const SOURCE = 'sports';

/** Result states that mean the stake was handed back. */
const VOIDED = ['void', 'voided', 'refund', 'refunded', 'cancelled', 'canceled', 'deleted'];

class SportsWagerSync {
  constructor({ db, clients, logger }) {
    this.db = db;
    this.clients = clients;
    this.logger = logger;
  }

  async run({ limit = 200 } = {}) {
    const counted = await this.#countSettled(limit);
    const reversed = (await this.#reverseVoided(limit)) + (await this.#reverseDuplicates(limit));
    if (counted || reversed) this.logger?.info({ counted, reversed }, 'Sports wager sync');
    return { counted, reversed };
  }

  async #countSettled(limit) {
    const bets = await this.#query(
      `SELECT b.id, b.user_id, b.odds, COALESCE(b.original_amount, b.stake_amount) AS amount,
              -- stake_amount is the book's INR figure: with no original_amount the bet is INR,
              -- whatever original_currency says (a USDT label on an INR stake counted rupees as dollars).
              CASE WHEN b.original_amount IS NULL THEN 'INR'
                   ELSE UPPER(COALESCE(b.original_currency, 'INR')) END AS currency
         FROM mssports."SportsBet" b
        WHERE b.result_status IN ('won', 'loss')
          AND COALESCE(b.original_amount, b.stake_amount) > 0
          AND NOT EXISTS (SELECT 1 FROM public.wager_activity w WHERE w.source = :source AND w.ref = b.id::text)
        ORDER BY b.id
        LIMIT :limit`,
      { source: SOURCE, limit }
    );

    let done = 0;
    for (const bet of bets) {
      try {
        const outcome = await this.clients.user.post('/internal/user/wager/record', {
          userId: Number(bet.user_id),
          amount: String(bet.amount),
          currency: bet.currency,
          source: SOURCE,
          ref: String(bet.id),
          category: 'sports',
          // Decimal odds — a bonus counts a sports bet only at 1.5 or more (hash.game).
          ...(Number(bet.odds) > 0 ? { odds: Number(bet.odds).toFixed(4) } : {}),
        });
        if (outcome?.counted) done += 1;
      } catch (error) {
        this.logger?.warn({ err: error, betId: bet.id }, 'Sports wager record failed — retried next sweep');
      }
    }
    return done;
  }

  /**
   * A second sweep (since removed) recorded the same bets under `sports:<betId>`; user-service
   * dedupes on `(source, ref)`, so each such bet was counted twice. Take the `sports:` copy back
   * out wherever the plain `<betId>` row exists — once each, then nothing is left to match.
   */
  async #reverseDuplicates(limit) {
    const rows = await this.#query(
      `SELECT d.user_id, d.ref
         FROM public.wager_activity d
         JOIN public.wager_activity w ON w.source = d.source AND w.ref = substring(d.ref from 8) AND w.reversed_at IS NULL
        WHERE d.source = :source AND d.ref LIKE 'sports:%' AND d.reversed_at IS NULL
        ORDER BY d.id
        LIMIT :limit`,
      { source: SOURCE, limit }
    );
    let done = 0;
    for (const row of rows) {
      try {
        await this.clients.user.post('/internal/user/wager/reverse', { userId: Number(row.user_id), source: SOURCE, ref: row.ref });
        done += 1;
      } catch (error) {
        this.logger?.warn({ err: error, ref: row.ref }, 'Duplicate sports wager reversal failed — retried next sweep');
      }
    }
    return done;
  }

  async #reverseVoided(limit) {
    const rows = await this.#query(
      `SELECT w.user_id, w.ref
         FROM public.wager_activity w
         JOIN mssports."SportsBet" b ON b.id::text = w.ref
        WHERE w.source = :source AND w.reversed_at IS NULL AND b.result_status IN (:voided)
        ORDER BY w.id
        LIMIT :limit`,
      { source: SOURCE, voided: VOIDED, limit }
    );

    let done = 0;
    for (const row of rows) {
      try {
        await this.clients.user.post('/internal/user/wager/reverse', { userId: Number(row.user_id), source: SOURCE, ref: row.ref });
        done += 1;
      } catch (error) {
        this.logger?.warn({ err: error, betId: row.ref }, 'Sports wager reversal failed — retried next sweep');
      }
    }
    return done;
  }

  #query(sql, replacements) {
    return this.db.sequelize.query(sql, { replacements, type: this.db.QueryTypes.SELECT });
  }
}

module.exports = { SportsWagerSync, SOURCE };
