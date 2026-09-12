'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../staff.validators');
const { StaffService } = require('../staff.service');
const { createControllers } = require('../controllers');

/**
 * The staff hierarchy.
 *
 * ── ROUTE ORDER IS LOad-BEARING HERE ─────────────────────────────────────
 *
 * Two legacy routes were unreachable because a parameter route was declared
 * before them:
 *
 *   `/transactions` was shadowed by `/:id`
 *   `/transfers/summary` was shadowed by `/transfers/:id?`
 *
 * Every literal path below is declared BEFORE any route with a parameter in
 * the same position, and the parameterised ones are last. That is the only
 * arrangement in which all of them are reachable.
 */
module.exports = function adminRoutes(deps) {
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new StaffService(deps) });

  const withActivity = createActivityRecorder({
    client: clients.admin, logger, serviceName: config.SERVICE_NAME,
  });

  const router = Router();
  const canRead = auth.requirePermission(PERMISSIONS.STAFF_READ);
  const canWrite = auth.requirePermission(PERMISSIONS.STAFF_WRITE);
  const audit = (action, describe) => withActivity({ action, describe });

  // ── Literal paths first ─────────────────────────────────────────────
  router.get('/', canRead, validate(v.listStaff), ctrl.list);
  router.get('/tree', canRead, ctrl.tree);
  router.get('/players', canRead, validate(v.listPlayers), ctrl.listPlayers);
  router.get('/transactions', canRead, validate(v.listTransfers), ctrl.transfers);
  router.get('/transfers/summary', canRead, validate(v.transferSummary), ctrl.transferSummary);
  router.get('/transfers', canRead, validate(v.listTransfers), ctrl.transfers);

  // ── Writes ──────────────────────────────────────────────────────────
  router.post(
    '/',
    canWrite,
    validate(v.createStaff),
    audit('staff.create', (req) => ({
      targetType: 'STAFF',
      details: { name: req.body.name, email: req.body.email, roleId: req.body.roleId },
    })),
    ctrl.create
  );

  /**
   * Moving money between accounts.
   *
   * Needs `wallet:adjust`, not `staff:write` — this is the one endpoint in the
   * module that changes a balance, and it should not be reachable by whoever
   * can rename an account. Legacy gated it on the same middleware as
   * everything else.
   */
  router.post(
    '/transfer',
    auth.requirePermission(PERMISSIONS.WALLET_ADJUST),
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
    canRead,
    validate(v.changePassword),
    audit('staff.password.change', (req) => ({
      targetType: 'STAFF',
      targetId: req.body.targetId ?? req.staff?.id,
      // Never the password itself, in either direction.
      details: { self: req.body.targetId === undefined },
    })),
    ctrl.changePassword
  );

  router.post(
    '/bulk-status',
    canWrite,
    validate(v.bulkStatus),
    audit('staff.bulk-status', (req) => ({
      details: { ids: req.body.ids, status: req.body.status },
    })),
    ctrl.bulkStatus
  );

  // ── Parameterised paths last ────────────────────────────────────────
  router.get('/rollup/:staffId', canRead, validate(v.rollup), ctrl.rollup);
  router.get('/analytics/:staffId', canRead, validate(v.analytics), ctrl.analytics);
  router.get('/transfers/:staffId', canRead, validate(v.listTransfersForStaff), ctrl.transfers);

  router.get('/:staffId', canRead, validate(v.staffParam), ctrl.getById);
  router.get('/:staffId/percent-chain', canRead, validate(v.staffParam), ctrl.percentChain);
  router.get('/:staffId/percent-tree', canRead, validate(v.staffParam), ctrl.percentTree);
  router.get('/:staffId/whatsapp-ref', canRead, validate(v.staffParam), ctrl.whatsappRef);

  router.patch(
    '/:staffId',
    canWrite,
    validate(v.updateStaff),
    audit('staff.update', (req) => ({
      targetType: 'STAFF', targetId: req.params.staffId, details: req.body,
    })),
    ctrl.update
  );

  router.delete(
    '/:staffId',
    canWrite,
    validate(v.staffParam),
    audit('staff.delete', (req) => ({ targetType: 'STAFF', targetId: req.params.staffId })),
    ctrl.remove
  );

  return router;
};
