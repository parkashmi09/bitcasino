'use strict';

const { QueryTypes } = require('sequelize');

const { WagerActivityService } = require('./wagerActivity.service');

/** Attempts before a row is given up on and marked `failed` (logged at `error`). */
const MAX_ATTEMPTS = Number(process.env.WAGER_REVERSE_OUTBOX_MAX_ATTEMPTS || 10);
/** First retry delay; doubles per attempt, capped at `MAX_DELAY_MS`. */
const BASE_DELAY_MS = 30 * 1000;
const MAX_DELAY_MS = 60 * 60 * 1000;

/** Delay before attempt `attempts + 1`: 30 s, 1 min, 2 min, … capped at 1 h. */
const backoffMs = (attempts) => Math.min(BASE_DELAY_MS * 2 ** Math.max(0, attempts - 1), MAX_DELAY_MS);

/**
 * Retries the stake reversals other services could not deliver (`wager_reverse_outbox`,
 * migration 090).
 *
 * sports-service (void after settlement) and casino-service (every refund / rollback /
 * cancel: GIS, x-casino, seamless, in-house) post
 * `/internal/user/wager/reverse` after their own commit, best-effort; a failed call is
 * written to the outbox instead of being lost. This job — in the user-service worker, next
 * to the code it calls — replays each due row through the same `WagerActivityService.reverse`
 * the route runs (no HTTP hop). The reverse is idempotent per `(source, ref[, refundRef])`, so
 * a row whose first call actually landed simply comes back `duplicate`, and a retry is
 * always safe.
 *
 * A row that throws is rescheduled with exponential backoff; after `MAX_ATTEMPTS` it is
 * marked `failed` and logged at `error` for an operator. A row that returns a refusal
 * (`USER_MISMATCH`, `EXCEEDS_STAKE`, …) is done — retrying would refuse again — with the
 * reason kept in `last_error`.
 */
class WagerReverseOutboxService {
  constructor(deps) {
    this.db = deps.db;
    this.logger = deps.logger;
    this.wager = deps.wagerActivity ?? new WagerActivityService(deps);
  }

  /** One pass over the due rows. @returns {{ picked, done, retried, failed }} */
  async retryPending({ limit = 100, now = new Date() } = {}) {
    const sequelize = this.db.sequelize;
    const rows = await sequelize.query(
      `SELECT id, origin, user_id, source, ref, amount, refund_ref, attempts
         FROM wager_reverse_outbox
        WHERE status = 'pending' AND next_attempt_at <= :now
        ORDER BY next_attempt_at ASC, id ASC
        LIMIT :limit`,
      { replacements: { now, limit }, type: QueryTypes.SELECT }
    );

    const out = { picked: rows.length, done: 0, retried: 0, failed: 0 };
    for (const row of rows) {
      const attempts = Number(row.attempts) + 1;
      try {
        const result = await this.wager.reverse({
          userId: row.user_id,
          source: row.source,
          ref: row.ref,
          amount: row.amount == null ? null : String(row.amount),
          refundRef: row.refund_ref || null,
        });
        await sequelize.query(
          `UPDATE wager_reverse_outbox
              SET status = 'done', attempts = :attempts, done_at = now(), updated_at = now(), last_error = :reason
            WHERE id = :id AND status = 'pending'`,
          { replacements: { id: row.id, attempts, reason: result?.reason ?? null } }
        );
        out.done += 1;
        this.logger?.info(
          { id: String(row.id), origin: row.origin, source: row.source, ref: row.ref, attempts, result: summarise(result) },
          'Queued wager reversal delivered'
        );
      } catch (error) {
        const giveUp = attempts >= MAX_ATTEMPTS;
        await sequelize.query(
          `UPDATE wager_reverse_outbox
              SET status = :status, attempts = :attempts, last_error = :error, updated_at = now(),
                  next_attempt_at = :next
            WHERE id = :id AND status = 'pending'`,
          {
            replacements: {
              id: row.id,
              attempts,
              status: giveUp ? 'failed' : 'pending',
              error: String(error?.message ?? error).slice(0, 500),
              next: new Date(now.getTime() + backoffMs(attempts)),
            },
          }
        );
        if (giveUp) {
          out.failed += 1;
          this.logger?.error(
            { err: error, id: String(row.id), origin: row.origin, userId: String(row.user_id), source: row.source, ref: row.ref, attempts },
            'Queued wager reversal failed for good — stake still counted. NEEDS MANUAL REVERSAL'
          );
        } else {
          out.retried += 1;
          this.logger?.warn(
            { err: error, id: String(row.id), source: row.source, ref: row.ref, attempts },
            'Queued wager reversal failed — will retry'
          );
        }
      }
    }
    return out;
  }
}

function summarise(result) {
  if (!result) return null;
  const { reversed, duplicate, partial, tombstone, reason } = result;
  return { reversed, duplicate, partial, tombstone, reason };
}

module.exports = { WagerReverseOutboxService, MAX_ATTEMPTS, backoffMs };
