'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../notifications.validators');
const { NotificationsService } = require('../notifications.service');
const { createControllers } = require('../controllers');

/**
 * Sending pushes, and reading what was sent.
 *
 * The broadcast is the one that matters. Legacy served it with NO middleware:
 * anyone who could reach the port could push a message of their own writing to
 * every registered device on the platform, from the operator's own app. It
 * needs `config:write` here, is scoped to the caller's tree, is bounded, and is
 * audited — an operator will want to reconstruct exactly what went out.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new NotificationsService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.USERS_READ);
  const canSend = auth.requirePermission(PERMISSIONS.CONFIG_WRITE);

  router.get('/devices', canRead, validate(v.listDevices), ctrl.listDevices);
  router.get('/history/:userId', canRead, validate(v.userParam), ctrl.history);
  router.get('/unread/:userId', canRead, validate(v.userParam), ctrl.unreadCount);

  router.post(
    '/send',
    canSend,
    validate(v.sendToUser),
    withActivity({
      action: 'notification.send',
      describe: (req) => ({
        targetType: 'USER',
        targetId: req.body.userId,
        // The message itself, because "what did we tell them" is the question.
        details: { title: req.body.title, type: req.body.type },
      }),
    }),
    ctrl.sendToUser
  );

  router.post(
    '/broadcast',
    canSend,
    validate(v.broadcast),
    withActivity({
      action: 'notification.broadcast',
      describe: (req) => ({
        targetType: 'BROADCAST',
        details: { title: req.body.title, body: req.body.body, type: req.body.type },
      }),
    }),
    ctrl.broadcast
  );

  return router;
};
