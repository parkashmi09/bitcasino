'use strict';

const http = require('http');
const path = require('path');

const { loadModules, collectJobs, createHealthRouter } = require('@ibitplay/common');
const express = require('express');

const config = require('./config');
const { createContainer } = require('./container');

/**
 * The user-service background worker.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * WHY A SEPARATE PROCESS, AND WHY IT IS NOT A CRON
 *
 * The same three reasons sports-worker exists, plus a fourth this platform
 * learned the hard way.
 *
 *   IT MUST RUN ONCE. The HTTP service scales out; a settlement loop must not.
 *   Four instances would mean four races settling the same window — survivable
 *   here only because the unique constraints make it so, which is not a reason
 *   to do it.
 *
 *   IT IS SLOW AND BURSTY. Settling a race builds two full leaderboards across
 *   four bet tables and writes every prize. Sharing an event loop with request
 *   handling puts sign-ins behind that once a day.
 *
 *   A FAILING JOB MUST NOT TAKE DOWN THE API. The loop below logs and carries
 *   on; nothing a job does can stop a player logging in.
 *
 *   AND IT MUST NOT BE POSSIBLE TO DEPLOY IT UNSTARTED. The implementation the
 *   race is ported from ran `node-cron` from a file whose `start()` was
 *   commented out, under a process manager entry pointing at a directory that
 *   did not exist. It had been dead for three days; the only symptom was a
 *   countdown that had run past zero while the leaderboard served a window
 *   that closed on Tuesday. Jobs are declared in module manifests and collected
 *   here — there is no path to point at and no start to remember.
 * ═════════════════════════════════════════════════════════════════════════
 *
 * It loads the SAME container and the SAME modules as the HTTP service, and
 * runs the `jobs` a module declares. That is why settlement lives in
 * `race.service.js` and not here: the automatic roll and an operator's manual
 * settle are the same code, rather than two copies of the payout maths.
 */
async function main() {
  const container = await createContainer();
  const { logger, db } = container;

  const modules = loadModules(path.join(__dirname, 'modules'), { logger });
  const jobs = collectJobs(modules);

  const timers = [];

  for (const job of jobs) {
    const { module: moduleName, name, intervalMs, run, immediate = false } = job;

    if (typeof run !== 'function' || !intervalMs) {
      logger.warn({ module: moduleName, name }, 'Skipping malformed job declaration');
      continue;
    }

    let running = false;
    let runs = 0;
    let failures = 0;

    const tick = async () => {
      // Never let a slow run overlap itself — two settlement passes over the
      // same race is the double-payout scenario the constraints exist to catch,
      // and catching it is not the same as not causing it.
      if (running) {
        logger.warn({ module: moduleName, name }, 'Previous run still in progress — skipping this tick');
        return;
      }
      running = true;
      try {
        await run(container);
        runs += 1;
      } catch (error) {
        failures += 1;
        logger.error({ err: error, module: moduleName, name, failures }, 'Job run failed');
      } finally {
        running = false;
      }
    };

    /**
     * `immediate` runs once before the first interval elapses.
     *
     * The race roll wants it: a worker restarted at 00:03 should not leave the
     * platform without an open window until 00:05. Not awaited — a slow first
     * run must not hold up scheduling the rest.
     */
    if (immediate) tick();

    const timer = setInterval(tick, intervalMs);
    timer.unref();
    timers.push({ module: moduleName, name, timer, stats: () => ({ runs, failures, running }) });

    logger.info({ module: moduleName, name, intervalMs }, 'Job scheduled');
  }

  // Health only — the worker serves no API.
  const app = express();
  app.use(
    createHealthRouter({
      serviceName: 'user-worker',
      checks: {
        database: () => db.ping(),
        jobs: async () => ({
          scheduled: timers.length,
          detail: timers.map((t) => ({ module: t.module, name: t.name, ...t.stats() })),
        }),
      },
    })
  );

  const server = http.createServer(app);
  server.listen(config.USER_WORKER_PORT || 4101, '127.0.0.1', () => {
    logger.info(
      { port: config.USER_WORKER_PORT || 4101, jobs: timers.length },
      `user-worker running with ${timers.length} job(s)`
    );
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'user-worker shutting down');
    for (const { timer } of timers) clearInterval(timer);
    await new Promise((resolve) => server.close(resolve));
    await container.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('user-worker failed to start:', error.message);
  if (error.name !== 'EnvValidationError') console.error(error.stack);
  process.exit(1);
});
