'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../affiliate.validators');
const { AffiliateService } = require('../affiliate.service');
const { createControllers } = require('../controllers');

/**
 * Affiliate administration.
 *
 * `POST /unlock` is here rather than on the player router on purpose: it
 * creates a payable, and the person who benefits from an unlock must not be the
 * one who triggers it. Legacy exposed the equivalent endpoint unauthenticated,
 * with the reward tier chosen from a number in the request body.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new AffiliateService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.REPORTS_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);

  router.get('/teams', canRead, validate(v.listTeams), ctrl.listTeams);
  router.get('/teams/:owner/members', canRead, validate(v.teamMembers), ctrl.teamMembers);
  router.get('/members', canRead, validate(v.listTeams), ctrl.usersWithTeams);
  router.get('/stats', canRead, ctrl.stats);
  router.get('/rewards', canRead, validate(v.listRewards), ctrl.listRewards);
  router.get('/top', canRead, validate(v.topAffiliates), ctrl.topAffiliates);

  router.post(
    '/unlock',
    canWrite,
    validate(v.unlock),
    withActivity({
      action: 'affiliate.unlock',
      describe: (req) => ({ targetType: 'AFFILIATE_MEMBER', targetId: req.body.memberName }),
    }),
    ctrl.unlock
  );

  router.post(
    '/rewards',
    canWrite,
    validate(v.recordReward),
    withActivity({
      action: 'affiliate.reward.record',
      describe: (req) => ({
        targetType: 'AFFILIATE_REWARD',
        targetId: req.body.memberName,
        details: { amount: req.body.amount, owner: req.body.ownerName },
      }),
    }),
    ctrl.recordReward
  );

  return router;
};
