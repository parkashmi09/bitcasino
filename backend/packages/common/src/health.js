'use strict';

const express = require('express');

/**
 * Health endpoints, split the way orchestrators actually use them:
 *
 *   GET /health/live   — is the process alive? Never touches dependencies.
 *                        A failing DB must not get the container killed.
 *   GET /health/ready  — can it serve traffic? Checks the DB and any declared
 *                        dependency; returns 503 so the load balancer drains it.
 *   GET /health        — human-readable summary of both.
 */
function createHealthRouter({ serviceName, version = '1.0.0', checks = {} } = {}) {
  const router = express.Router();
  const startedAt = Date.now();

  router.get('/health/live', (_req, res) => {
    res.status(200).json({ status: 'ok', service: serviceName, uptime: process.uptime() });
  });

  router.get('/health/ready', async (_req, res) => {
    const results = await runChecks(checks);
    const healthy = results.every((r) => r.status === 'ok');
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      service: serviceName,
      checks: results,
    });
  });

  router.get('/health', async (_req, res) => {
    const results = await runChecks(checks);
    const healthy = results.every((r) => r.status === 'ok');
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      service: serviceName,
      version,
      env: process.env.NODE_ENV || 'development',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      checks: results,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

async function runChecks(checks) {
  const entries = Object.entries(checks);
  return Promise.all(
    entries.map(async ([name, fn]) => {
      const start = Date.now();
      try {
        // A hung dependency must not hang the probe itself.
        const detail = await Promise.race([
          fn(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('check timed out')), 3_000)),
        ]);
        return { name, status: 'ok', latencyMs: Date.now() - start, ...(detail && typeof detail === 'object' ? detail : {}) };
      } catch (error) {
        return { name, status: 'error', latencyMs: Date.now() - start, error: error.message };
      }
    })
  );
}

module.exports = { createHealthRouter };
