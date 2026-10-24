'use strict';

/**
 * The house ticker's on/off switch.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * `/start-house` LEAKED A CRON JOB EVERY TIME IT WAS CALLED
 *
 *     let task;
 *     const startAutomaticMode = () => {
 *       task = cron.schedule('* * * * *', async () => { … });
 *       task.start();
 *     };
 *     const stopAutomaticMode = () => { if (task) task.stop(); };
 *
 * Assigning to `task` does not stop the previous job — it is still scheduled,
 * and the only reference to it has just been overwritten, so nothing can ever
 * stop it. Call `/start-house` five times and five jobs run forever; `stop`
 * halts one of them.
 *
 * Each job did a full scan of `house` and one UPDATE per row, every minute, on
 * the single shared database connection. On an unauthenticated GET route.
 *
 * A singleton here: starting when already running is a no-op that says so, and
 * stopping actually stops the thing that is running.
 * ═════════════════════════════════════════════════════════════════════════
 */

/**
 * Module-level, because the process has exactly one ticker.
 *
 * Deliberately not per-request state: the bug above is what happens when the
 * handle lives somewhere a second call can overwrite.
 */
let handle = null;

function isRunning() {
  return handle !== null;
}

/**
 * @param {() => Promise<any>} tick
 * @param {{intervalMs: number, logger?: object}} options
 */
function start(tick, { intervalMs, logger }) {
  if (handle) {
    logger?.info('House ticker was already running — start is a no-op');
    return { running: true, changed: false };
  }

  handle = setInterval(() => {
    // A failing tick must not take the interval with it, and must not become
    // an unhandled rejection.
    Promise.resolve()
      .then(tick)
      .catch((error) => logger?.error({ err: error }, 'House ticker failed'));
  }, intervalMs);

  /**
   * `unref` so the ticker never holds the process open.
   *
   * Without it a service that has finished serving cannot exit, and a test run
   * hangs at the end with no indication why.
   */
  handle.unref?.();

  logger?.warn({ intervalMs }, 'House ticker STARTED');
  return { running: true, changed: true };
}

function stop({ logger } = {}) {
  if (!handle) return { running: false, changed: false };

  clearInterval(handle);
  handle = null;
  logger?.warn('House ticker STOPPED');
  return { running: false, changed: true };
}

module.exports = { start, stop, isRunning };
