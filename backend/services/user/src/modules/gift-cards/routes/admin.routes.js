'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder, noBody } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree } = require('@ibitplay/auth');

const v = require('../giftCards.validators');
const { GiftCardsService } = require('../giftCards.service');
const { createControllers } = require('../controllers');

/**
 * Gift card administration.
 *
 * Creating and deleting are audited: a gift card is an instruction to pay every
 * eligible player a fixed amount, so it is one of the few configuration changes
 * whose blast radius is measured in money rather than in screens.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new GiftCardsService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  // Promotions are house business: SUPER_MASTER / MASTER / AGENT (and their
  // executives) are refused every route below — PROMOTIONS_NOT_FOR_AGENTS.
  router.use(denyAgentTree());
  const canRead = auth.requirePermission(PERMISSIONS.REPORTS_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);

  router.get('/', canRead, validate(v.listing), ctrl.list);
  router.get('/analytics', canRead, ctrl.analytics);
  router.get('/records', canRead, validate(v.records), ctrl.records);
  router.post('/search', canRead, validate(v.search), ctrl.search);

  router.post(
    '/',
    canWrite,
    validate(v.create),
    withActivity({
      action: 'giftcard.create',
      describe: (req) => ({
        targetType: 'GIFT_CARD',
        targetId: req.body.uniqueKey,
        details: { amount: req.body.amount, allUsers: req.body.allUsers },
      }),
    }),
    ctrl.create
  );

  router.delete(
    '/:id',
    noBody(),
    canWrite,
    validate(v.idParam),
    withActivity({
      action: 'giftcard.delete',
      describe: (req) => ({ targetType: 'GIFT_CARD', targetId: req.params.id }),
    }),
    ctrl.remove
  );

  return router;
};
