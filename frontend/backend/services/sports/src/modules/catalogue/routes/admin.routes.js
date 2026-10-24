'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../catalogue.validators');
const { CatalogueService } = require('../catalogue.service');
const { createControllers } = require('../controllers');

/**
 * Sport and fancy market administration.
 *
 * Every route here was unauthenticated in legacy. The fancy ones are the
 * expensive half: a control decides whether a market is bettable, so reopening
 * one on an event that has already played out is a bet on a known result. They
 * are audited for that reason — the change itself moves no money, and the money
 * it enables arrives later looking like an ordinary bet.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new CatalogueService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.SPORTS_READ);
  const canManage = auth.requirePermission(PERMISSIONS.SPORTS_MANAGE);
  const audit = (action, describe) => withActivity({ action, describe });

  // ── Sports ──────────────────────────────────────────────────────────
  router.get('/sports', canRead, validate(v.listSports), ctrl.listSports);
  router.get('/sports/:id', canRead, validate(v.sportParam), ctrl.getSport);

  router.post(
    '/sports',
    canManage,
    validate(v.addSport),
    audit('sports.config.add', (req) => ({
      targetType: 'SPORT', targetId: req.body.gameId, details: req.body,
    })),
    ctrl.addSport
  );

  router.put(
    '/sports/:id',
    canManage,
    validate(v.updateSport),
    audit('sports.config.update', (req) => ({
      targetType: 'SPORT', targetId: req.params.id, details: req.body,
    })),
    ctrl.updateSport
  );

  router.delete(
    '/sports/:id',
    canManage,
    validate(v.sportParam),
    audit('sports.config.delete', (req) => ({ targetType: 'SPORT', targetId: req.params.id })),
    ctrl.removeSport
  );

  // ── Fancy market controls ───────────────────────────────────────────
  router.get('/fancy', canRead, validate(v.listFancyControls), ctrl.listFancyControls);
  router.get('/fancy/event/:eventId', canRead, validate(v.eventParam), ctrl.fancyControlsForEvent);

  router.post(
    '/fancy',
    canManage,
    validate(v.setFancyStatus),
    audit('sports.fancy.set', (req) => ({
      targetType: 'FANCY_MARKET',
      targetId: req.body.marketId,
      details: { eventId: req.body.eventId, showFancy: req.body.showFancy },
    })),
    ctrl.setFancyStatus
  );

  router.post(
    '/fancy/bulk',
    canManage,
    validate(v.bulkSetFancyStatus),
    audit('sports.fancy.bulk-set', (req) => ({
      targetType: 'SPORTS_EVENT',
      targetId: req.body.eventId,
      details: {
        markets: req.body.markets.length,
        closing: req.body.markets.filter((m) => !m.showFancy).length,
      },
    })),
    ctrl.bulkSetFancyStatus
  );

  /**
   * Removing a control makes the market VISIBLE again — it returns to the
   * default rather than being hidden. Audited as the reopen it is.
   */
  router.delete(
    '/fancy/:marketId',
    canManage,
    validate(v.marketParam),
    audit('sports.fancy.remove', (req) => ({
      targetType: 'FANCY_MARKET', targetId: req.params.marketId,
    })),
    ctrl.removeFancyControl
  );

  return router;
};
