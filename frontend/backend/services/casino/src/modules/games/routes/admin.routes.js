'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../games.validators');
const { GamesService } = require('../games.service');
const { createControllers } = require('../controllers');

/**
 * Curation — what the lobby shows and in what order.
 *
 * EVERY ROUTE IN THIS FILE WAS UNAUTHENTICATED IN LEGACY. The routes file
 * mounted them with the comment `// Admin (protect this)` above them and no
 * middleware below it. Anyone who could reach the server could:
 *
 *   - replace the hot-games, live-casino, popular-slots, crash and Indian
 *     collections — the whole front page of the casino
 *   - reorder any vendor's or any type's game list
 *   - point any game's tile at any URL
 *
 * Only `/admin/providers` had `protectStaff`, and only because it was written
 * later and inline in the routes file rather than in the controller.
 *
 * They are `admin` audience here, so the module loader attaches staff auth. A
 * module cannot forget it, because the module never attaches it.
 *
 * ── AUTHENTICATION WAS ONLY HALF OF IT ──────────────────────────────────
 *
 * The audience guard proves the caller is staff. It says nothing about what
 * they may do, and this file used to add nothing further — so every write
 * above was reachable by ANY staff account, down to a level-7 executive whose
 * grants are read-only.
 *
 * Reads take `casino:read`, writes take `casino:manage`. The split matters:
 * support staff need to see which games are in the hot collection; rewriting
 * the casino's front page is a different act.
 */
module.exports = function adminRoutes(deps) {
  const { auth } = deps;
  const ctrl = createControllers({ service: new GamesService(deps) });
  const router = Router();

  const canRead = auth.requirePermission(PERMISSIONS.CASINO_READ);
  const canManage = auth.requirePermission(PERMISSIONS.CASINO_MANAGE);

  // ── Curated collections ─────────────────────────────────────────────
  /**
   * @legacy POST /api/gis/admin/gis/hotgames
   * @legacy POST /api/gis/admin/gis/livecasino
   * @legacy POST /api/gis/admin/gis/popularslots
   * @legacy POST /api/gis/admin/gis/crashgames
   * @legacy POST /api/gis/admin/gis/indiangames
   */
  router.put('/collections/:collection', canManage, validate(v.writeCollection), ctrl.setCollection);
  router.get('/collections/:collection', canRead, validate(v.readCollection), ctrl.collection);

  // ── Per-vendor priority ─────────────────────────────────────────────
  /** @legacy GET /api/gis/admin/gis/vendors */
  router.get('/vendors', canRead, ctrl.vendors);
  /** @legacy GET /api/gis/admin/gis/priority/:vendor */
  router.get('/priority/:vendor', canRead, validate(v.vendorParam), ctrl.vendorPriority);
  /** @legacy POST /api/gis/admin/gis/priority/:vendor */
  router.put('/priority/:vendor', canManage, validate(v.setVendorPriority), ctrl.setVendorPriority);
  /** @legacy GET /api/gis/admin/gis/vendor-search */
  router.get('/vendor-search', canRead, validate(v.searchWithinVendor), ctrl.searchWithinVendor);

  // ── Per-type priority ───────────────────────────────────────────────
  /** @legacy GET /api/gis/admin/gis/types */
  router.get('/types', canRead, ctrl.types);
  /** @legacy GET /api/gis/admin/gis/type-priority/:type */
  router.get('/type-priority/:type', canRead, validate(v.typeParam), ctrl.typePriority);
  /** @legacy POST /api/gis/admin/gis/type-priority/:type */
  router.put('/type-priority/:type', canManage, validate(v.setTypePriority), ctrl.setTypePriority);
  /** @legacy GET /api/gis/admin/gis/type-search */
  router.get('/type-search', canRead, validate(v.searchWithinType), ctrl.searchWithinType);

  // ── Catalogue editing ───────────────────────────────────────────────
  // `/catalogue/…` rather than `/games/…`: this router is already mounted at
  // `/admin/casino/games`, so the legacy segment would stutter into
  // `/games/games/search`.
  /** @legacy GET /api/gis/admin/gis/games/search */
  router.get('/catalogue/search', canRead, validate(v.searchGames), ctrl.search);
  /** @legacy PUT /api/gis/admin/gis/games/:uuid/image */
  router.put('/catalogue/:uuid/image', canManage, validate(v.updateImage), ctrl.updateImage);

  // ── Upstream providers ──────────────────────────────────────────────
  /** @legacy GET /api/gis/admin/providers */
  router.get('/providers', canRead, ctrl.upstreamProviders);
  /** @legacy PUT /api/gis/admin/providers */
  router.put('/providers', canManage, validate(v.setProviders), ctrl.setUpstreamProviders);

  return router;
};
