'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../access.validators');
const { AccessService } = require('../access.service');
const { createControllers } = require('../controllers');

/**
 * Sub-logins and their audit trail.
 *
 * Creating or editing one needs `roles:manage`, which is a larger grant than
 * `staff:write` — a sub-login carries authority, so minting one is closer to
 * editing a role than to renaming an account. Legacy gated every route here on
 * the same middleware as the read endpoints.
 *
 * Marketing accounts were "SuperAdmin only — enforced in the controller", which
 * meant a level check buried in a handler. They are behind the same permission
 * as everything else that grants authority.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new AccessService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.STAFF_READ);
  const canGrant = auth.requirePermission(PERMISSIONS.ROLES_MANAGE);
  const canAudit = auth.requirePermission(PERMISSIONS.AUDIT_READ);
  const audit = (action, describe) => withActivity({ action, describe });

  // Anyone with a staff token may ask what they themselves can do.
  router.get('/me/permissions', ctrl.myPermissions);

  // ── Executives ──────────────────────────────────────────────────────
  router.get('/executives', canRead, validate(v.listExecutives), ctrl.listExecutives);

  router.post(
    '/executives',
    canGrant,
    validate(v.createExecutive),
    audit('executive.create', (req) => ({
      targetType: 'EXECUTIVE',
      // The grant itself, because that is the part worth reconstructing later.
      details: { username: req.body.username, permissions: req.body.permissions },
    })),
    ctrl.createExecutive
  );

  router.patch(
    '/executives/:executiveId',
    canGrant,
    validate(v.updateExecutive),
    audit('executive.update', (req) => ({
      targetType: 'EXECUTIVE',
      targetId: req.params.executiveId,
      details: { permissions: req.body.permissions },
    })),
    ctrl.updateExecutive
  );

  router.patch(
    '/executives/:executiveId/password',
    canGrant,
    validate(v.resetPassword),
    // Never the password itself, in the body log or anywhere else.
    audit('executive.password.reset', (req) => ({
      targetType: 'EXECUTIVE', targetId: req.params.executiveId,
    })),
    ctrl.resetPassword
  );

  router.patch(
    '/executives/:executiveId/status',
    canGrant,
    validate(v.setStatus),
    audit('executive.status', (req) => ({
      targetType: 'EXECUTIVE',
      targetId: req.params.executiveId,
      details: { status: req.body.status },
    })),
    ctrl.setStatus
  );

  // ── Marketing accounts ──────────────────────────────────────────────
  router.get('/marketing-users', canRead, validate(v.listExecutives), ctrl.listMarketingUsers);

  router.post(
    '/marketing-users',
    canGrant,
    validate(v.createExecutive),
    audit('marketing.create', (req) => ({
      targetType: 'MARKETING',
      details: { username: req.body.username, permissions: req.body.permissions },
    })),
    ctrl.createMarketingUser
  );

  router.patch(
    '/marketing-users/:executiveId/password',
    canGrant,
    validate(v.resetPassword),
    audit('marketing.password.reset', (req) => ({
      targetType: 'MARKETING', targetId: req.params.executiveId,
    })),
    ctrl.resetPassword
  );

  router.patch(
    '/marketing-users/:executiveId/status',
    canGrant,
    validate(v.setStatus),
    audit('marketing.status', (req) => ({
      targetType: 'MARKETING',
      targetId: req.params.executiveId,
      details: { status: req.body.status },
    })),
    ctrl.setStatus
  );

  // ── Audit trail ─────────────────────────────────────────────────────
  router.get('/activity', canAudit, validate(v.allActivity), ctrl.activity);
  router.get('/executives/:executiveId/activity', canAudit, validate(v.activity), ctrl.executiveActivity);

  return router;
};
