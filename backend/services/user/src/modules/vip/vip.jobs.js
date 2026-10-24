'use strict';

const { VipService } = require('./vip.service');

/**
 * The VIP ladder's background work, as jobs the user-service worker runs.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * THIS MODULE DECLARED NO JOBS, AND ITS OWN ROUTE SAID OTHERWISE
 *
 * `routes/internal.routes.js` documents `/award-periodic` as a "manual / test
 * trigger for the same work the worker runs on an interval". There was no
 * such interval: the manifest had no `jobs` key, so the worker collected
 * nothing from this module and the only thing that ever wrote a periodic
 * award was a player loading the VIP page — `bonus.service.js#overview`
 * calls `awardPeriodic` for whoever is reading.
 *
 * That is the same class of fault the race jobs were written to avoid, in a
 * quieter form: not a `start()` nobody called, but a schedule that was only
 * ever described. A player who stopped visiting simply stopped accruing, and
 * nothing reported it, because the page they were not looking at was the
 * thing doing the work.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * Award whatever has come due, for everyone.
 *
 * One call — `sweepPeriodic` owns the batching and the eligibility test, so
 * the operator's manual trigger on `/internal/user/vip/award-periodic` and
 * this tick run the same code rather than two copies of "who is owed what".
 *
 * A failure is logged and swallowed: the awards are idempotent per period, so
 * the next tick simply tries again, and a bad sweep must not stop the other
 * jobs in the worker's loop.
 */
function createAwardPeriodicJob(container) {
  const service = new VipService(container);
  const { logger } = container;

  return async () => {
    try {
      const { scanned, eligible, awarded } = await service.sweepPeriodic();
      logger?.debug({ scanned, eligible, awarded }, 'Periodic VIP award sweep finished');
    } catch (error) {
      logger?.error({ err: error }, 'Periodic VIP award sweep failed');
    }
  };
}

module.exports = { createAwardPeriodicJob };
