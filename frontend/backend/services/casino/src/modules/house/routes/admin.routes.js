'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../house.validators');
const { HouseService } = require('../house.service');
const { createControllers } = require('../controllers');

/**
 * The house counters.
 *
 * Every legacy route here was unauthenticated, and four of the six WROTE —
 * two of them rewriting the whole table — over `GET`. A GET that mutates is
 * reachable by a prefetching browser, a crawler following a link, and
 * cross-site in ways a POST is not.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new HouseService(deps), logger });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.REPORTS_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);

  /** @legacy GET /gethouse */
  router.get('/', canRead, validate(v.list), ctrl.list);

  router.get('/ticker', canRead, ctrl.status);

  /**
   * @legacy GET /hour
   *
   *     server.get("/hour", function (req, res) {
   *       res.setHeader("Access-Control-Allow-Origin", "*");
   *       let hour = new Date().getHours();
   *       res.json({ hour });
   *     });
   *
   * The server's clock hour. Harmless, and kept because a client depends on
   * it — but `Access-Control-Allow-Origin: *` was set by hand on a route that
   * needs no cross-origin access at all, and the value was the SERVER's local
   * hour with no timezone, so a client could not tell what it meant. UTC and
   * the offset are both reported.
   */
  router.get('/clock', canRead, ctrl.clock);

  /** @legacy POST /updatehouse */
  router.post(
    '/',
    canWrite,
    validate(v.update),
    withActivity({
      action: 'house.update',
      describe: (req) => ({
        targetType: 'USER',
        targetId: req.body.userId,
        details: { max: req.body.max, current: req.body.current },
      }),
    }),
    ctrl.update
  );

  /** @legacy GET /reset-house, /win-house */
  router.post(
    '/bulk',
    canWrite,
    validate(v.bulkSet),
    withActivity({
      action: 'house.bulk-set',
      describe: (req) => ({
        targetType: 'HOUSE',
        // Which preset, and over how many — "all" means every player.
        details: { preset: req.body.preset, scope: req.body.scope, count: req.body.userIds?.length ?? null },
      }),
    }),
    ctrl.bulkSet
  );

  /** @legacy GET /start-house, /stop-house */
  router.post(
    '/ticker',
    canWrite,
    validate(v.ticker),
    withActivity({
      action: 'house.ticker',
      describe: (req) => ({ targetType: 'HOUSE', details: { running: req.body.running } }),
    }),
    ctrl.ticker
  );

  return router;
};
