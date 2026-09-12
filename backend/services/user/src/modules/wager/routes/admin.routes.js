'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../wager.validators');
const { WagerService } = require('../wager.service');
const { createControllers } = require('../controllers');

/**
 * Wagering requirement administration.
 *
 * The bulk update is audited with the count it skipped, because "why is this
 * player still on 5x" is answered by knowing their lock was honoured.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new WagerService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();

  router.get('/', auth.requirePermission(PERMISSIONS.USERS_READ), validate(v.list), ctrl.list);
  router.get('/common', auth.requirePermission(PERMISSIONS.USERS_READ), ctrl.common);
  router.get('/:userId', auth.requirePermission(PERMISSIONS.USERS_READ), validate(v.userParam), ctrl.userProgress);

  router.post(
    '/:userId',
    auth.requirePermission(PERMISSIONS.USERS_WRITE),
    validate(v.setForUser),
    withActivity({
      action: 'wager.set-multiplier',
      describe: (req) => ({ targetType: 'USER', targetId: req.params.userId, details: { multiplier: req.body.multiplier } }),
    }),
    ctrl.setForUser
  );

  router.post(
    '/:userId/lock',
    auth.requirePermission(PERMISSIONS.USERS_WRITE),
    validate(v.setLock),
    withActivity({
      action: 'wager.set-lock',
      describe: (req) => ({ targetType: 'USER', targetId: req.params.userId, details: { locked: req.body.locked } }),
    }),
    ctrl.setLock
  );

  router.post(
    '/bulk/multiplier',
    auth.requirePermission(PERMISSIONS.USERS_WRITE),
    validate(v.setForAll),
    withActivity({
      action: 'wager.bulk-multiplier',
      describe: (req) => ({ targetType: 'PLATFORM', targetId: 'all', details: { multiplier: req.body.multiplier } }),
    }),
    ctrl.setForAll
  );

  return router;
};
