'use strict';

const { Router } = require('express');
const { validate, noBody } = require('@ibitplay/common');
const { PERMISSIONS, denyAgentTree } = require('@ibitplay/auth');

const v = require('../gis.validators');
const { buildGisService } = require('../gis.factory');
const { createControllers } = require('../controllers');

/**
 * Campaigns, vouchers and catalogue syncs.
 *
 * All of these were unauthenticated in legacy, and all of them give something
 * away: a freespin campaign is free play, and a voucher is table credit with a
 * winnings cap. `POST /freespins/set` alone was "grant any named player any
 * number of free spins", with the player id in the body.
 *
 * The freespin and voucher routes additionally had no table behind them — see
 * migration 016 — so every one of them returned 500.
 *
 * ═════════════════════════════════════════════════════════════════════════
 * A STAFF TOKEN IS NOT A GRANT
 *
 * The `admin` audience guard is `authenticateStaff()` — it proves WHO is
 * calling, not what they may do. This file used to stop there, so the floor
 * for creating a freespin campaign or a voucher was "any staff account at
 * all", including an EXECUTIVE at level 7 whose entire grant list is
 * `users:read`, `wallet:read`, `reports:read`.
 *
 * Both of those hand out value. They are gated on `casino:manage` now, the
 * same grant the rest of the casino write surface uses, and the reads on
 * `casino:read` so a support account can look at a campaign without being
 * able to create one.
 * ═════════════════════════════════════════════════════════════════════════
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const ctrl = createControllers({ service: buildGisService(deps) });
  const router = Router();

  const canRead = auth.requirePermission(PERMISSIONS.CASINO_READ);
  const canManage = auth.requirePermission(PERMISSIONS.CASINO_MANAGE);
  // Freespin campaigns and vouchers are promotions: refused to the agent tree.
  const houseOnly = denyAgentTree();

  // ── Freespin campaigns ──────────────────────────────────────────────
  /** @legacy POST /api/gis/freespins/set */
  router.post('/freespins', houseOnly, canManage, validate(v.setFreespin), ctrl.setFreespin);
  /** @legacy GET /api/gis/freespins/get */
  router.get('/freespins', houseOnly, canRead, validate(v.freespinId), ctrl.getFreespin);
  /** @legacy POST /api/gis/freespins/cancel */
  router.post('/freespins/cancel', houseOnly, canManage, validate(v.cancelFreespin), ctrl.cancelFreespin);

  // ── Free vouchers ───────────────────────────────────────────────────
  /** @legacy POST /api/gis/freevouchers/set */
  router.post('/vouchers', houseOnly, canManage, validate(v.setVoucher), ctrl.setVoucher);
  /** @legacy GET /api/gis/freevouchers/get */
  router.get('/vouchers', houseOnly, canRead, validate(v.voucherId), ctrl.getVoucher);
  /** @legacy POST /api/gis/freevouchers/cancel */
  router.post('/vouchers/cancel', houseOnly, canManage, validate(v.cancelVoucher), ctrl.cancelVoucher);

  // ── Catalogue ───────────────────────────────────────────────────────
  /**
   * @legacy GET /api/gis/sync/gamesnew
   * @legacy GET /api/gis/sync — the older, truncate-first variant
   *
   * POST rather than GET: this writes hundreds of rows and takes minutes. A GET
   * that mutates is one browser prefetch away from running itself.
   */
  router.post('/sync/games', noBody(), canManage, ctrl.syncGames);
  /** @legacy GET /api/gis/sync/providersnew */
  router.post('/sync/providers', noBody(), canManage, ctrl.syncProviders);

  /**
   * @legacy GET /api/gis/self-validate
   *
   * Not a read: it makes a live call to the provider with the merchant
   * credentials (and a provider failure comes back as a 502). It used to sit
   * on `casino:read`, which SUPER_MASTER holds, so the agent tree could fire
   * provider calls at will. It is an integration check for the house: the
   * catalogue-write grant, and refused to the agent tree outright.
   */
  router.get(
    '/self-validate',
    denyAgentTree({ code: 'INTEGRATION_CHECK_HOUSE_ONLY', message: 'Integration checks are not available to agent accounts' }),
    canManage,
    ctrl.selfValidate
  );

  return router;
};
