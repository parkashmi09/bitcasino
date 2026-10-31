'use strict';

const { AppError, isProviderCallback } = require('@ibitplay/common');

/**
 * Whitelabel maintenance (WHITELABEL_MODE only): the parent site switched this copy OFF.
 *
 * Players and staff get 503 SITE_MAINTENANCE. Still open: provider callbacks and payment webhooks
 * (open casino rounds and deposits must settle), the link's status / preview-redeem routes, the
 * public branding read (logo on the maintenance screen) and the parent's read-only preview.
 * Workers call the services directly, not through here, so settlement and feeds keep running.
 *
 * The flag lives in admin-service (modules/whitelabel-link), read every `pollMs`. An unreadable
 * flag keeps the last value read.
 */
const STATUS_PATH = '/api/v1/admin/whitelabel-link/status';
const LINK_PREFIX = '/api/v1/admin/whitelabel-link/';
const BRANDING_READ = /^\/api\/v1\/admin\/branding\/(public|asset\/)/;

const maintenanceError = () =>
  new AppError('This site is under maintenance. Please try again later.', 503, 'SITE_MAINTENANCE');

function stillOpen(req) {
  const path = String(req.path || '');
  if (path.startsWith('/health') || path.startsWith(LINK_PREFIX) || isProviderCallback(path)) return true;
  if (req.method === 'GET' && BRANDING_READ.test(path)) return true;
  return req.identity?.kind === 'staff' && req.identity.readOnly === true;
}

function createMaintenanceGate({ config, logger, fetchImpl = globalThis.fetch, pollMs = 5_000 }) {
  let on = false;

  async function poll() {
    try {
      const res = await fetchImpl(`${config.ADMIN_SERVICE_URL}${STATUS_PATH}`, { signal: AbortSignal.timeout(3_000) });
      if (!res.ok) return;
      const next = (await res.json())?.data?.maintenance === true;
      if (next !== on) logger?.warn({ maintenance: next }, 'Whitelabel maintenance changed');
      on = next;
    } catch (error) {
      logger?.warn({ err: error.message }, 'Whitelabel maintenance flag unreadable; keeping the last value');
    }
  }

  const timer = setInterval(poll, pollMs);
  timer.unref?.();
  const ready = poll();

  function gate(req, _res, next) {
    return next(on && !stillOpen(req) ? maintenanceError() : undefined);
  }
  gate.ready = ready;
  gate.poll = poll;
  gate.stop = () => clearInterval(timer);
  return gate;
}

module.exports = { createMaintenanceGate, stillOpen };
