'use strict';

const { RaceService } = require('./race.service');
const { RACE_TYPES } = require('./race.constants');

/**
 * The race's background work, as jobs the user-service worker runs.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A JOB AND NOT A CRON SCHEDULE
 *
 * The reference ran `node-cron` schedules — `0 0 * * *` for the daily roll and
 * `0 0 * * 1` for the weekly — from a file whose `start()` call was commented
 * out, under a pm2 process pointed at a directory that did not exist. It had
 * been stopped for three days before anyone noticed, and the only symptom was
 * a countdown on the site that had gone past zero while the leaderboard
 * happily served a window that closed on the Tuesday.
 *
 * Two things follow from that, and both are why this shape is different:
 *
 *   A ROLL IS NOT AN EVENT AT MIDNIGHT. It is a condition — "the open window
 *   has ended" — and checking a condition every few minutes is robust to the
 *   worker having been down at midnight. A missed cron tick is lost forever; a
 *   missed poll settles a few minutes late and catches up on its own. The
 *   fixed-time schedule is also what made the reference's two crons fire at
 *   the same instant every Monday, both running a full leaderboard build
 *   against one shared connection with no mutual exclusion.
 *
 *   IT MUST NOT BE POSSIBLE TO DEPLOY THIS UNSTARTED. `worker.js` collects
 *   jobs from every module's manifest. There is no separate process to point
 *   at a path, and no `start()` to remember to call.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * Settle any window that has ended, and open the one that should be running.
 *
 * Both race types, in series rather than in parallel — they share a connection
 * pool and each does a full leaderboard build, and the reference's two
 * simultaneous Monday-midnight settlements are the reason that is worth saying
 * out loud.
 */
function createRollJob(container) {
  const service = new RaceService(container);
  const { logger } = container;

  return async () => {
    for (const type of RACE_TYPES) {
      try {
        const { settled, opened } = await service.settleDue({ type });
        if (settled) logger?.info({ ...settled }, 'Race rolled');
        else if (opened) logger?.debug({ type, raceId: opened.id }, 'Race window present');
      } catch (error) {
        // One type failing must not stop the other: they are independent
        // promotions that happen to share a worker.
        logger?.error({ err: error, type }, 'Race roll failed');
      }
    }
  };
}

/**
 * Keep the operator's decorative entries positioned against the live board.
 *
 * A no-op unless booked seats are switched on, which they are not by default —
 * so on a deployment that does not use them this costs one config read per
 * race type per tick.
 */
function createBoatJob(container) {
  const service = new RaceService(container);
  const { logger } = container;

  return async () => {
    for (const type of RACE_TYPES) {
      try {
        await service.syncBoats({ type });
      } catch (error) {
        logger?.error({ err: error, type }, 'Race boat sync failed');
      }
    }
  };
}

module.exports = { createRollJob, createBoatJob };
