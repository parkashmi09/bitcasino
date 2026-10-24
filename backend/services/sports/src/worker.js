'use strict';

const http = require('http');
const path = require('path');
const { fork } = require('child_process');

const { loadModules, collectJobs, createHealthRouter, createLogger } = require('@ibitplay/common');
const express = require('express');

const config = require('./config');

/**
 * Sports background worker.
 *
 * The sportsbook's background work is the four mssports workers, each its own process in TENEXCH
 * (pm2) and each still its own process here:
 *
 *   odds         modules/odds-events/workers/odds        odds cron
 *   events       modules/odds-events/workers/events      event list cron → Redis alleventss:{sid}
 *   results      modules/settlement/workers/results      results API → settlement job rows
 *   settlement   modules/settlement/workers/settlement   job rows → payout (EXACTLY ONE)
 *
 * A module declares them in its manifest under `workers` (`{ name, script, env?, maxRestarts? }`),
 * the way it declares `jobs`; this process forks one child per declaration, restarts a child that
 * exits (with backoff, up to `maxRestarts` in a row, as pm2 did), and stops them all on shutdown.
 * Each worker schedules itself exactly as it did under pm2 — none of their code knows it moved.
 *
 * Module `jobs` (in-process interval jobs) still run here too, the platform's usual way.
 *
 * Health: GET /health on SPORTS_WORKER_PORT, with every child's pid / restarts / state.
 */
async function main() {
  const logger = createLogger({ name: 'sports-worker', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY });

  const modules = loadModules(path.join(__dirname, 'modules'), { logger });
  const children = [];
  const timers = [];
  let stopping = false;

  // ── the mssports workers ────────────────────────────────────────────
  for (const manifest of modules) {
    for (const decl of manifest.workers || []) {
      const env = { ...process.env, ...(typeof decl.env === 'function' ? decl.env() : decl.env || {}) };
      const child = {
        module: manifest.name,
        name: decl.name,
        maxRestarts: decl.maxRestarts ?? 10,
        proc: null,
        starts: 0,
        restartsInARow: 0,
        lastExit: null,
        startedAt: null,
      };

      const start = () => {
        child.starts += 1;
        child.startedAt = Date.now();
        child.proc = fork(decl.script, [], { env, cwd: path.dirname(decl.script), stdio: 'inherit' });
        logger.info({ worker: child.name, pid: child.proc.pid }, `mssports ${child.name} worker started`);

        child.proc.on('exit', (code, signal) => {
          child.lastExit = { code, signal, at: new Date().toISOString() };
          child.proc = null;
          if (stopping) return;
          // A worker that ran for a minute is healthy again; count only quick crashes.
          child.restartsInARow = Date.now() - child.startedAt > 60_000 ? 1 : child.restartsInARow + 1;
          if (child.restartsInARow > child.maxRestarts) {
            logger.error({ worker: child.name, code, signal }, `mssports ${child.name} worker keeps exiting — not restarting`);
            return;
          }
          const delay = Math.min(30_000, 1_000 * 2 ** (child.restartsInARow - 1));
          logger.warn({ worker: child.name, code, signal, delay }, `mssports ${child.name} worker exited — restarting`);
          setTimeout(() => { if (!stopping) start(); }, delay).unref();
        });
      };

      start();
      children.push(child);
    }
  }

  // ── module jobs (in-process) ────────────────────────────────────────
  const jobs = collectJobs(modules);
  if (jobs.length) {
    const { createContainer } = require('./container');
    const container = await createContainer({ logger });
    for (const { module: moduleName, name, intervalMs, run } of jobs) {
      let running = false;
      const timer = setInterval(async () => {
        if (running) return;
        running = true;
        try {
          await run(container);
        } catch (error) {
          logger.error({ err: error, module: moduleName, name }, 'Job run failed');
        } finally {
          running = false;
        }
      }, intervalMs);
      timer.unref();
      timers.push(timer);
    }
  }

  // ── health ──────────────────────────────────────────────────────────
  const app = express();
  app.use(
    createHealthRouter({
      serviceName: 'sports-worker',
      checks: {
        workers: async () => {
          const detail = children.map((c) => ({
            module: c.module,
            name: c.name,
            running: Boolean(c.proc),
            pid: c.proc?.pid ?? null,
            starts: c.starts,
            lastExit: c.lastExit,
          }));
          const down = detail.filter((d) => !d.running).map((d) => d.name);
          if (down.length) throw new Error(`mssports worker(s) not running: ${down.join(', ')}`);
          return { running: detail.length, detail };
        },
      },
    })
  );

  const server = http.createServer(app);
  server.listen(config.SPORTS_WORKER_PORT, '127.0.0.1', () => {
    logger.info({ port: config.SPORTS_WORKER_PORT, workers: children.map((c) => c.name) },
      `sports-worker running ${children.length} mssports worker(s)`);
  });

  const shutdown = async (signal) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'sports-worker shutting down');
    for (const timer of timers) clearInterval(timer);
    await Promise.all(
      children.filter((c) => c.proc).map((c) => new Promise((resolve) => {
        const kill = setTimeout(() => c.proc?.kill('SIGKILL'), 10_000);
        c.proc.once('exit', () => { clearTimeout(kill); resolve(); });
        c.proc.kill('SIGTERM');
      }))
    );
    await new Promise((resolve) => server.close(resolve));
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
