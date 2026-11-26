'use strict';

const crypto = require('crypto');
const express = require('express');

/** Constant-time compare, so the key cannot be guessed a byte at a time. */
const sameKey = (given, expected) => {
  if (!given || !expected) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

/**
 * Platform health, aggregated.
 *
 * `/health/live`  — is the gateway process up? Never touches an upstream, so a
 *                   dead service cannot get the gateway container killed.
 * `/health/ready` — can the gateway serve traffic? 503 if every upstream is
 *                   down; a partial outage still returns 200, because routing
 *                   to the services that ARE up is exactly what should happen.
 * `/health`       — per-service detail, for a human or a dashboard. In production the
 *                   public answer is `{status}` only (security F11: no env, service
 *                   names or DB pool to strangers); the detail needs `x-internal-key`.
 *                   Same status code either way, so uptime probes are unaffected.
 */
function createHealthAggregator({ targets, config, logger }) {
  const router = express.Router();
  const names = Object.keys(targets);

  async function probe(name) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);

    try {
      const res = await fetch(`${targets[name]}/health`, { signal: controller.signal });
      const body = await res.json().catch(() => null);
      return {
        service: name,
        status: res.ok ? 'ok' : 'degraded',
        httpStatus: res.status,
        latencyMs: Date.now() - started,
        checks: body?.checks ?? null,
      };
    } catch (error) {
      return {
        service: name,
        status: 'down',
        latencyMs: Date.now() - started,
        error: error.name === 'AbortError' ? 'timeout' : error.message,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  router.get('/health/live', (_req, res) => {
    res.json({ status: 'ok', service: config.SERVICE_NAME, uptime: process.uptime() });
  });

  const showDetail = (req) =>
    config.NODE_ENV !== 'production' || sameKey(req.get('x-internal-key'), config.HEALTH_DETAIL_KEY);

  router.get('/health/ready', async (req, res) => {
    const results = await Promise.all(names.map(probe));
    const anyUp = results.some((r) => r.status === 'ok');
    const status = anyUp ? 'ok' : 'down';
    res.status(anyUp ? 200 : 503).json(showDetail(req) ? { status, services: results } : { status });
  });

  router.get('/health', async (req, res) => {
    const results = await Promise.all(names.map(probe));
    const healthy = results.every((r) => r.status === 'ok');

    if (!healthy) {
      logger?.warn({ down: results.filter((r) => r.status !== 'ok').map((r) => r.service) }, 'Upstream health degraded');
    }

    if (!showDetail(req)) return res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded' });

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      service: config.SERVICE_NAME,
      env: config.NODE_ENV,
      uptimeSeconds: Math.floor(process.uptime()),
      services: results,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

module.exports = { createHealthAggregator };
