'use strict';

/**
 * The result scanner.
 *
 * @legacy sportsmain/cron/job.js — `runOnce`, on a 60s `setInterval`.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHAT IT IS
 *
 * Settlement is TWO jobs, not one, and this is the first. It never moves money.
 * Every 60 seconds it walks every bet still `open` or `manual`, asks the result
 * feed whether that bet's market has been declared, and for the ones that have,
 * writes a row into `sports_event_settlement_jobs` and stamps the resulting
 * `job_id` back onto the bet.
 *
 * The second job (`settlement.payout.job.js`) is the only thing that reads that
 * queue. A bet with no `job_id` is a bet the payout worker will never see —
 * which is precisely the state every open bet on this platform was in, because
 * neither cron was ported when the service was split.
 *
 * ── ONE PROVIDER CALL PER BET ────────────────────────────────────────────
 *
 * Not per market, not per event — per BET. Six open bets on one match means six
 * calls for the same `gmid`. Legacy did this and it is preserved: batching the
 * calls would change which bets are considered declared in a given tick, and
 * the whole point of this file is to be the legacy behaviour, running.
 *
 * ── `status = 'manual'` SKIPS THE FEED ───────────────────────────────────
 *
 * An operator declaring a result through the admin panel moves the bets to
 * `manual` (see `settlement.service.js` `declareResult`). This job treats that
 * status as "declared" without asking the provider, so the queue row is written
 * and the payout worker picks the winner out of `mannual_result` instead.
 * ═════════════════════════════════════════════════════════════════════════
 */

const crypto = require('crypto');

const { ResultsClient } = require('./settlement.resultsClient');
const { BET_STATUS } = require('./settlement.constants');

/** @legacy job.js `uuidv4` */
function uuidv4() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

/**
 * @legacy job.js `pruneSummaries` / `pruneBetCache`
 *
 * The summary table gets one row per bet per tick — 60 rows an hour per open
 * bet — so it is trimmed on every run rather than growing until someone
 * notices. Retentions are the legacy constants: 7 days and 14 days.
 */
async function prune({ models, Op, config, logger }) {
  const cutoff = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    await models.SportsEventResultSummary.destroy({
      where: { recorded_at: { [Op.lt]: cutoff(config.SPORTS_SUMMARY_RETENTION_DAYS) } },
    });
  } catch (error) {
    logger?.error({ err: error }, '[ResultCron] pruneSummaries failed');
  }

  try {
    await models.SportsBetResultCache.destroy({
      where: { recorded_at: { [Op.lt]: cutoff(config.SPORTS_BET_CACHE_TTL_DAYS) } },
    });
  } catch (error) {
    logger?.error({ err: error }, '[ResultCron] pruneBetCache failed');
  }
}

/**
 * Enqueue (or re-touch) the settlement job for one declared bet.
 *
 * @legacy job.js — `INSERT ... ON CONFLICT (user_id, eventid, bet_id)
 *                  DO UPDATE SET updated_at = NOW() RETURNING job_id`
 *
 * The upsert is deliberate and its RETURNING is load-bearing: on a repeat tick
 * the EXISTING `job_id` must come back, not a new one, or the bet would be
 * re-stamped with an id no queue row carries. Sequelize's `upsert()` would
 * overwrite every column, so this is the find-then-create form, with the unique
 * violation caught in case two workers race — the loser re-reads the winner's
 * row, which is what `ON CONFLICT` did.
 */
async function enqueueSettlementJob({ models, UniqueConstraintError }, { userId, eid, betIdStr, betType, payload }) {
  const where = { user_id: String(userId), eventid: String(eid), bet_id: betIdStr };

  const existing = await models.SportsEventSettlementJobs.findOne({ where });
  if (existing) {
    await existing.update({ updated_at: new Date() });
    return existing.job_id;
  }

  try {
    const created = await models.SportsEventSettlementJobs.create({
      job_id: uuidv4(),
      ...where,
      bet_type: betType,
      status: 'queued',
      priority: 5,
      run_after: new Date(),
      payload,
    });
    return created.job_id;
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      const raced = await models.SportsEventSettlementJobs.findOne({ where });
      if (raced) {
        await raced.update({ updated_at: new Date() });
        return raced.job_id;
      }
    }
    throw error;
  }
}

