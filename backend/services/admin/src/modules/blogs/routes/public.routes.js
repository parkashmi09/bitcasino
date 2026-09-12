'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../blogs.validators');
const { BlogsService } = require('../blogs.service');
const { createControllers } = require('../controllers');

/**
 * Reading the blog.
 *
 * `public` is the AUDIENCE, not a path segment — these mount alongside the
 * admin routes and simply carry no guard. That is right for all five: a blog
 * exists to be read by people who are not logged in.
 *
 * Reading was open in legacy too, and that was never the problem. The problem
 * was that all five WRITE routes were open as well, so anyone who could reach
 * the port could publish or delete any page on the site.
 *
 * Unpublished posts are invisible here. `includeUnpublished` is derived from
 * `req.staff` in the controller, never from the query string, so a draft cannot
 * be read by adding a parameter.
 */
module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: new BlogsService(deps) });
  const router = Router();

  /** @legacy GET /all */
  router.get('/', validate(v.list), ctrl.list);

  /**
   * Literal segments before the parameter routes.
   *
   * `/category/:category` and `/slug/:slug` are namespaced rather than sharing
   * `/:something`, because a slug and a numeric id are otherwise ambiguous —
   * `banners` hit exactly this collision when its paths were flattened.
   */
  /** @legacy GET /by-category?category=news */
  router.get('/category/:category', validate(v.byCategory), ctrl.byCategory);
  /** @legacy GET /by-slug?slug=… */
  router.get('/slug/:slug', validate(v.bySlug), ctrl.bySlug);

  /** The image bytes. Legacy served these from a static mount. */
  router.get('/:id/image', validate(v.byId), ctrl.image);

  /** @legacy GET /by-id?id=5 */
  router.get('/:id', validate(v.byId), ctrl.byId);

  return router;
};
