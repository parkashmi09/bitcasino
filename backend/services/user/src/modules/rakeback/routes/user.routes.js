'use strict';

const { Router } = require('express');
const { response, asyncHandler, createRateLimiter } = require('@ibitplay/common');

const { RakebackService } = require('../rakeback.service');

/**
 * Rakeback over HTTP.
 *
 * Neither of these existed in legacy — both operations were socket-only. They
 * are here because a claim moves money, and a money movement that can only be
 * made over a WebSocket cannot be retried by a client that lost the socket,
 * cannot be called by support tooling, and does not appear in an access log.
 *
 * Same service, same guarantees: the claim takes the row lock and writes a
 * ledger row whichever transport asked for it.
 */
module.exports = function userRoutes(deps) {
  const service = new RakebackService(deps);
  const router = Router();

  const claimLimiter = createRateLimiter({
    name: 'rakeback-claim',
    windowMs: 60_000,
    max: 10,
    enabled: deps.config.RATE_LIMIT_ENABLED !== false,
  });

  /** @legacy SOCKET 4d0779dab780d8b773e7h6fl9jxd7hm7 (C.RAKEBACK_AMOUNT) */
  router.get(
    '/',
    asyncHandler(async (req, res) => response.ok(res, await service.amount({ userId: req.user.id })))
  );

  /** @legacy SOCKET k2089ht7ae660578ed9gffgh8hkk7vxj (C.ADD_RAKEBACK) */
  router.post(
    '/claim',
    claimLimiter,
    asyncHandler(async (req, res) => response.ok(res, await service.claim({ userId: req.user.id })))
  );

  return router;
};
