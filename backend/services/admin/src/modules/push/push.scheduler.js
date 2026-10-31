'use strict';

const { PushService } = require('./push.service');

/**
 * Sends scheduled push campaigns when they fall due. One tick every
 * `intervalMs` (30 s); the claim inside `runDue` makes a second admin-service
 * process skip a campaign the first already took.
 */
function startPushScheduler(container, { intervalMs = 30_000 } = {}) {
  const service = new PushService(container);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await service.runDue();
    } catch (error) {
      // Table missing before the migration runs, DB blip: try again next tick.
      container.logger?.warn({ err: error.message }, 'Push scheduler tick failed');
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer), tick };
}

module.exports = { startPushScheduler };
