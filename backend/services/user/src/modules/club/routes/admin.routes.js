'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../club.validators');
const { ClubService } = require('../club.service');
const { createControllers } = require('../controllers');

/**
 * Club administration.
 *
 * The earnings split is audited: those percentages decide what the platform
 * pays out on every wager a club generates, so a change to them is a change to
 * a liability.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new ClubService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.REPORTS_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);

  router.get('/', canRead, validate(v.listClubs), ctrl.listClubs);
  router.get('/owner/:ownerId', canRead, validate(v.ownerParam), ctrl.ownerProfile);
  router.get('/:clubId', canRead, validate(v.clubParam), ctrl.getClub);
  router.get('/:clubId/members', canRead, validate(v.listMembers), ctrl.members);
  router.get('/:clubId/earnings', canRead, validate(v.earningsLog), ctrl.earningsLog);

  router.put(
    '/:clubId',
    canWrite,
    validate(v.updateClub),
    withActivity({
      action: 'club.update',
      describe: (req) => ({ targetType: 'CLUB', targetId: req.params.clubId, details: req.body }),
    }),
    ctrl.adminUpdate
  );

  router.put(
    '/:clubId/earnings-config',
    canWrite,
    validate(v.earningsConfig),
    withActivity({
      action: 'club.earnings-config',
      describe: (req) => ({ targetType: 'CLUB', targetId: req.params.clubId, details: req.body }),
    }),
    ctrl.adminSetEarningsConfig
  );

  router.delete(
    '/:clubId',
    canWrite,
    validate(v.clubParam),
    withActivity({
      action: 'club.delete',
      describe: (req) => ({ targetType: 'CLUB', targetId: req.params.clubId }),
    }),
    ctrl.adminRemove
  );

  return router;
};
