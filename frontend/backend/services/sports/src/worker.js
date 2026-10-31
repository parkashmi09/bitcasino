'use strict';

const http = require('http');
const path = require('path');

const { loadModules, collectJobs, createHealthRouter } = require('@ibitplay/common');
const express = require('express');

const config = require('./config');
const { createContainer } = require('./container');

/**
 * Sports background worker.
 *
 * A separate process from the sports HTTP service, replacing the standalone
 * crons in `legacy/sportsmain/cron/`. The reasons it is separate:
 *
 *   1. The odds job runs every couple of seconds. Sharing an event loop with
 *      request handling means every bet placement queues behind a feed poll.
 *   2. Scaling is opposite: HTTP scales out to N instances, crons must
 *      effectively run once. Four HTTP instances would otherwise mean four
 *      settlement loops racing each other.
 *   3. A provider returning malformed JSON must not take down bet placement.
 *
 * It loads the SAME container and the SAME modules as the HTTP service, and
 * runs the `jobs` a module declares in its manifest. That is why settlement
 * logic lives in `settlement.service.js` and not in a controller — automatic
 * settlement and manual settlement run the same code, instead of the legacy
 * arrangement where the cron carried its own copy of the payout maths.
 *
 * `modules/feed` declares two, ported from `legacy/sportsmain/cron/`:
 *
 *   feed:events   60s   every active sport's board  → `alleventsData:<sportId>`
 *   feed:odds      2s   every live match's book     → `oddsData:<gmid>`
 *
 * The second reads the first's output to know which matches exist, which is why
 * the first is `immediate`.
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
      // same market is exactly the double-payout scenario.
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
        // A failing job must not kill the process — the other jobs still matter.
        logger.error({ err: error, module: moduleName, name, failures }, 'Job run failed');
      } finally {
        running = false;
      }
    };

    /**
     * `immediate` runs once before the first interval elapses.
     *
     * `feed:odds` reads what `feed:events` wrote, so on a cold start the odds
     * job finds nothing for a full sixty seconds unless the events job has
     * already run. Legacy did the same — both crons call themselves once
     * before their `setInterval`.
     *
     * Not awaited: a slow first run must not hold up scheduling the rest.
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
      serviceName: 'sports-worker',
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
  server.listen(config.SPORTS_WORKER_PORT || 4104, '127.0.0.1', () => {
    logger.info(
      { port: config.SPORTS_WORKER_PORT || 4104, jobs: timers.length },
      `sports-worker running with ${timers.length} job(s)`
    );
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'sports-worker shutting down');
    for (const { timer } of timers) clearInterval(timer);
    await new Promise((resolve) => server.close(resolve));
    await container.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('sports-worker failed to start:', error.message);
  if (error.name !== 'EnvValidationError') console.error(error.stack);
  process.exit(1);
});
