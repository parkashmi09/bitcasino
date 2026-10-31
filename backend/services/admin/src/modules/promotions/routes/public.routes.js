'use strict';

const { Router } = require('express');
const { validate, entitlements } = require('@ibitplay/common');

const v = require('../promotions.validators');
const { PromotionsService } = require('../promotions.service');
const { createControllers } = require('../controllers');

module.exports = function publicRoutes(deps) {
  const ctrl = createControllers({ service: new PromotionsService(deps) });
  const router = Router();

  // Not in the owner's plan: every route here answers 403 NOT_ENTITLED (docs/OWNER-PANEL.md §4).
  router.use(entitlements.requireFeature('promotions'));

  // rainbet: public routes are mounted without auth, so `req.staff` was never set and the admin's
  // Promotions screen could not see drafts. A staff token (the admin panel's) now identifies staff;
  // no token, or a player's, reads as before (published only).
  router.use(deps.auth.authenticateStaff({ optional: true }));

  router.get('/sidebar', validate(v.sidebarList), ctrl.sidebar);
  router.get('/', validate(v.list), ctrl.list);
  router.get('/slug/:segment/:slug', validate(v.bySlug), ctrl.bySlug);
  router.get('/:id/image', validate(v.byId), ctrl.image);
  router.get('/:id', validate(v.byId), ctrl.byId);

  return router;
};
