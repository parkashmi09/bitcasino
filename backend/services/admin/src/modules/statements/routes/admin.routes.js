'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../statements.validators');
const { StatementsService } = require('../statements.service');
const { createControllers } = require('../controllers');

/**
 * Statements, on screen and in print.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ROUTE ORDER IS LOad-BEARING HERE
 *
 * Legacy's own comment on the matter:
 *
 *     // The literal `/user/` prefix must be declared before the `/:staffId`
 *     // patterns.
 *
 * It is right, and it got that right — unlike `/api/staff/transactions` behind
 * `/:id` and `/transfers/summary` behind `/transfers/:id?`, both of which this
 * port found shadowed. The literal segments come first below for the same
 * reason: `/user/7/statement` would otherwise match `/:staffId/statement` with
 * `staffId = 'user'`, and the coercion in the validator would reject it as a
 * 400 rather than serving the player's statement.
 * ─────────────────────────────────────────────────────────────────────────
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const ctrl = createControllers({ service: new StatementsService(deps) });

  const router = Router();
  /**
   * Reading a statement is reading money. `reports:read` rather than
   * `users:read` — legacy required only that the caller be authenticated at
   * all, with the hierarchy check inside each handler doing the real work.
   * That check is still there; this is the coarse gate in front of it.
   */
  const canRead = auth.requirePermission(PERMISSIONS.REPORTS_READ);

  // ── player ────────────────────────────────────────────────────────────
  router.get('/user/:userId/statement', canRead, validate(v.userStatement), ctrl.userStatement);
  router.get('/user/:userId/bets', canRead, validate(v.userBets), ctrl.userBets);
  router.get('/user/:userId/pdf', canRead, validate(v.userPdf), ctrl.userPdf);

  // ── agent ─────────────────────────────────────────────────────────────
  router.get('/:staffId/statement', canRead, validate(v.agentStatement), ctrl.agentStatement);
  router.get('/:staffId/bets', canRead, validate(v.agentBets), ctrl.agentBets);
  router.get('/:staffId/pdf', canRead, validate(v.agentPdf), ctrl.agentPdf);

  /**
   * @legacy GET /api/admin/agent-report/:staffId
   *
   * Declared last so it cannot capture the three literal suffixes above.
   */
  router.get('/:staffId', canRead, validate(v.agentPdf), ctrl.agentPdf);

  return router;
};
