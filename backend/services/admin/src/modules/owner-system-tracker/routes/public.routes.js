'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { validate, noBody, response, asyncHandler, createRateLimiter, AppError, UnauthorizedError } = require('@ibitplay/common');

const v = require('../../exchange-accounts/exchangeAccounts.validators');
const { scanAllAccounts, getActiveAlerts } = require('../../exchange-accounts/systemTracker/scanner');
const { searchAccounts, buildAccountReport } = require('../../exchange-accounts/systemTracker/report');
const { buildProvenance } = require('../../exchange-accounts/systemTracker/provenance');
const { scanWatchdog, getActiveWatchdog, acknowledgeFinding } = require('../../exchange-accounts/systemTracker/watchdog');

/** Owner panel ki key — timing-safe compare (currencies /owner jaisa). */
function keyMatches(given, secret) {
  if (!secret || typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(String(secret)).digest();
  return crypto.timingSafeEqual(a, b);
}

/** System Tracker — sirf owner panel (`x-owner-key: <OWNER_SHARED_SECRET>`), warna 401. */
module.exports = function ownerTrackerRoutes(deps) {
  const { models, logger, config } = deps;
  const sequelize = models.Credits.sequelize;
  const router = Router();

  const limiter = createRateLimiter({
    name: 'owner:system-tracker',
    windowMs: 60_000,
    max: 120,
    enabled: config.RATE_LIMIT_ENABLED !== false,
  });

  router.use(limiter, (req, res, next) => {
    if (!keyMatches(req.get('x-owner-key'), config?.OWNER_SHARED_SECRET)) return next(new UnauthorizedError('Bad owner key'));
    res.set('Cache-Control', 'no-store');
    return next();
  });

  const ok = (fn) => asyncHandler(async (req, res) => response.ok(res, await fn(req, res)));

  router.get('/alerts', ok(() => getActiveAlerts(sequelize)));
  router.post('/scan', noBody(), ok(async () => ({ summary: await scanAllAccounts(sequelize, logger), ...(await getActiveAlerts(sequelize)) })));

  router.get('/watchdog', validate(v.watchdogList), ok((req) => getActiveWatchdog(sequelize, { includeResolved: req.query.all === '1' })));
  router.post('/watchdog/scan', noBody(), ok(async () => ({ summary: await scanWatchdog(sequelize, logger), ...(await getActiveWatchdog(sequelize)) })));
  router.post(
    '/watchdog/:id/acknowledge',
    validate(v.watchdogAck),
    ok(async (req) => {
      const finding = await acknowledgeFinding(sequelize, req.params.id, 'owner');
      if (!finding) throw new AppError('Finding not found or already resolved', 404, 'EXCHANGE_WATCHDOG_NOT_FOUND');
      return { finding };
    })
  );

  router.get('/search', validate(v.trackerSearch), ok(async (req) => ({ results: await searchAccounts(sequelize, req.query.q) })));
  router.get(
    '/:idOrUsername/provenance',
    validate(v.trackerAccount),
    ok(async (req) => {
      const report = await buildProvenance(sequelize, req.params.idOrUsername);
      if (!report.found) throw new AppError(report.error, 404, 'EXCHANGE_TRACKER_NOT_FOUND');
      return report;
    })
  );
  router.get(
    '/:idOrUsername',
    validate(v.trackerAccount),
    ok(async (req) => {
      const report = await buildAccountReport(sequelize, req.params.idOrUsername);
      if (!report.found) throw new AppError(report.error, 404, 'EXCHANGE_TRACKER_NOT_FOUND');
      return report;
    })
  );

  return router;
};
