'use strict';

const { Router } = require('express');
const { validate, createActivityRecorder, imageUpload, noBody } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const v = require('../games.validators');
const E = require('../games.errors');
const { GamesService, LOGO_MAX_BYTES } = require('../games.service');
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
  const { auth, clients, logger, config } = deps;
  const ctrl = createControllers({ service: new GamesService(deps) });
  const router = Router();

  const withActivity = createActivityRecorder({
    client: clients.admin,
    logger,
    serviceName: config.SERVICE_NAME,
  });

  const canRead = auth.requirePermission(PERMISSIONS.CASINO_READ);
  const canManage = auth.requirePermission(PERMISSIONS.CASINO_MANAGE);

  // ── Curated collections ─────────────────────────────────────────────
  /**
   * @legacy POST /api/gis/admin/gis/hotgames
   * @legacy POST /api/gis/admin/gis/livecasino
   * @legacy POST /api/gis/admin/gis/popularslots
   * @legacy POST /api/gis/admin/gis/crashgames
   */
  router.put('/collections/:collection', canManage, validate(v.writeCollection), ctrl.setCollection);
  router.get('/collections/:collection', canRead, validate(v.readCollection), ctrl.collection);

  // ── Lobby categories (migration 158) ────────────────────────────────
  router.get('/categories', canRead, ctrl.categories);
  router.post('/categories', canManage, validate(v.createCategory), ctrl.createCategory);
  router.put('/categories/order', canManage, validate(v.reorderCategories), ctrl.reorderCategories);
  router.get('/categories/:slug', canRead, validate(v.readCategory), ctrl.categoryGames);
  router.patch('/categories/:slug', canManage, validate(v.updateCategory), ctrl.updateCategory);
  router.delete('/categories/:slug', canManage, validate(v.categoryParam), ctrl.deleteCategory);

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
  router.get('/catalogue/search', canRead, validate(v.searchGames), ctrl.adminSearch);
  router.get('/catalogue/pick', canRead, validate(v.pickList), ctrl.pickList);
  // The tile art as a file (PNG, JPEG or WebP, 1 MB); the URL form is PUT /catalogue/:uuid/image.
  router.put(
    '/catalogue/:uuid/image-file',
    canManage,
    ...imageUpload.singleImage({ field: 'image', errors: E, maxBytes: LOGO_MAX_BYTES }),
    noBody(),
    validate(v.uuidParam),
    ctrl.putGameImage
  );
  /** @legacy PUT /api/gis/admin/gis/games/:uuid/image */
  router.put('/catalogue/:uuid/image', canManage, validate(v.updateImage), ctrl.updateImage);

  // ── Upstream providers ──────────────────────────────────────────────
  /** @legacy GET /api/gis/admin/providers */
  router.get('/providers', canRead, ctrl.upstreamProviders);
  /** @legacy PUT /api/gis/admin/providers */
  router.put('/providers', canManage, validate(v.setProviders), ctrl.setUpstreamProviders);

  // ── Lobby providers: the site admin's switch and logos ──────────────
  //
  // `/providers` above is the aggregator feed's list, and nothing in the lobby
  // reads its flag. These are what the lobby honours (migration 067). Writes
  // take `casino:manage`, as the upstream switch does, and are audited — the
  // first question after a provider vanishes from the site is who did it.
  router.get('/provider-settings', canRead, ctrl.providerSettings);

  router.patch(
    '/provider-settings/:name',
    canManage,
    validate(v.updateProviderSetting),
    withActivity({
      action: 'casino.provider.update',
      describe: (req) => ({ targetType: 'CASINO_PROVIDER', targetId: req.params.name, details: req.body }),
    }),
    ctrl.updateProviderSetting
  );

  router.get('/provider-settings/:name/logo', canRead, validate(v.providerLogo), ctrl.adminProviderLogo);

  // The multipart parse runs after the permission check, as the banner upload's does.
  router.put(
    '/provider-settings/:name/logo',
    canManage,
    ...imageUpload.singleImage({ field: 'image', errors: E, maxBytes: LOGO_MAX_BYTES }),
    noBody(), // after multer: the form carries the file and nothing else
    validate(v.providerParam),
    withActivity({
      action: 'casino.provider.logo',
      describe: (req) => ({
        targetType: 'CASINO_PROVIDER',
        targetId: req.params.name,
        details: { bytes: req.file?.size ?? null, declaredType: req.file?.mimetype ?? null },
      }),
    }),
    ctrl.putProviderLogo
  );

  // The same logo from an image URL: the platform fetches it (public https hosts only).
  router.put(
    '/provider-settings/:name/logo-url',
    canManage,
    validate(v.providerLogoUrl),
    withActivity({
      action: 'casino.provider.logo',
      describe: (req) => ({ targetType: 'CASINO_PROVIDER', targetId: req.params.name, details: { url: String(req.body?.url ?? '').slice(0, 300) } }),
    }),
    ctrl.putProviderLogoUrl
  );

  router.delete(
    '/provider-settings/:name/logo',
    noBody(),
    canManage,
    validate(v.providerParam),
    withActivity({
      action: 'casino.provider.logo-remove',
      describe: (req) => ({ targetType: 'CASINO_PROVIDER', targetId: req.params.name }),
    }),
    ctrl.removeProviderLogo
  );

  return router;
};
