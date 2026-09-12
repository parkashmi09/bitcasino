'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../banners.validators');
const { BannersService } = require('../banners.service');
const { createControllers } = require('../controllers');

/**
 * Reading a banner.
 *
 * `public` here is the AUDIENCE, not a path segment — these mount at
 * `/api/v1/admin/banners/…` alongside the admin routes and simply carry no
 * guard. That is correct for these four: a visitor's browser fetches the home
 * page hero before there is anyone to authenticate.
 *
 * Reading was open in legacy too, and that was never the problem. The problem
 * was that WRITING was open as well.
 *
 * Inactive placements are hidden from an unauthenticated caller — a banner
 * taken down should not still be fetchable by anyone who knows its name.
 */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: new BannersService(deps) });
  const router = Router();

  /** @legacy GET /api/banners/getBannerAll */
  router.get('/', validate(v.list), ctrl.list);

  /**
   * @legacy GET /api/banners/getAllImagesBinary
   *
   * Declared before `/:type` so the literal path is not captured by the
   * parameter. Legacy declared `/banner/:type` under its own prefix and did not
   * have this collision; flattening the paths creates it, and route-ordering
   * shadowing has already bitten this codebase twice.
   */
  router.get('/binary', validate(v.list), ctrl.listWithImages);

  /** @legacy GET /api/banners/image/:filename */
  router.get('/image/:filename', validate(v.image), ctrl.image);

  /** @legacy GET /api/banners/banner/:type */
  router.get('/:type', validate(v.byType), ctrl.byType);

  return router;
};
