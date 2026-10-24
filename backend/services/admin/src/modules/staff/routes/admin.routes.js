'use strict';

/**
 * Staff ke bache hue routes — sirf jo Sports Exchange aur panel use karte hain:
 *   POST  /transfer  paisa dena / lena (Sports Exchange ka Credit / Deposit / Withdraw)
 *   PATCH /password  apna password (My Account) ya kisi aur ka reset
 * Bahar wala agent system (list, create, edit, delete, tree, rollup…) hata diya —
 * agent / master ab sirf Sports Exchange se bante hain.
 */
const { Router } = require('express');
const { validate, createActivityRecorder, UnauthorizedError } = require('@ibitplay/common');
const { PERMISSIONS, markAuthorization } = require('@ibitplay/auth');

const v = require('../staff.validators');
const { StaffService } = require('../staff.service');
const { createControllers } = require('../controllers');

module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new StaffService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canWrite = auth.requirePermission(PERMISSIONS.STAFF_WRITE);
  const audit = (action, describe) => withActivity({ action, describe });

  /**
   * `PATCH /password`: your OWN password needs only a staff session; resetting
   * somebody else's needs `staff:write` (the service then checks authority over
   * the target). This was `staff:read`, which an agent (level 6) does not hold —
   * so a new agent, created with `must_change_password`, could never replace
   * its temporary password and was locked out of the panel for good.
   */
  const canChangePassword = markAuthorization(function canChangePasswordMiddleware(req, res, next) {
    if (!req.staff) return next(new UnauthorizedError('Staff authentication required'));
    const targetId = req.body?.targetId;
    const self = targetId === undefined || targetId === null || Number(targetId) === Number(req.staff.id);
    return self ? next() : canWrite(req, res, next);
  });

  /**
   * Moving money between accounts.
   *
   * A wallet grant, not `staff:write` — this is the one endpoint in the
   * module that changes a balance, and it should not be reachable by whoever
   * can rename an account. Legacy gated it on the same middleware as
   * everything else.
   *
   * The Super Admin (the platform owner, holding `wallet:adjust`) reaches any
   * account in scope and mints. EVERY other level — Admin and Sub Admin too —
   * reaches only a DIRECT CHILD STAFF account, out of its own float, with the
   * transaction password; the service enforces that
   * (`StaffService#assertParentFunding`).
   */
  router.post(
    '/transfer',
    auth.requireAnyPermission(PERMISSIONS.WALLET_ADJUST, PERMISSIONS.WALLET_CREDIT, PERMISSIONS.WALLET_DEBIT),
    validate(v.transfer),
    audit('staff.transfer', (req) => ({
      targetType: req.body.toType === 'user' ? 'USER' : 'STAFF',
      targetId: req.body.toId,
      details: { amount: req.body.amount, direction: req.body.direction },
    })),
    ctrl.transfer
  );

  router.patch(
    '/password',
    canChangePassword,
    validate(v.changePassword),
    audit('staff.password.change', (req) => ({
      targetType: 'STAFF',
      targetId: req.body.targetId ?? req.staff?.id,
      // Never the password itself, in either direction.
      details: { self: req.body.targetId === undefined },
    })),
    ctrl.changePassword
  );

  return router;
};