/**
 * @legacy job.js `runOnce`
 *
 * One pass over every open/manual bet. A bet that throws is logged and skipped
 * — one unparseable row must not stop the other five hundred from settling.
 */
function createResultsJob(container) {
  const { models, db, config, logger } = container;
  const { Op, Sequelize } = db;
  const results = new ResultsClient({ config, logger });

  return async function runOnce() {
    logger?.info('[ResultCron] ===== Run start =====');

    try {
      const allBets = await models.SportsBet.findAll({
        attributes: [
          'id', 'user_id', 'game_type', 'bet_type', 'selection_name', 'odds', 'stake_amount',
          'match_title', 'match_id', 'fancy_name', 'eventid', 'created_at',
          'sport_id', 'market_type', 'status',
        ],
        where: {
          status: { [Op.in]: [BET_STATUS.OPEN, BET_STATUS.MANUAL] },
          game_type: { [Op.in]: ['MO', 'BM', 'FAN'] },
          eventid: { [Op.ne]: null },
        },
        order: [['created_at', 'ASC']],
        raw: true,
      });

      if (!allBets.length) {
        logger?.info('[ResultCron] no open bets.');
        return;
      }

      logger?.info({ bets: allBets.length }, '[ResultCron] scanning open bets');

      for (const b of allBets) {
        try {
          const userId = b.user_id;
          const eid = b.eventid;
          const eventName = b.match_title || '';
          const gameType = (b.game_type || '').toUpperCase();

          const sport_id = b.sport_id;
          const market_type = b.market_type;

          let marketName = b.selection_name || '';

          if (gameType === 'MO') marketName = 'Match_Odds';
          if (gameType === 'BM') marketName = 'BookMaker';

          let declared = false;
          let result_meta = null;

          if (b.status === BET_STATUS.MANUAL) {
            declared = true;
          } else {
            const res = await results.fetchResultForScan(
              eid,
              eventName,
              b.match_id,
              marketName,
              sport_id,
              market_type,
              gameType
            );

            declared = res?.declared;
            result_meta = res?.meta;
          }

          const counts = { total: 1 };

          // `ON CONFLICT (user_id, eventid) DO UPDATE` — the scan table holds
          // one row per player per event, overwritten each tick.
          await models.SportsEventResultScan.upsert({
            user_id: String(userId),
            eventid: String(eid),
            declared,
            counts,
            checked_at: new Date(),
          });

          await models.SportsEventResultSummary.create({
            user_id: String(userId),
            eventid: String(eid),
            declared,
            counts,
            result_meta: result_meta || null,
            sections: { bets: [b] },
            recorded_at: new Date(),
          });

          if (declared) {
            const betIdStr = String(b.id);
            const betType = (b.bet_type || '').toLowerCase();

            const payload = {
              user_id: userId,
              eventid: eid,
              bet_id: betIdStr,
              bet_type: betType,
              bet: b,
            };

            const realJobId = await enqueueSettlementJob(
              { models, UniqueConstraintError: Sequelize.UniqueConstraintError },
              { userId, eid, betIdStr, betType, payload }
            );

            await models.SportsBet.update(
              { job_id: realJobId },
              {
                where: {
                  id: b.id,
                  user_id: userId,
                  eventid: eid,
                  status: { [Op.in]: [BET_STATUS.OPEN, BET_STATUS.MANUAL] },
                },
              }
            );

            logger?.debug({ betId: b.id, jobId: realJobId }, '[ResultCron] bet queued for settlement');
          }
        } catch (err) {
          logger?.error({ betId: b.id, error: err.message }, '[ResultCron] error processing bet');
        }
      }

      await prune({ models, Op, config, logger });
    } catch (e) {
      logger?.error({ error: e.message }, '[ResultCron] fatal');
    }

    logger?.info('[ResultCron] ===== Run end =====');
  };
}

module.exports = { createResultsJob, enqueueSettlementJob };
