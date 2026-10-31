'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../players.validators');
const { PlayersService } = require('../players.service');
const { createControllers } = require('../controllers');

/**
 * Player accounts.
 *
 * All three are audited, and the close carries its reason into the audit row —
 * legacy recorded that a delete happened and nothing about why, for an action
 * that destroyed the player's entire financial history.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new PlayersService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canWrite = auth.requirePermission(PERMISSIONS.USERS_WRITE);

  /** @legacy POST /api/staff/players */
  router.post(
    '/',
    canWrite,
    validate(v.create),
    withActivity({
      action: 'user.create',
      describe: (req) => ({
        targetType: 'USER',
        details: {
          // The password is NOT here. Legacy's `describe` named `username` and
          // `email` too, but its handler logged `req.body` whole a line later.
          username: req.body.username,
          email: req.body.email ?? null,
          openingBalance: req.body.initialBalance,
        },
      }),
    }),
    ctrl.create
  );

  /** @legacy PATCH /api/staff/players/:id */
  router.patch(
    '/:playerId',
    canWrite,
    validate(v.update),
    withActivity({
      action: 'user.update',
      describe: (req) => ({
        targetType: 'USER',
        targetId: req.params.playerId,
        details: {
          // WHICH fields, never their values — a password change is recorded as
          // having happened, not as what it was changed to.
          fields: Object.keys(req.body),
          passwordChanged: Boolean(req.body.password),
        },
      }),
    }),
    ctrl.update
  );

  /**
   * @legacy DELETE /api/staff/players/:id
   *
   * Closes and anonymises. It does NOT delete the financial record — see the
   * module header for what legacy's version reached.
   */
  router.delete(
    '/:playerId',
    canWrite,
    validate(v.close),
    withActivity({
      action: 'user.close',
      describe: (req) => ({
        targetType: 'USER',
        targetId: req.params.playerId,
        details: { reason: req.body.reason },
      }),
    }),
    ctrl.close
  );

  return router;
};
