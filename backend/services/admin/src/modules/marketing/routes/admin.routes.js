'use strict';

const { Router } = require('express');
const { validate } = require('@ibitplay/common');

const v = require('../marketing.validators');
const { MarketingService } = require('../marketing.service');
const { createProtectMarketing } = require('../protectMarketing');
const { createControllers } = require('../controllers');

/**
 * The marketing panel.
 *
 * `protectMarketing` runs on the whole router, before any route matches — so
 * the read-only guarantee and the account-type check cannot be forgotten on a
 * route added later. Legacy did the same with `router.use(protectStaff,
 * protectMarketing)` and it is the right shape.
 *
 * ── WHY THERE IS NO `requirePermission` HERE ────────────────────────────
 *
 * There deliberately is not one, and this note exists so the absence reads as
 * a decision rather than an omission — a permission-grep audit flags this file
 * otherwise.
 *
 * `protectMarketing` is a STRICTER gate than a grant string, not a weaker one.
 * It refuses every verb but GET/HEAD before a handler runs, and it re-reads
 * `kind` and `status` from the `executives` row on each request rather than
 * trusting a JWT claim. A permission check on top would express less: grants
 * live in the token, and the whole point here is that a plain staff token —
 * whatever it carries — must not reach platform-wide revenue figures.
 */
module.exports = function adminRoutes(deps) {
  const ctrl = createControllers({ service: new MarketingService(deps) });
  const router = Router();

  router.use(createProtectMarketing(deps));

  /** @legacy GET /marketing/me */
  router.get('/me', validate(v.me), ctrl.me);

  /** @legacy GET /marketing/analytics/signups */
  router.get('/analytics/signups', validate(v.signups), ctrl.signups);

  /** @legacy GET /marketing/analytics/deposits */
  router.get('/analytics/deposits', validate(v.deposits), ctrl.deposits);

  /** @legacy GET /marketing/analytics/retention */
  router.get('/analytics/retention', validate(v.retention), ctrl.retention);

  /** @legacy GET /marketing/analytics/top-agents */
  router.get('/analytics/top-agents', validate(v.topAgents), ctrl.topAgents);

  /** @legacy GET /marketing/customers */
  router.get('/customers', validate(v.customers), ctrl.customers);

  return router;
};
