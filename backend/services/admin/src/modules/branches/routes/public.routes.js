'use strict';

const { Router } = require('express');
const { validate, noBody, noQuery, response, asyncHandler, createRateLimiter } = require('@ibitplay/common');
const { TokenService } = require('@ibitplay/auth');

const v = require('../branches.validators');
const { BranchesService } = require('../branches.service');

/**
 * The branch's own panel (admin app /branch).
 *
 * `public` audience because a branch token is not a staff token: the loader's staff guard would
 * refuse it, and the gateway sets no identity for it. Every route but the sign-in runs behind
 * `branchOnly` below, which verifies the branch token (its own key, `TOKEN_TYPES.BRANCH`) and
 * the owner's switch on every request. A branch reaches its own players only — the id comes
 * from the token, never from the request.
 *
 *   POST /admin/branches/portal/login       { username, password } → { token, branch }
 *   GET  /admin/branches/portal/me
 *   POST /admin/branches/portal/logout
 *   GET  /admin/branches/portal/summary     ?from&to
 *   GET  /admin/branches/portal/players     ?search&limit&offset
 *   POST /admin/branches/portal/players     { username, password, email?, phone? }
 *   GET  /admin/branches/portal/statement   ?fromDate&toDate&category&userId&page&limit
 *   GET  /admin/branches/portal/players/:userId
 *   GET  /admin/branches/portal/deposits    ?fromDate&toDate&status&userId&page&limit  (every rail, method + details)
 *   GET  /admin/branches/portal/withdrawals (same)
 *   GET  /admin/branches/portal/bets        ?kind=originals|casino|sports&fromDate&toDate&userId&page&limit
 */
module.exports = function publicRoutes(deps) {
  const { config, logger } = deps;
  const service = new BranchesService(deps);
  const router = Router();

  // As the staff sign-in: per IP, only failures spend it.
  const signInLimiter = createRateLimiter({
    name: 'branches:signin',
    windowMs: 15 * 60_000,
    max: 12,
    keyBy: 'ip',
    skipSuccessfulRequests: true,
    message: 'Too many sign-in attempts from this address. Try again in 15 minutes.',
    enabled: config.RATE_LIMIT_ENABLED !== false,
    logger,
  });

  const branchOnly = asyncHandler(async (req, _res, next) => {
    await service.assertEnabled();
    req.branch = await service.authenticate(TokenService.fromHeader(req.headers.authorization));
    next();
  });

  router.post(
    '/portal/login',
    signInLimiter,
    validate(v.login),
    asyncHandler(async (req, res) => response.ok(res, await service.login(req.body)))
  );

  router.get('/portal/me', branchOnly, noQuery(), (req, res) => response.ok(res, req.branch));

  router.post(
    '/portal/logout',
    branchOnly,
    noBody(),
    asyncHandler(async (req, res) => {
      await service.logout(req.branch.id);
      return response.ok(res, { signedOut: true });
    })
  );

  router.get(
    '/portal/summary',
    branchOnly,
    validate(v.portalSummary),
    asyncHandler(async (req, res) => response.ok(res, await service.summary({ ...req.query, branchId: req.branch.id })))
  );

  router.get(
    '/portal/players',
    branchOnly,
    validate(v.portalPlayers),
    asyncHandler(async (req, res) => {
      const { limit, offset } = req.query;
      const result = await service.players({ ...req.query, branchId: req.branch.id });
      return response.paginated(res, result.rows, { page: Math.floor(offset / limit) + 1, limit, total: result.total });
    })
  );

  router.post(
    '/portal/players',
    branchOnly,
    validate(v.portalCreatePlayer),
    asyncHandler(async (req, res) => response.created(res, await service.createPlayer({ ...req.body, branchId: req.branch.id })))
  );

  router.get(
    '/portal/players/:userId',
    branchOnly,
    validate(v.portalPlayer),
    asyncHandler(async (req, res) => response.ok(res, await service.player({ userId: req.params.userId, branchId: req.branch.id })))
  );

  for (const kind of ['deposits', 'withdrawals']) {
    router.get(
      `/portal/${kind}`,
      branchOnly,
      validate(v.portalMoney),
      asyncHandler(async (req, res) => response.ok(res, await service.money({ ...req.query, kind, branchId: req.branch.id })))
    );
  }

  router.get(
    '/portal/bets',
    branchOnly,
    validate(v.portalBets),
    asyncHandler(async (req, res) => response.ok(res, await service.bets({ ...req.query, branchId: req.branch.id })))
  );

  router.get(
    '/portal/statement',
    branchOnly,
    validate(v.portalStatement),
    asyncHandler(async (req, res) => response.ok(res, await service.statement({ ...req.query, branchId: req.branch.id })))
  );

  return router;
};
