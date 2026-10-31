'use strict';

const { RaffleService } = require('./raffle.service');

/**
 * Every five minutes: make any draw whose Sunday 00:00 UTC has passed, then credit any prize not
 * yet paid. A condition, not an event — a worker that was down at midnight draws late rather than
 * skipping a week. Failures are logged; the next tick tries again.
 */
function createDrawJob(container) {
  const service = new RaffleService(container);
  return async () => {
    try {
      await service.runDue();
    } catch (error) {
      container.logger?.error({ err: error }, 'Raffle draw job failed');
    }
  };
}

module.exports = { createDrawJob };
