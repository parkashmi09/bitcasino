'use strict';

const { Router } = require('express');
const { validate, response, asyncHandler, createRateLimiter, z } = require('@ibitplay/common');
const { PERMISSIONS } = require('@ibitplay/auth');

const { searchByUsername } = require('../lookup.service');
const { assertTransactionPassword } = require('../../staff-auth/transactionPassword');

const searchQuery = {
  query: z.object({
    username: z.string().trim().min(1, 'Username query parameter is required for search').max(120),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(25),
  }).strict(),
};

const verifyBody = {
  body: z.object({ transactionPassword: z.string().max(200).optional() }).strict(),
};

/**
 *   GET  /admin/exchange-lookup/search-by-username?username=&page=&limit=
 *        → { results: [{ wallet_id, user_id, staff_id, username, user_type }], page, limit }
 *   POST /admin/exchange-lookup/transaction-password/verify { transactionPassword }
 *        → zip ka `/admin/transaction-password/verify` (General Lock ka Load button). Galat ho to 4xx.
 */
module.exports = function adminRoutes(deps) {
  const { auth, models, logger, config } = deps;
  const router = Router();

  router.get(
    '/search-by-username',
    auth.requirePermission(PERMISSIONS.USERS_READ),
    validate(searchQuery),
    asyncHandler(async (req, res) => {
      const { username, page, limit } = req.query;
      const actor = { id: req.staff.id, level: req.staff.level };
      return response.ok(res, await searchByUsername(models, { actor, username, page, limit, logger }));
    })
  );

  // Galat code baar baar try na ho sake.
  const codeLimiter = createRateLimiter({
    name: 'exchange-lookup:txn-verify',
    windowMs: 15 * 60_000,
    max: 20,
    message: 'Too many attempts. Try again in 15 minutes.',
    enabled: config.RATE_LIMIT_ENABLED !== false,
    logger,
  });

  // Sirf check karta hai, kuch likhta nahi.
  router.post(
    '/transaction-password/verify',
    auth.requirePermission(PERMISSIONS.USERS_READ),
    codeLimiter,
    validate(verifyBody),
    asyncHandler(async (req, res) => {
      await assertTransactionPassword(models, req.staff.id, req.body.transactionPassword, {
        required: true,
        executiveId: req.staff.executiveId ?? null,
      });
      return response.ok(res, { verified: true });
    })
  );

  return router;
};
